import "reflect-metadata";

import { inject, injectable } from "inversify";

import type { CalendarPort } from "../../ports/CalendarPort.js";
import type { LlmPort } from "../../ports/LlmPort.js";
import type { NotionPort } from "../../ports/NotionPort.js";
import type { TodoistPort } from "../../ports/TodoistPort.js";
import { TOKENS } from "../../ports/tokens.js";
import { addMinutesIso, civilDateOfIso } from "../clock.js";
import { err, ok, type Result } from "../result.js";
import {
  InboxEventRunSchema,
  type CalendarEvent,
  type InboxEventOutcome,
  type InboxEventRun,
  type IntegrationConfig,
  type TimeRange,
  type TodoistTask,
} from "../schemas.js";
import { conflictDetail, splitOverlappingEvents } from "./conflict.js";
import { draftInboxEvent } from "./draft.js";
import { CONFLICT_NEXT_STEP, inspectDue, pendenciaComment } from "./due.js";
import {
  DEFAULT_DURATION_MINUTES,
  EVENT_LABEL,
  PENDING_LABEL,
  PENDING_LABEL_COLOR,
} from "./labels.js";
import { notionPageIdFromBriefing } from "./links.js";
import {
  calendarRemindersFor,
  isForceCreatePriority,
} from "./reminders.js";

@injectable()
export class ProcessInboxEvents {
  constructor(
    @inject(TOKENS.Todoist) private readonly todoist: TodoistPort,
    @inject(TOKENS.Notion) private readonly notion: NotionPort,
    @inject(TOKENS.GoogleCalendar) private readonly calendar: CalendarPort,
    @inject(TOKENS.Llm) private readonly llm: LlmPort,
    @inject(TOKENS.Config) private readonly config: IntegrationConfig,
  ) {}

  async execute(): Promise<Result<InboxEventRun>> {
    const inboxId = await this.inboxProjectId();
    if (!inboxId.ok) {
      return inboxId;
    }

    const tasks = await this.todoist.listTasks({ projectId: inboxId.value });
    if (!tasks.ok) {
      return tasks;
    }

    const candidates = tasks.value.filter(isEventCandidate);
    const outcomes: InboxEventOutcome[] = [];

    for (const task of candidates) {
      outcomes.push(await this.processOne(task));
    }

    return ok(
      InboxEventRunSchema.parse({
        scanned: candidates.length,
        promoted: outcomes.filter((item) => item.status === "promoted").length,
        pending: outcomes.filter((item) => item.status === "pendencia").length,
        failed: outcomes.filter((item) => item.status === "failed").length,
        outcomes,
      }),
    );
  }

  private async processOne(task: TodoistTask): Promise<InboxEventOutcome> {
    const due = inspectDue(task);
    if (!due.ok) {
      const marked = await this.markPending(task, due.detail);
      if (!marked.ok) {
        return failed(task.id, marked.error.message);
      }
      return {
        taskId: task.id,
        status: "pendencia",
        reason: due.detail,
      };
    }

    const duration = task.durationMinutes ?? DEFAULT_DURATION_MINUTES;
    const range: TimeRange = {
      start: { iso: due.startIso },
      end: { iso: addMinutesIso(due.startIso, duration) },
    };

    const slot = await this.listSlotEvents(range);
    if (!slot.ok) {
      return failed(task.id, slot.error.message);
    }
    const conflicts = splitOverlappingEvents(range, slot.value);
    console.log("[ProcessInboxEvents.slot]", {
      taskId: task.id,
      start: range.start.iso,
      end: range.end.iso,
      listed: slot.value.length,
      foreign: conflicts.foreign.map((item) => item.summary),
      own: conflicts.own.map((item) => item.summary),
    });

    if (!isForceCreatePriority(task.priority) && conflicts.foreign.length > 0) {
      const rolledBack = await this.rollbackOwn(conflicts.own);
      if (!rolledBack.ok) {
        return failed(task.id, rolledBack.error.message);
      }
      const detail = conflictDetail(conflicts.foreign, range);
      const marked = await this.markPending(
        task,
        detail,
        CONFLICT_NEXT_STEP,
      );
      if (!marked.ok) {
        return failed(task.id, marked.error.message);
      }
      return {
        taskId: task.id,
        status: "pendencia",
        reason: detail,
      };
    }

    const existingOwn = conflicts.own[0] ?? null;

    const comments = await this.todoist.listTaskComments(task.id);
    if (!comments.ok) {
      return failed(task.id, comments.error.message);
    }

    const taskReminders = await this.todoist.listTaskReminders(task.id);
    if (!taskReminders.ok) {
      return failed(task.id, taskReminders.error.message);
    }

    const draft = await draftInboxEvent(this.llm, task, comments.value);
    if (!draft.ok) {
      return failed(task.id, draft.error.message);
    }

    const page = await this.notion.upsertUpcomingEvent({
      pageId: notionPageIdFromBriefing(existingOwn?.description ?? null),
      title: draft.value.title,
      startIso: due.startIso,
      recurrenceLabel: draft.value.recurrenceLabel,
      markdown: draft.value.briefingMarkdown,
      calendarEventId: existingOwn?.eventId ?? null,
      calendarHtmlLink: existingOwn?.htmlLink ?? null,
    });
    if (!page.ok) {
      return failed(task.id, page.error.message);
    }

    const calendarEvent = await this.calendar.upsertEvent({
      eventId: existingOwn?.eventId ?? page.value.calendarEventId,
      calendarId: this.config.googleCalendarId,
      summary: draft.value.title,
      range,
      description: `Briefing: ${page.value.url}`,
      recurrence: draft.value.recurrence,
      reminders: calendarRemindersFor(
        task.priority,
        taskReminders.value,
        due.startIso,
      ),
    });
    if (!calendarEvent.ok) {
      return failed(task.id, calendarEvent.error.message);
    }

    const linked = await this.notion.upsertUpcomingEvent({
      pageId: page.value.pageId,
      title: draft.value.title,
      startIso: due.startIso,
      recurrenceLabel: draft.value.recurrenceLabel,
      markdown: draft.value.briefingMarkdown,
      calendarEventId: calendarEvent.value.eventId,
      calendarHtmlLink: calendarEvent.value.htmlLink,
    });
    if (!linked.ok) {
      return failed(task.id, linked.error.message);
    }

    const deleted = await this.todoist.deleteTask(task.id);
    if (!deleted.ok) {
      return failed(task.id, deleted.error.message);
    }

    return {
      taskId: task.id,
      status: "promoted",
      notionUrl: linked.value.url,
      eventId: calendarEvent.value.eventId,
    };
  }

  private async listSlotEvents(
    range: TimeRange,
  ): Promise<Result<readonly CalendarEvent[]>> {
    const events: CalendarEvent[] = [];
    for (const calendarId of conflictCalendarIds(this.config)) {
      const listed = await this.calendar.listEvents({
        date: civilDateOfIso(range.start.iso),
        untilDate: civilDateOfIso(range.end.iso),
        calendarId,
      });
      if (!listed.ok) {
        return listed;
      }
      events.push(...listed.value);
    }
    return ok(events);
  }

  private async rollbackOwn(
    events: readonly CalendarEvent[],
  ): Promise<Result<void>> {
    for (const event of events) {
      const deleted = await this.calendar.deleteEvent({
        eventId: event.eventId,
        calendarId: this.config.googleCalendarId,
      });
      if (!deleted.ok) {
        return deleted;
      }
      const pageId = notionPageIdFromBriefing(event.description);
      if (!pageId) {
        continue;
      }
      const archived = await this.notion.archiveUpcomingEvent(pageId);
      if (!archived.ok) {
        return archived;
      }
    }
    return ok(undefined);
  }

  private async markPending(
    task: TodoistTask,
    detail: string,
    nextStep?: string,
  ): Promise<Result<void>> {
    const ensured = await this.ensurePendingLabel();
    if (!ensured.ok) {
      return ensured;
    }

    const commented = await this.todoist.addTaskComment(
      task.id,
      pendenciaComment(detail, nextStep),
    );
    if (!commented.ok) {
      return commented;
    }

    const labels = task.labels.includes(PENDING_LABEL)
      ? task.labels
      : [...task.labels, PENDING_LABEL];
    const updated = await this.todoist.updateTask(task.id, { labels });
    if (!updated.ok) {
      return updated;
    }
    return ok(undefined);
  }

  private async ensurePendingLabel(): Promise<Result<void>> {
    const labels = await this.todoist.listLabels();
    if (!labels.ok) {
      return labels;
    }
    if (labels.value.some((label) => label.name === PENDING_LABEL)) {
      return ok(undefined);
    }
    const created = await this.todoist.createLabel({
      name: PENDING_LABEL,
      color: PENDING_LABEL_COLOR,
    });
    if (!created.ok) {
      return created;
    }
    return ok(undefined);
  }

  private async inboxProjectId(): Promise<Result<string>> {
    const projects = await this.todoist.listProjects();
    if (!projects.ok) {
      return projects;
    }
    const inbox = projects.value.find((project) => project.inboxProject);
    if (!inbox) {
      return err({
        provider: "todoist",
        code: "not_found",
        message: "Inbox do Todoist não encontrada.",
        retryable: false,
        retryAfterMs: null,
        cause: null,
      });
    }
    return ok(inbox.id);
  }
}

function conflictCalendarIds(config: IntegrationConfig): string[] {
  const ids = [config.googleCalendarId];
  const instituto = config.googleCalendarInstitutoId.trim();
  if (
    instituto.length > 0 &&
    instituto !== "instituto-mock" &&
    instituto !== config.googleCalendarId
  ) {
    ids.push(instituto);
  }
  return ids;
}

function isEventCandidate(task: TodoistTask): boolean {
  return (
    !task.isCompleted &&
    task.labels.includes(EVENT_LABEL) &&
    !task.labels.includes(PENDING_LABEL)
  );
}

function failed(taskId: string, message: string): InboxEventOutcome {
  return { taskId, status: "failed", message };
}
