import type { Result } from "../domain/result.js";
import type { TodoistProject, TodoistTask } from "../domain/schemas.js";

/**
 * Porta Todoist. O domínio não importa `@doist/todoist-sdk`.
 */
export interface TodoistPort {
  listTasks(): Promise<Result<readonly TodoistTask[]>>;
  getTask(id: string): Promise<Result<TodoistTask>>;
  updateTaskDue(id: string, date: string): Promise<Result<TodoistTask>>;
  completeTask(id: string): Promise<Result<void>>;
  listProjects(): Promise<Result<readonly TodoistProject[]>>;
}

export type ITodoistPort = TodoistPort;
