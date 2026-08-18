import type { Result } from "../domain/result.js";
import type {
  GtdAction,
  GtdProject,
  ListQuery,
  TodoistProjectRef,
} from "../domain/schemas.js";

/**
 * Porta GTD (Todoist). Inbox / próximas ações entram via `listActions`.
 * O domínio não importa `@doist/todoist-sdk`.
 */
export interface TodoistPort {
  /** Lê ações físicas da frente (inbox GTD + projeto). */
  listActions(query: ListQuery): Promise<Result<readonly GtdAction[]>>;

  getAction(id: string): Promise<Result<GtdAction>>;

  /**
   * Promove item existente para Hoje (due = date).
   * Proibido criar tarefa nova, mudar projeto, ou clonar cápsula.
   */
  promoteToToday(id: string, date: string): Promise<Result<GtdAction>>;

  /**
   * Completar ação física. Calendar nunca marca feito.
   * v0.1: o CRON NÃO completa tarefas.
   */
  complete(id: string): Promise<Result<void>>;

  resolveProject(
    token: GtdProject,
  ): Promise<Result<TodoistProjectRef>>;
}

/** Alias do contrato em `01-api-integrations.md`. */
export type ITodoistPort = TodoistPort;
