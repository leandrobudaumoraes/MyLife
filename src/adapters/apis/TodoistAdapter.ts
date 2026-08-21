import "reflect-metadata";

import { randomUUID } from "node:crypto";

import {
  TodoistApi,
  TodoistArgumentError,
  TodoistRequestError,
  createCommand,
  type ColorKey,
  type GetTasksArgs,
  type PersonalProject,
  type Reminder,
  type Task,
  type WorkspaceProject,
} from "@doist/todoist-sdk";
import { inject, injectable } from "inversify";

import { err, ok, type Result } from "../../core/domain/result.js";
import {
  TodoistCommentSchema,
  TodoistFilterSchema,
  TodoistLabelSchema,
  TodoistProjectSchema,
  TodoistReminderSchema,
  TodoistTaskSchema,
  type CreateTodoistFilterInput,
  type CreateTodoistLabelInput,
  type CreateTodoistProjectInput,
  type CreateTodoistTaskInput,
  type IntegrationConfig,
  type IntegrationError,
  type ListTasksQuery,
  type TodoistComment,
  type TodoistFilter,
  type TodoistLabel,
  type TodoistProject,
  type TodoistReminder,
  type TodoistTask,
  type UpdateTodoistTaskPatch,
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

  async listTasks(
    query?: ListTasksQuery,
  ): Promise<Result<readonly TodoistTask[]>> {
    const started = Date.now();
    try {
      const args: GetTasksArgs = query ? { projectId: query.projectId } : {};
      const tasks = await this.collectTasks(args);
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

  async deleteTask(id: string): Promise<Result<void>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      try {
        await this.withRetry(() => this.client.deleteTask(id));
        console.log("[TodoistAdapter.deleteTask]", {
          ok: true,
          durationMs: Date.now() - started,
          id,
        });
        return ok(undefined);
      } catch (cause: unknown) {
        return this.fail("deleteTask", started, cause);
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
          parentId: "parentId" in project ? project.parentId : null,
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

  async createProject(
    input: CreateTodoistProjectInput,
  ): Promise<Result<TodoistProject>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      try {
        const created = await this.withRetry(() =>
          this.client.addProject(
            input.parentId
              ? { name: input.name, parentId: input.parentId }
              : { name: input.name },
          ),
        );
        const project = TodoistProjectSchema.parse({
          id: created.id,
          name: created.name,
          parentId: "parentId" in created ? created.parentId : null,
          inboxProject: isInboxProject(created),
        });
        console.log("[TodoistAdapter.createProject]", {
          ok: true,
          durationMs: Date.now() - started,
          name: project.name,
        });
        return ok(project);
      } catch (cause: unknown) {
        return this.fail("createProject", started, cause);
      }
    });
  }

  async listLabels(): Promise<Result<readonly TodoistLabel[]>> {
    const started = Date.now();
    try {
      const labels = await this.collectLabels();
      const mapped = labels.map((label) =>
        TodoistLabelSchema.parse({
          id: label.id,
          name: label.name,
          color: label.color,
        }),
      );
      console.log("[TodoistAdapter.listLabels]", {
        ok: true,
        durationMs: Date.now() - started,
        count: mapped.length,
      });
      return ok(mapped);
    } catch (cause: unknown) {
      return this.fail("listLabels", started, cause);
    }
  }

  async createLabel(
    input: CreateTodoistLabelInput,
  ): Promise<Result<TodoistLabel>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      try {
        const created = await this.withRetry(() =>
          this.client.addLabel({
            name: input.name,
            color: asColorKey(input.color),
          }),
        );
        const label = TodoistLabelSchema.parse({
          id: created.id,
          name: created.name,
          color: created.color,
        });
        console.log("[TodoistAdapter.createLabel]", {
          ok: true,
          durationMs: Date.now() - started,
          name: label.name,
        });
        return ok(label);
      } catch (cause: unknown) {
        return this.fail("createLabel", started, cause);
      }
    });
  }

  async listFilters(): Promise<Result<readonly TodoistFilter[]>> {
    const started = Date.now();
    try {
      const filters = await this.collectFilters();
      console.log("[TodoistAdapter.listFilters]", {
        ok: true,
        durationMs: Date.now() - started,
        count: filters.length,
      });
      return ok(filters);
    } catch (cause: unknown) {
      return this.fail("listFilters", started, cause);
    }
  }

  async createFilter(
    input: CreateTodoistFilterInput,
  ): Promise<Result<TodoistFilter>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      try {
        await this.withRetry(() =>
          this.client.sync({
            commands: [
              createCommand(
                "filter_add",
                {
                  name: input.name,
                  query: input.query,
                  color: asColorKey(input.color),
                  isFavorite: true,
                },
                randomUUID(),
              ),
            ],
            resourceTypes: ["filters"],
            syncToken: "*",
          }),
        );
        const filters = await this.collectFilters();
        const created = filters.find((filter) => filter.name === input.name);
        if (!created) {
          return err({
            provider: "todoist",
            code: "validation",
            message: `Filtro ${input.name} não materializou depois do sync.`,
            retryable: false,
            retryAfterMs: null,
            cause: null,
          });
        }
        console.log("[TodoistAdapter.createFilter]", {
          ok: true,
          durationMs: Date.now() - started,
          name: created.name,
        });
        return ok(created);
      } catch (cause: unknown) {
        return this.fail("createFilter", started, cause);
      }
    });
  }

  async addTaskComment(
    taskId: string,
    content: string,
  ): Promise<Result<void>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      try {
        await this.withRetry(() =>
          this.client.addComment({ taskId, content }),
        );
        console.log("[TodoistAdapter.addTaskComment]", {
          ok: true,
          durationMs: Date.now() - started,
          taskId,
        });
        return ok(undefined);
      } catch (cause: unknown) {
        return this.fail("addTaskComment", started, cause);
      }
    });
  }

  async listTaskComments(
    taskId: string,
  ): Promise<Result<readonly TodoistComment[]>> {
    const started = Date.now();
    try {
      const comments: TodoistComment[] = [];
      let cursor: string | null = null;
      do {
        const page = await this.withRetry(() =>
          this.client.getComments(
            cursor
              ? { taskId, cursor, limit: 200 }
              : { taskId, limit: 200 },
          ),
        );
        comments.push(
          ...page.results.map((comment) =>
            TodoistCommentSchema.parse({
              content: comment.content,
              attachmentName:
                comment.fileAttachment?.fileName ??
                comment.fileAttachment?.title ??
                null,
              attachmentUrl:
                comment.fileAttachment?.fileUrl ??
                comment.fileAttachment?.url ??
                null,
            }),
          ),
        );
        cursor = page.nextCursor;
      } while (cursor);
      console.log("[TodoistAdapter.listTaskComments]", {
        ok: true,
        durationMs: Date.now() - started,
        taskId,
        count: comments.length,
      });
      return ok(comments);
    } catch (cause: unknown) {
      return this.fail("listTaskComments", started, cause);
    }
  }

  async listTaskReminders(
    taskId: string,
  ): Promise<Result<readonly TodoistReminder[]>> {
    const started = Date.now();
    try {
      const reminders: TodoistReminder[] = [];
      let cursor: string | null = null;
      do {
        const page = await this.withRetry(() =>
          this.client.getReminders(
            cursor
              ? { taskId, cursor, limit: 200 }
              : { taskId, limit: 200 },
          ),
        );
        reminders.push(
          ...page.results.flatMap((reminder) => {
            const mapped = toReminder(reminder);
            return mapped ? [mapped] : [];
          }),
        );
        cursor = page.nextCursor;
      } while (cursor);
      console.log("[TodoistAdapter.listTaskReminders]", {
        ok: true,
        durationMs: Date.now() - started,
        taskId,
        count: reminders.length,
      });
      return ok(reminders);
    } catch (cause: unknown) {
      return this.fail("listTaskReminders", started, cause);
    }
  }

  async updateTask(
    id: string,
    patch: UpdateTodoistTaskPatch,
  ): Promise<Result<TodoistTask>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      try {
        await this.withRetry(() =>
          this.client.updateTask(id, {
            ...(patch.content === undefined ? {} : { content: patch.content }),
            ...(patch.labels === undefined ? {} : { labels: [...patch.labels] }),
          }),
        );
        return await this.getTask(id);
      } catch (cause: unknown) {
        return this.fail("updateTask", started, cause);
      }
    });
  }

  async moveTask(
    id: string,
    projectId: string,
  ): Promise<Result<TodoistTask>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      try {
        await this.withRetry(() => this.client.moveTask(id, { projectId }));
        return await this.getTask(id);
      } catch (cause: unknown) {
        return this.fail("moveTask", started, cause);
      }
    });
  }

  async createTask(
    input: CreateTodoistTaskInput,
  ): Promise<Result<TodoistTask>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      try {
        const created = await this.withRetry(() =>
          this.client.addTask({
            content: input.content,
            projectId: input.projectId,
            labels: [...input.labels],
          }),
        );
        console.log("[TodoistAdapter.createTask]", {
          ok: true,
          durationMs: Date.now() - started,
          id: created.id,
        });
        return ok(toTask(created));
      } catch (cause: unknown) {
        return this.fail("createTask", started, cause);
      }
    });
  }

  private async collectLabels(): Promise<TodoistLabel[]> {
    const results: TodoistLabel[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.withRetry(() =>
        this.client.getLabels(
          cursor ? { cursor, limit: 200 } : { limit: 200 },
        ),
      );
      results.push(
        ...page.results.map((label) =>
          TodoistLabelSchema.parse({
            id: label.id,
            name: label.name,
            color: label.color,
          }),
        ),
      );
      cursor = page.nextCursor;
    } while (cursor);
    return results;
  }

  private async collectFilters(): Promise<TodoistFilter[]> {
    const response = await this.withRetry(() =>
      this.client.sync({
        resourceTypes: ["filters"],
        syncToken: "*",
      }),
    );
    return (response.filters ?? []).flatMap((filter) => {
      const parsed = TodoistFilterSchema.safeParse({
        id: String(filter.id),
        name: filter.name,
        query: filter.query,
      });
      return parsed.success && filter.isDeleted !== true ? [parsed.data] : [];
    });
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
    description: task.description,
    projectId: task.projectId,
    sectionId: task.sectionId,
    labels: task.labels,
    dueDate: task.due?.date ?? null,
    dueDatetime: task.due?.datetime ?? null,
    dueString: task.due?.string ?? null,
    isRecurring: task.due?.isRecurring ?? false,
    priority: task.priority,
    durationMinutes:
      task.duration?.unit === "minute" && task.duration.amount > 0
        ? task.duration.amount
        : null,
    isCompleted: task.checked,
    url: task.url,
  });
}

function toReminder(reminder: Reminder): TodoistReminder | null {
  if (reminder.isDeleted || reminder.type === "location") {
    return null;
  }
  const dueDatetime =
    reminder.type === "absolute" || reminder.type === "relative"
      ? dueDatetimeOf(reminder)
      : null;
  const minuteOffset =
    reminder.type === "relative" ? reminder.minuteOffset : null;
  return TodoistReminderSchema.parse({
    type: reminder.type,
    minuteOffset,
    dueDatetime,
    service: reminderService(reminder),
  });
}

function dueDatetimeOf(reminder: Reminder): string | null {
  if (reminder.type !== "absolute" && reminder.type !== "relative") {
    return null;
  }
  const due = reminder.due;
  if (!due) {
    return null;
  }
  if (due.datetime && due.datetime.includes("T")) {
    return due.datetime;
  }
  if (due.date.includes("T")) {
    return due.date;
  }
  return null;
}

function reminderService(reminder: Reminder): "push" | "email" | null {
  if (!("service" in reminder)) {
    return null;
  }
  const service = reminder.service;
  if (service === "email" || service === "push") {
    return service;
  }
  return null;
}

function isInboxProject(project: PersonalProject | WorkspaceProject): boolean {
  return "inboxProject" in project && project.inboxProject === true;
}

function asColorKey(color: string): ColorKey {
  return color as ColorKey;
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
