import type { Result } from "../domain/result.js";
import type {
  CreateTodoistFilterInput,
  CreateTodoistLabelInput,
  CreateTodoistProjectInput,
  CreateTodoistTaskInput,
  ListTasksQuery,
  TodoistFilter,
  TodoistLabel,
  TodoistProject,
  TodoistTask,
  UpdateTodoistTaskPatch,
} from "../domain/schemas.js";

/**
 * Porta Todoist. O domínio não importa `@doist/todoist-sdk`.
 */
export interface TodoistPort {
  listTasks(query?: ListTasksQuery): Promise<Result<readonly TodoistTask[]>>;
  getTask(id: string): Promise<Result<TodoistTask>>;
  listTaskComments(taskId: string): Promise<Result<readonly string[]>>;
  addTaskComment(taskId: string, content: string): Promise<Result<void>>;
  updateTask(
    id: string,
    patch: UpdateTodoistTaskPatch,
  ): Promise<Result<TodoistTask>>;
  updateTaskDue(id: string, date: string): Promise<Result<TodoistTask>>;
  moveTask(id: string, projectId: string): Promise<Result<TodoistTask>>;
  createTask(input: CreateTodoistTaskInput): Promise<Result<TodoistTask>>;
  completeTask(id: string): Promise<Result<void>>;
  listProjects(): Promise<Result<readonly TodoistProject[]>>;
  createProject(
    input: CreateTodoistProjectInput,
  ): Promise<Result<TodoistProject>>;
  listLabels(): Promise<Result<readonly TodoistLabel[]>>;
  createLabel(input: CreateTodoistLabelInput): Promise<Result<TodoistLabel>>;
  listFilters(): Promise<Result<readonly TodoistFilter[]>>;
  createFilter(input: CreateTodoistFilterInput): Promise<Result<TodoistFilter>>;
}

export type ITodoistPort = TodoistPort;
