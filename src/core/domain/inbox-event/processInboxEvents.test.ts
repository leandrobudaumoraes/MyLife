import assert from "node:assert/strict";
import { test } from "node:test";

import type { CalendarPort } from "../../ports/CalendarPort.js";
import type { LlmPort } from "../../ports/LlmPort.js";
import type { NotionPort } from "../../ports/NotionPort.js";
import type { TodoistPort } from "../../ports/TodoistPort.js";
import { ok, type Result } from "../result.js";
import type {
  CalendarEvent,
  IntegrationConfig,
  IntegrationError,
  TodoistComment,
  TodoistLabel,
  TodoistProject,
  TodoistReminder,
  TodoistTask,
  UpcomingEventRecord,
  UpsertEventInput,
  UpsertUpcomingEventInput,
} from "../schemas.js";
import { ProcessInboxEvents } from "./processInboxEvents.js";

const config: IntegrationConfig = {
  todoistToken: "t",
  notionApiKey: "n",
  notionUpcomingEventsDbId: "upcoming",
  googleCalendarId: "primary",
  googleCalendarInstitutoId: "instituto-mock",
};

test("ignora tarefa Event com Pending", async () => {
  const todoist = fakeTodoist([
    task({
      id: "1",
      labels: ["Event", "Pending"],
      dueDatetime: "2026-08-20T14:00:00",
    }),
  ]);
  const notion = fakeNotion();
  const calendar = fakeCalendar();
  const processor = new ProcessInboxEvents(
    todoist,
    notion,
    calendar,
    fakeLlm(),
    config,
  );

  const result = await processor.execute();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.scanned, 0);
  }
  assert.equal(notion.upserts.length, 0);
  assert.equal(calendar.upserts.length, 0);
});

test("sem hora marca Pending e não cria evento", async () => {
  const todoist = fakeTodoist([
    task({
      id: "2",
      labels: ["Event"],
      dueDate: "2026-08-20",
      dueDatetime: null,
    }),
  ]);
  const notion = fakeNotion();
  const calendar = fakeCalendar();
  const processor = new ProcessInboxEvents(
    todoist,
    notion,
    calendar,
    fakeLlm(),
    config,
  );

  const result = await processor.execute();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.pending, 1);
    assert.equal(result.value.outcomes[0]?.status, "pendencia");
  }
  assert.equal(todoist.comments.length, 1);
  assert.ok(todoist.updated[0]?.labels.includes("Pending"));
  assert.equal(notion.upserts.length, 0);
  assert.equal(calendar.upserts.length, 0);
  assert.deepEqual(todoist.deleted, []);
});

test("com data e hora grava Notion, Calendar e apaga a tarefa", async () => {
  const todoist = fakeTodoist([
    task({
      id: "3",
      content: "Consulta dentista",
      labels: ["Event"],
      dueDate: "2026-08-20",
      dueDatetime: "2026-08-20T14:00:00",
      dueString: "todo dia 15",
      isRecurring: true,
      priority: 4,
    }),
  ]);
  const notion = fakeNotion();
  const calendar = fakeCalendar();
  const processor = new ProcessInboxEvents(
    todoist,
    notion,
    calendar,
    fakeLlm(
      JSON.stringify({
        title: "Consulta no dentista",
        briefingMarkdown: "# O que é\nConsulta.",
        recurrenceLabel: "todo dia 15",
        recurrence: {
          freq: "MONTHLY",
          interval: 1,
          byDay: [],
          byMonthDay: 15,
          until: null,
        },
      }),
    ),
    config,
  );

  const result = await processor.execute();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.promoted, 1);
    assert.equal(result.value.outcomes[0]?.status, "promoted");
  }
  assert.equal(notion.upserts.length, 2);
  assert.equal(notion.upserts[0]?.pageId, null);
  assert.equal(notion.upserts[1]?.pageId, "page-Consulta no dentista");
  assert.equal(notion.upserts[0]?.recurrenceLabel, "todo dia 15");
  assert.equal(
    notion.upserts[1]?.calendarHtmlLink,
    "https://www.google.com/calendar/event?eid=abc",
  );
  assert.equal(calendar.upserts.length, 1);
  assert.equal(calendar.upserts[0]?.summary, "Consulta no dentista");
  assert.match(calendar.upserts[0]?.description ?? "", /Briefing:/);
  assert.equal(calendar.upserts[0]?.recurrence?.byMonthDay, 15);
  assert.deepEqual(calendar.upserts[0]?.reminders, [
    { method: "popup", minutes: 24 * 60 },
    { method: "popup", minutes: 60 },
  ]);
  assert.deepEqual(todoist.deleted, ["3"]);
});

test("se o Calendar falha, a tarefa permanece na Inbox", async () => {
  const todoist = fakeTodoist([
    task({
      id: "4",
      labels: ["Event"],
      dueDatetime: "2026-08-20T14:00:00",
    }),
  ]);
  const notion = fakeNotion();
  const calendar = fakeCalendar({
    fail: {
      provider: "google_calendar",
      code: "unavailable",
      message: "calendar down",
      retryable: true,
      retryAfterMs: 400,
      cause: null,
    },
  });
  const processor = new ProcessInboxEvents(
    todoist,
    notion,
    calendar,
    fakeLlm(),
    config,
  );

  const result = await processor.execute();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.failed, 1);
  }
  assert.equal(notion.upserts.length, 1);
  assert.deepEqual(todoist.deleted, []);
});

test("conflito na agenda marca Pending e descreve o evento", async () => {
  const todoist = fakeTodoist([
    task({
      id: "5",
      labels: ["Event"],
      dueDatetime: "2026-08-20T14:00:00",
      durationMinutes: 60,
      priority: 1,
    }),
  ]);
  const notion = fakeNotion();
  const calendar = fakeCalendar({
    events: [
      {
        eventId: "busy",
        calendarId: "primary",
        summary: "Reunião PagBank",
        range: {
          start: { iso: "2026-08-20T14:30:00-03:00" },
          end: { iso: "2026-08-20T15:30:00-03:00" },
        },
        htmlLink: "https://www.google.com/calendar/event?eid=busy",
        allDay: false,
        description: null,
      },
    ],
  });
  const processor = new ProcessInboxEvents(
    todoist,
    notion,
    calendar,
    fakeLlm(),
    config,
  );

  const result = await processor.execute();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.pending, 1);
    assert.equal(result.value.outcomes[0]?.status, "pendencia");
  }
  assert.equal(todoist.comments.length, 1);
  assert.match(todoist.comments[0] ?? "", /Sua captura: 20\/08\/2026 14:00–15:00/);
  assert.match(todoist.comments[0] ?? "", /Reunião PagBank/);
  assert.match(todoist.comments[0] ?? "", /14:30/);
  assert.match(todoist.comments[0] ?? "", /P1/);
  assert.ok(todoist.updated[0]?.labels.includes("Pending"));
  assert.equal(notion.upserts.length, 0);
  assert.equal(calendar.upserts.length, 0);
  assert.deepEqual(todoist.deleted, []);
});

test("P1 cria o evento mesmo com conflito", async () => {
  const todoist = fakeTodoist([
    task({
      id: "6",
      labels: ["Event"],
      dueDatetime: "2026-08-20T14:00:00",
      priority: 4,
    }),
  ]);
  const notion = fakeNotion();
  const calendar = fakeCalendar({
    events: [
      {
        eventId: "busy",
        calendarId: "primary",
        summary: "Reunião PagBank",
        range: {
          start: { iso: "2026-08-20T14:00:00-03:00" },
          end: { iso: "2026-08-20T15:00:00-03:00" },
        },
        htmlLink: null,
        allDay: false,
        description: null,
      },
    ],
  });
  const processor = new ProcessInboxEvents(
    todoist,
    notion,
    calendar,
    fakeLlm(),
    config,
  );

  const result = await processor.execute();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.promoted, 1);
  }
  assert.equal(calendar.upserts.length, 1);
  assert.deepEqual(todoist.deleted, ["6"]);
  assert.equal(todoist.comments.length, 0);
});

test("lembrete da tarefa vira notificação do Calendar", async () => {
  const todoist = fakeTodoist(
    [
      task({
        id: "7",
        labels: ["Event"],
        dueDatetime: "2026-08-20T14:00:00",
        priority: 2,
      }),
    ],
    [
      {
        type: "relative",
        minuteOffset: 15,
        dueDatetime: null,
        service: "email",
      },
    ],
  );
  const notion = fakeNotion();
  const calendar = fakeCalendar();
  const processor = new ProcessInboxEvents(
    todoist,
    notion,
    calendar,
    fakeLlm(),
    config,
  );

  const result = await processor.execute();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.promoted, 1);
  }
  assert.deepEqual(calendar.upserts[0]?.reminders, [
    { method: "email", minutes: 15 },
  ]);
});

test("conflito apaga o evento desta captura e marca Pending", async () => {
  const todoist = fakeTodoist([
    task({
      id: "8",
      content: "vento 2",
      labels: ["Event"],
      dueDatetime: "2026-08-21T13:15:00",
      durationMinutes: 60,
      priority: 1,
    }),
  ]);
  const notion = fakeNotion();
  const calendar = fakeCalendar({
    events: [
      {
        eventId: "own-vento",
        calendarId: "primary",
        summary: "Vento 2",
        range: {
          start: { iso: "2026-08-21T13:15:00-03:00" },
          end: { iso: "2026-08-21T14:15:00-03:00" },
        },
        htmlLink: "https://www.google.com/calendar/event?eid=own",
        allDay: false,
        description:
          "Briefing: https://www.notion.so/3c2f94d816108143af5ffcf5599fba5d",
      },
      {
        eventId: "nutri",
        calendarId: "primary",
        summary: "Agenda com nutricionista",
        range: {
          start: { iso: "2026-08-21T12:45:00-03:00" },
          end: { iso: "2026-08-21T13:45:00-03:00" },
        },
        htmlLink: "https://www.google.com/calendar/event?eid=nutri",
        allDay: false,
        description: null,
      },
    ],
  });
  const processor = new ProcessInboxEvents(
    todoist,
    notion,
    calendar,
    fakeLlm(),
    config,
  );

  const result = await processor.execute();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.pending, 1);
  }
  assert.deepEqual(calendar.deleted, ["own-vento"]);
  assert.deepEqual(notion.archived, [
    "3c2f94d8-1610-8143-af5f-fcf5599fba5d",
  ]);
  assert.equal(calendar.upserts.length, 0);
  assert.equal(notion.upserts.length, 0);
  assert.match(todoist.comments[0] ?? "", /nutricionista/);
  assert.doesNotMatch(todoist.comments[0] ?? "", /Vento 2/);
  assert.ok(todoist.updated[0]?.labels.includes("Pending"));
  assert.deepEqual(todoist.deleted, []);
});

test("só o próprio evento na agenda continua a promoção", async () => {
  const todoist = fakeTodoist([
    task({
      id: "9",
      content: "vento 2",
      labels: ["Event"],
      dueDatetime: "2026-08-21T13:15:00",
      priority: 1,
    }),
  ]);
  const notion = fakeNotion();
  const calendar = fakeCalendar({
    events: [
      {
        eventId: "own-vento",
        calendarId: "primary",
        summary: "Vento 2",
        range: {
          start: { iso: "2026-08-21T13:15:00-03:00" },
          end: { iso: "2026-08-21T14:15:00-03:00" },
        },
        htmlLink: "https://www.google.com/calendar/event?eid=own",
        allDay: false,
        description:
          "Briefing: https://www.notion.so/3c2f94d816108143af5ffcf5599fba5d",
      },
    ],
  });
  const processor = new ProcessInboxEvents(
    todoist,
    notion,
    calendar,
    fakeLlm('{"title":"Vento 2","briefingMarkdown":"# Ok","recurrenceLabel":null,"recurrence":null}'),
    config,
  );

  const result = await processor.execute();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.promoted, 1);
  }
  assert.equal(calendar.upserts[0]?.eventId, "own-vento");
  assert.equal(
    notion.upserts[0]?.pageId,
    "3c2f94d8-1610-8143-af5f-fcf5599fba5d",
  );
  assert.deepEqual(calendar.deleted, []);
  assert.deepEqual(todoist.deleted, ["9"]);
});

test("mesmo título e horário sem Briefing não grava por cima do evento alheio", async () => {
  const todoist = fakeTodoist([
    task({
      id: "10",
      content: "Dentista Smile",
      labels: ["Event"],
      dueDatetime: "2026-08-24T13:00:00",
      durationMinutes: 60,
      priority: 1,
    }),
  ]);
  const notion = fakeNotion();
  const calendar = fakeCalendar({
    events: [
      {
        eventId: "smile",
        calendarId: "primary",
        summary: "Dentista Smile",
        range: {
          start: { iso: "2026-08-24T13:00:00-03:00" },
          end: { iso: "2026-08-24T14:00:00-03:00" },
        },
        htmlLink: "https://www.google.com/calendar/event?eid=smile",
        allDay: false,
        description: null,
      },
    ],
  });
  const processor = new ProcessInboxEvents(
    todoist,
    notion,
    calendar,
    fakeLlm(),
    config,
  );

  const result = await processor.execute();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.pending, 1);
  }
  assert.equal(calendar.upserts.length, 0);
  assert.deepEqual(calendar.deleted, []);
  assert.equal(notion.upserts.length, 0);
  assert.match(todoist.comments[0] ?? "", /nada foi gravado/i);
  assert.match(todoist.comments[0] ?? "", /Dentista Smile/);
  assert.deepEqual(todoist.deleted, []);
});

function task(partial: Partial<TodoistTask>): TodoistTask {
  return {
    id: "id",
    content: "Tarefa",
    description: "",
    projectId: "inbox",
    sectionId: null,
    labels: [],
    dueDate: "2026-08-20",
    dueDatetime: null,
    dueString: null,
    isRecurring: false,
    priority: 1,
    durationMinutes: null,
    isCompleted: false,
    url: "https://todoist.example/id",
    ...partial,
  };
}

function fakeTodoist(
  tasks: TodoistTask[],
  reminders: TodoistReminder[] = [],
): TodoistPort & {
  comments: string[];
  updated: TodoistTask[];
  deleted: string[];
} {
  const comments: string[] = [];
  const updated: TodoistTask[] = [];
  const deleted: string[] = [];
  const unused = async (): Promise<Result<never>> => {
    throw new Error("não usado neste teste");
  };
  return {
    comments,
    updated,
    deleted,
    listTasks: async () => ok(tasks),
    getTask: unused,
    listTaskComments: async () => ok([] satisfies TodoistComment[]),
    listTaskReminders: async () => ok(reminders),
    addTaskComment: async (_id, content) => {
      comments.push(content);
      return ok(undefined);
    },
    updateTask: async (id, patch) => {
      const current = tasks.find((item) => item.id === id) ?? tasks[0];
      const next = {
        ...current!,
        content: patch.content ?? current!.content,
        labels: patch.labels ? [...patch.labels] : current!.labels,
      };
      updated.push(next);
      return ok(next);
    },
    updateTaskDue: unused,
    moveTask: unused,
    createTask: unused,
    completeTask: unused,
    deleteTask: async (id) => {
      deleted.push(id);
      return ok(undefined);
    },
    listProjects: async () =>
      ok([
        {
          id: "inbox",
          name: "Inbox",
          parentId: null,
          inboxProject: true,
        } satisfies TodoistProject,
      ]),
    createProject: unused,
    listLabels: async () =>
      ok([
        { id: "l1", name: "Event", color: "blue" } satisfies TodoistLabel,
        { id: "l2", name: "Pending", color: "red" },
      ]),
    createLabel: unused,
    listFilters: unused,
    createFilter: unused,
  };
}

function fakeNotion(): NotionPort & {
  upserts: UpsertUpcomingEventInput[];
  archived: string[];
} {
  const upserts: UpsertUpcomingEventInput[] = [];
  const archived: string[] = [];
  const unused = async (): Promise<Result<never>> => {
    throw new Error("não usado neste teste");
  };
  return {
    upserts,
    archived,
    listDatabasePages: unused,
    getPage: unused,
    upsertChildPage: unused,
    upsertUpcomingEvent: async (input) => {
      upserts.push(input);
      const previous = upserts.find(
        (item) =>
          item.title === input.title && item.startIso === input.startIso,
      );
      const calendarEventId =
        input.calendarEventId ?? previous?.calendarEventId ?? null;
      return ok({
        pageId: input.pageId ?? `page-${input.title}`,
        title: input.title,
        url: `https://www.notion.so/page-${encodeURIComponent(input.title)}`,
        calendarEventId,
        calendarHtmlLink: input.calendarHtmlLink,
      } satisfies UpcomingEventRecord);
    },
    archiveUpcomingEvent: async (pageId) => {
      archived.push(pageId);
      return ok(undefined);
    },
  };
}

function fakeCalendar(options?: {
  fail?: IntegrationError;
  events?: CalendarEvent[];
}): CalendarPort & {
  upserts: UpsertEventInput[];
  deleted: string[];
} {
  const upserts: UpsertEventInput[] = [];
  const deleted: string[] = [];
  const unused = async (): Promise<Result<never>> => {
    throw new Error("não usado neste teste");
  };
  return {
    upserts,
    deleted,
    listEvents: async () => ok(options?.events ?? []),
    upsertEvent: async (input) => {
      if (options?.fail) {
        return { ok: false, error: options.fail };
      }
      upserts.push(input);
      return ok({
        eventId: input.eventId ?? "cal-1",
        calendarId: input.calendarId,
        summary: input.summary,
        range: input.range,
        htmlLink: "https://www.google.com/calendar/event?eid=abc",
        allDay: false,
        description: input.description,
      } satisfies CalendarEvent);
    },
    deleteEvent: async (input) => {
      deleted.push(input.eventId);
      return ok(undefined);
    },
  };
}

function fakeLlm(reply = '{"title":"Evento","briefingMarkdown":"# Ok","recurrenceLabel":null,"recurrence":null}'): LlmPort {
  return {
    complete: async () => ok(reply),
  };
}
