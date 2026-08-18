import "reflect-metadata";

import { inject, injectable } from "inversify";

import { err, ok, type Result } from "../result.js";
import {
  DailyPlanSchema,
  OrchestratorResultSchema,
  type GtdProject,
  type OrchestratorResult,
  type TodoistProjectRef,
} from "../schemas.js";
import type { CalendarPort } from "../../ports/CalendarPort.js";
import type { NotionPort } from "../../ports/NotionPort.js";
import type { TodoistPort } from "../../ports/TodoistPort.js";
import { TOKENS } from "../../ports/tokens.js";
import {
  LlmConfigError,
  civilDateNow,
  civilNowIso,
  createLifeOsGraph,
  emptyDailyPlan,
  type LifeOsGraph,
} from "./LifeOsGraph.js";

export interface ExecuteDailyTriageOptions {
  readonly dryRun?: boolean;
  readonly date?: string;
}

/**
 * Contrato do spec 02. `run` é o job CRON; `executeDailyTriage`
 * dispara o grafo LangGraph (`LifeOsGraph`).
 */
export interface IMasterOrchestrator {
  run(date: string): Promise<Result<OrchestratorResult>>;
  executeDailyTriage(
    options?: ExecuteDailyTriageOptions,
  ): Promise<Result<OrchestratorResult>>;
}

const GTD_PROJECTS: readonly GtdProject[] = [
  "vitalidade",
  "lar",
  "familia",
  "instituto",
];

@injectable()
export class MasterAgent implements IMasterOrchestrator {
  constructor(
    @inject(TOKENS.Todoist) private readonly todoist: TodoistPort,
    @inject(TOKENS.Notion) private readonly notion: NotionPort,
    @inject(TOKENS.GoogleCalendar) private readonly calendar: CalendarPort,
  ) {}

  async run(date: string): Promise<Result<OrchestratorResult>> {
    return this.executeDailyTriage({ date });
  }

  /**
   * Triagem diária: carrega portas → estado inicial → LifeOsGraph
   * (triage → specialist → builder) → persiste flex no CalendarPort.
   * `dryRun` pula mutações nas portas reais após o plano final.
   */
  async executeDailyTriage(
    options?: ExecuteDailyTriageOptions,
  ): Promise<Result<OrchestratorResult>> {
    const date = options?.date ?? civilDateNow();
    const dryRun = options?.dryRun === true;
    const generatedAt = { iso: civilNowIso() };

    const inboxResult = await this.todoist.listActions({
      date,
      front: "all",
    });
    if (!inboxResult.ok) {
      return inboxResult;
    }

    const specsResult = await this.notion.listActiveSpecs("all");
    if (!specsResult.ok) {
      return specsResult;
    }

    const kanbanResult = await this.notion.listKanban(date, "all");
    const occupiedResult = await this.calendar.listProtectedOccurrences(date);
    const ritesResult = await this.calendar.listInstitutoRites(date);
    const projects = await this.loadActiveProjects();

    const occupied = occupiedResult.ok ? occupiedResult.value : [];
    const rites = ritesResult.ok ? ritesResult.value : [];
    const kanban = kanbanResult.ok ? kanbanResult.value : [];

    let graph: LifeOsGraph;
    try {
      graph = createLifeOsGraph();
    } catch (cause: unknown) {
      if (cause instanceof LlmConfigError) {
        return err({
          provider: "llm",
          code: "unauthorized",
          message: cause.message,
          retryable: false,
          retryAfterMs: null,
          cause,
        });
      }
      throw cause;
    }

    let finalState;
    try {
      finalState = await graph.invoke({
        date,
        now: generatedAt,
        inbox: [...inboxResult.value],
        projects,
        specs: [...specsResult.value],
        kanban: [...kanban],
        occupied: [...occupied],
        rites: [...rites],
        plan: emptyDailyPlan(date, generatedAt),
      });
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

    const writtenEventIds: string[] = [];
    const skipped: string[] = [];
    let partial = !occupiedResult.ok;

    if (!occupiedResult.ok) {
      skipped.push(
        `busy_fallback: ${occupiedResult.error.message}; PagBank 09:00–18:00 hardcoded`,
      );
    }

    const pagbankIds = new Set(
      finalState.delegations
        .filter((row) => row.agentId === "ignore_pagbank")
        .map((row) => row.actionId),
    );
    const toPromote = new Set(finalState.todoistTodayIds);
    for (const block of finalState.plan.blocks) {
      if (block.gtdActionId) {
        toPromote.add(block.gtdActionId);
      }
    }
    const promotePayload = [...toPromote]
      .filter((id) => !pagbankIds.has(id))
      .map((id) => ({ id, date }));

    if (dryRun) {
      console.log("[DRY RUN ativado] - Ação de escrita evitada:", {
        upsertFlexEvent: finalState.calendarWrites,
        upsertDailyPlan: finalState.plan,
        applyKanbanMoves:
          finalState.plan.kanban.length > 0
            ? { date, moves: finalState.plan.kanban }
            : [],
        promoteToToday: promotePayload,
      });
      skipped.push("dry_run: escritas nas portas reais não executadas");
    } else {
      for (const write of finalState.calendarWrites) {
        const written = await this.calendar.upsertFlexEvent(write);
        if (written.ok) {
          writtenEventIds.push(written.value.eventId);
        } else {
          partial = true;
          skipped.push(written.error.message);
        }
      }

      const planPage = await this.notion.upsertDailyPlan(finalState.plan);
      if (!planPage.ok) {
        partial = true;
        skipped.push(planPage.error.message);
      }

      if (finalState.plan.kanban.length > 0) {
        const moves = await this.notion.applyKanbanMoves(
          date,
          finalState.plan.kanban,
        );
        if (!moves.ok) {
          partial = true;
          skipped.push(moves.error.message);
        }
      }

      const calendarOk =
        writtenEventIds.length === finalState.calendarWrites.length;
      if (calendarOk) {
        for (const payload of promotePayload) {
          const promoted = await this.todoist.promoteToToday(
            payload.id,
            payload.date,
          );
          if (!promoted.ok) {
            partial = true;
            skipped.push(promoted.error.message);
          }
        }
      } else {
        skipped.push("todoist_skipped: Calendar parcial");
      }
    }

    const plan = DailyPlanSchema.parse(finalState.plan);

    return ok(
      OrchestratorResultSchema.parse({
        plan,
        writtenEventIds,
        skipped,
        rejected: finalState.conflicts,
        partial,
      }),
    );
  }

  private async loadActiveProjects(): Promise<TodoistProjectRef[]> {
    const projects: TodoistProjectRef[] = [];
    for (const token of GTD_PROJECTS) {
      const resolved = await this.todoist.resolveProject(token);
      if (resolved.ok) {
        projects.push(resolved.value);
      }
    }
    return projects;
  }
}
