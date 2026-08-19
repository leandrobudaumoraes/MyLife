import "reflect-metadata";

import { inject, injectable } from "inversify";

import { civilDateNow } from "../clock.js";
import { err, ok, type Result } from "../result.js";
import {
  InboxRunSchema,
  SmokeCheckSchema,
  type InboxRun,
  type IntegrationConfig,
  type SmokeCheck,
} from "../schemas.js";
import type { CalendarPort } from "../../ports/CalendarPort.js";
import type { LlmPort } from "../../ports/LlmPort.js";
import type { NotionPort } from "../../ports/NotionPort.js";
import type { TodoistPort } from "../../ports/TodoistPort.js";
import { TOKENS } from "../../ports/tokens.js";
import { createLifeOsGraph } from "./LifeOsGraph.js";
import { ensureGtd } from "../gtd/ensure.js";
import { processInbox } from "../gtd/processInbox.js";

/**
 * Fachada do Life OS: ensure GTD e processa a Inbox.
 */
@injectable()
export class LifeOs {
  constructor(
    @inject(TOKENS.Todoist) private readonly todoist: TodoistPort,
    @inject(TOKENS.Notion) private readonly notion: NotionPort,
    @inject(TOKENS.GoogleCalendar) private readonly calendar: CalendarPort,
    @inject(TOKENS.Llm) private readonly llm: LlmPort,
    @inject(TOKENS.Config) private readonly config: IntegrationConfig,
  ) {}

  async run(): Promise<Result<InboxRun>> {
    const ensured = await ensureGtd(this.todoist);
    if (!ensured.ok) {
      return ensured;
    }

    const processed = await processInbox({
      todoist: this.todoist,
      notion: this.notion,
      llm: this.llm,
      tree: ensured.value.tree,
      labelsCreated: ensured.value.labelsCreated,
      projectsCreated: ensured.value.projectsCreated,
    });
    if (!processed.ok) {
      return processed;
    }

    return ok(InboxRunSchema.parse(processed.value));
  }

  async smokeCheck(): Promise<Result<SmokeCheck>> {
    const date = civilDateNow();

    const projects = await this.todoist.listProjects();
    if (!projects.ok) {
      return projects;
    }

    const pages = await this.notion.listDatabasePages();
    if (!pages.ok) {
      return pages;
    }

    const calendarIds = [this.config.googleCalendarId];
    if (
      this.config.googleCalendarInstitutoId.length > 0 &&
      this.config.googleCalendarInstitutoId !== "instituto-mock"
    ) {
      calendarIds.push(this.config.googleCalendarInstitutoId);
    }

    let eventCount = 0;
    for (const calendarId of calendarIds) {
      const events = await this.calendar.listEvents({ date, calendarId });
      if (!events.ok) {
        return events;
      }
      eventCount += events.value.length;
    }

    const llmReply = await this.llm.complete("Responda só com a palavra ok.");
    if (!llmReply.ok) {
      return llmReply;
    }

    try {
      const graph = createLifeOsGraph(this.llm);
      const state = await graph.invoke({
        prompt: "Responda só com a palavra ok.",
        reply: "",
      });

      return ok(
        SmokeCheckSchema.parse({
          todoistProjects: projects.value.length,
          notionPages: pages.value.length,
          calendarEvents: eventCount,
          llmReply: llmReply.value,
          graphReply: state.reply,
        }),
      );
    } catch (cause: unknown) {
      return err({
        provider: "llm",
        code: "unavailable",
        message:
          cause instanceof Error
            ? cause.message
            : "Falha ao executar o grafo LangGraph",
        retryable: true,
        retryAfterMs: 400,
        cause,
      });
    }
  }
}
