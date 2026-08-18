import type { Result } from "../domain/result.js";
import type {
  DailyPlan,
  DailyPlanPage,
  FrontId,
  KanbanCard,
  KanbanMove,
  NotionHubRef,
  NotionSpecRef,
} from "../domain/schemas.js";

/**
 * Porta PARA + Kanban + Specs (Notion).
 * `applyKanbanMoves` é a atualização de status (inbox → next → timeblocked → done).
 */
export interface NotionPort {
  listActiveSpecs(
    front: FrontId | "all",
  ): Promise<Result<readonly NotionSpecRef[]>>;

  getSpecByCalendarSeries(seriesId: string): Promise<Result<NotionSpecRef>>;

  listKanban(
    date: string,
    front: FrontId | "all",
  ): Promise<Result<readonly KanbanCard[]>>;

  /** Atualiza coluna Kanban/PARA de cards existentes. Não inventa card. */
  applyKanbanMoves(
    date: string,
    moves: readonly KanbanMove[],
  ): Promise<Result<readonly KanbanCard[]>>;

  /**
   * Upsert da página do plano do dia. Idempotente por `date`.
   * Não cria spec de bloco. Não altera hubs.
   */
  upsertDailyPlan(plan: DailyPlan): Promise<Result<DailyPlanPage>>;

  getHub(front: FrontId): Promise<Result<NotionHubRef>>;
}

/** Alias do contrato em `01-api-integrations.md`. */
export type INotionPort = NotionPort;
