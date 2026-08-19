import "reflect-metadata";

import {
  TodoistApi,
  TodoistArgumentError,
  TodoistRequestError,
  type GetTasksArgs,
  type PersonalProject,
  type Task,
  type WorkspaceProject,
} from "@doist/todoist-sdk";
import { inject, injectable } from "inversify";

import { err, ok, type Result } from "../../core/domain/result.js";
import {
  TodoistProjectSchema,
  TodoistTaskSchema,
  type IntegrationConfig,
  type IntegrationError,
  type TodoistProject,
  type TodoistTask,
} from "../../core/domain/schemas.js";
import type { TodoistPort } from "../../core/ports/TodoistPort.js";
import { TOKENS } from "../../core/ports/tokens.js";

@injectable()
export class TodoistAdapter implements TodoistPort {
  private readonly client: TodoistApi;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(@inject(TOKENS.Config) config: IntegrationConfig) {
    this.client = new TodoistApi(config.todoistToken);
  }

  async listTasks(): Promise<Result<readonly TodoistTask[]>> {
    const started = Date.now();
    try {
      const tasks = await this.collectTasks();
      const mapped = tasks.map(toTask);
      console.log("[TodoistAdapter.listTasks]", {
        ok: true,
        durationMs: Date.now() - started,
        count: mapped.length,
      });
      return ok(TodoistTaskSchema.array().parse(mapped));
    } catch (cause: unknown) {
      return this.fail("listTasks", started, cause);
    }
  }

  async getTask(id: string): Promise<Result<TodoistTask>> {
    const started = Date.now();
    try {
      const task = await this.withRetry(() => this.client.getTask(id));
      console.log("[TodoistAdapter.getTask]", {
        ok: true,
        durationMs: Date.now() - started,
        id,
      });
      return ok(toTask(task));
    } catch (cause: unknown) {
      return this.fail("getTask", started, cause);
    }
  }

  async updateTaskDue(
    id: string,
    date: string,
  ): Promise<Result<TodoistTask>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      try {
        await this.withRetry(() =>
          this.client.updateTask(id, { dueDate: date }),
        );
        return await this.getTask(id);
      } catch (cause: unknown) {
        return this.fail("updateTaskDue", started, cause);
      }
    });
  }

  async completeTask(id: string): Promise<Result<void>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      try {
        await this.withRetry(() => this.client.closeTask(id));
        console.log("[TodoistAdapter.completeTask]", {
          ok: true,
          durationMs: Date.now() - started,
          id,
        });
        return ok(undefined);
      } catch (cause: unknown) {
        return this.fail("completeTask", started, cause);
      }
    });
  }

  async listProjects(): Promise<Result<readonly TodoistProject[]>> {
    const started = Date.now();
    try {
      const [user, projects] = await Promise.all([
        this.withRetry(() => this.client.getUser()),
        this.collectProjects(),
      ]);
      const mapped = projects.map((project) =>
        TodoistProjectSchema.parse({
          id: project.id,
          name: project.name,
          inboxProject:
            project.id === user.inboxProjectId || isInboxProject(project),
        }),
      );
      console.log("[TodoistAdapter.listProjects]", {
        ok: true,
        durationMs: Date.now() - started,
        count: mapped.length,
      });
      return ok(mapped);
    } catch (cause: unknown) {
      return this.fail("listProjects", started, cause);
    }
  }

  private async collectTasks(args: GetTasksArgs = {}): Promise<Task[]> {
    const results: Task[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.withRetry(() =>
        this.client.getTasks(
          cursor ? { ...args, cursor, limit: 200 } : { ...args, limit: 200 },
        ),
      );
      results.push(...page.results);
      cursor = page.nextCursor;
    } while (cursor);
    return results;
  }

  private async collectProjects(): Promise<
    Array<PersonalProject | WorkspaceProject>
  > {
    const results: Array<PersonalProject | WorkspaceProject> = [];
    let cursor: string | null = null;
    do {
      const page = await this.withRetry(() =>
        this.client.getProjects(
          cursor ? { cursor, limit: 200 } : { limit: 200 },
        ),
      );
      results.push(...page.results);
      cursor = page.nextCursor;
    } while (cursor);
    return results;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (cause: unknown) {
        const mapped = mapTodoistError(cause);
        const maxAttempts =
          mapped.code === "rate_limited"
            ? 3
            : mapped.code === "conflict"
              ? 1
              : mapped.code === "timeout" || mapped.code === "unavailable"
                ? 2
                : 0;
        if (!mapped.retryable || attempt >= maxAttempts) {
          throw cause;
        }
        attempt += 1;
        const waitMs = mapped.retryAfterMs ?? (attempt === 1 ? 400 : 1600);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private fail(
    operation: string,
    started: number,
    cause: unknown,
  ): Result<never> {
    const error = mapTodoistError(cause);
    console.log("[TodoistAdapter]", {
      operation,
      ok: false,
      durationMs: Date.now() - started,
      code: error.code,
    });
    return err(error);
  }
}

function toTask(task: Task): TodoistTask {
  return TodoistTaskSchema.parse({
    id: task.id,
    content: task.content,
    projectId: task.projectId,
    sectionId: task.sectionId,
    labels: task.labels,
    dueDate: task.due?.date ?? null,
    dueDatetime: task.due?.datetime ?? null,
    isCompleted: task.checked,
    url: task.url,
  });
}

function isInboxProject(project: PersonalProject | WorkspaceProject): boolean {
  return "inboxProject" in project && project.inboxProject === true;
}

function mapTodoistError(cause: unknown): IntegrationError {
  if (cause instanceof TodoistRequestError) {
    const status = cause.httpStatusCode ?? 0;
    if (cause.isAuthenticationError() || status === 401) {
      return integrationError("unauthorized", cause.message, false, null, cause);
    }
    if (status === 403) {
      return integrationError(
        "forbidden_write",
        cause.message,
        false,
        null,
        cause,
      );
    }
    if (status === 404) {
      return integrationError("not_found", cause.message, false, null, cause);
    }
    if (status === 409) {
      return integrationError("conflict", cause.message, true, 400, cause);
    }
    if (status === 429) {
      return integrationError("rate_limited", cause.message, true, 1000, cause);
    }
    if (status === 408) {
      return integrationError("timeout", cause.message, true, 400, cause);
    }
    if (status >= 500) {
      return integrationError("unavailable", cause.message, true, 400, cause);
    }
    return integrationError("unavailable", cause.message, true, 400, cause);
  }

  if (cause instanceof TodoistArgumentError) {
    return integrationError("validation", cause.message, false, null, cause);
  }

  return integrationError(
    "unavailable",
    cause instanceof Error ? cause.message : "Falha na API Todoist",
    true,
    400,
    cause,
  );
}

function integrationError(
  code: IntegrationError["code"],
  message: string,
  retryable: boolean,
  retryAfterMs: number | null,
  cause: unknown,
): IntegrationError {
  return {
    provider: "todoist",
    code,
    message,
    retryable,
    retryAfterMs,
    cause,
  };
}
