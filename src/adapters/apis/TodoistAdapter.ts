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

import {
  FRONT_CATALOG,
  GTD_LIST_NAMES,
  GTD_PROJECT_NAMES,
  GTD_PROJECT_TO_FRONT,
} from "../../core/domain/catalog.js";
import { err, ok, type Result } from "../../core/domain/result.js";
import {
  GtdActionSchema,
  TodoistProjectRefSchema,
  TodoistTaskSnapshotSchema,
  type ContextTag,
  type FrontId,
  type GtdAction,
  type GtdList,
  type GtdProject,
  type IntegrationConfig,
  type IntegrationError,
  type ListQuery,
  type TodoistProjectRef,
  type TodoistTaskSnapshot,
} from "../../core/domain/schemas.js";
import type { TodoistPort } from "../../core/ports/TodoistPort.js";
import { TOKENS } from "../../core/ports/tokens.js";

const CONTEXT_BY_LABEL: Readonly<Record<string, ContextTag>> = {
  casa: "casa",
  rua: "rua",
  carro: "carro",
  celular: "celular",
  alta: "alta",
  baixa: "baixa",
  compra: "compra",
};

const PILAR_LABELS = new Set([
  "mim",
  "casa",
  "instituto",
  "loja",
  "família",
  "familia",
  "saude",
  "saúde",
  "lar",
  "vitalidade",
]);

const GTD_LISTS = Object.keys(GTD_LIST_NAMES) as GtdList[];
const GTD_PROJECTS = Object.keys(GTD_PROJECT_NAMES) as GtdProject[];

interface ProjectCatalog {
  readonly inboxProjectId: string;
  readonly byId: ReadonlyMap<string, CatalogProject>;
}

interface CatalogProject {
  readonly id: string;
  readonly name: string;
  readonly inboxProject: boolean;
  readonly list: GtdList | null;
  readonly gtdProject: GtdProject | null;
}

@injectable()
export class TodoistAdapter implements TodoistPort {
  private readonly client: TodoistApi;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(@inject(TOKENS.Config) config: IntegrationConfig) {
    this.client = new TodoistApi(config.todoistToken);
  }

  async listActions(
    query: ListQuery,
  ): Promise<Result<readonly GtdAction[]>> {
    const started = Date.now();
    try {
      const catalog = await this.loadProjectCatalog();
      const tasks =
        query.front === "all"
          ? await this.fetchInboxAndActionableTasks(catalog)
          : await this.fetchFrontTasks(query.front, catalog);

      const actions = tasks.flatMap((task) => {
        const action = this.toGtdAction(task, catalog);
        return action ? [action] : [];
      });

      console.log("[TodoistAdapter.listActions]", {
        ok: true,
        durationMs: Date.now() - started,
        front: query.front,
        count: actions.length,
      });

      return ok(GtdActionSchema.array().parse(actions));
    } catch (cause: unknown) {
      return this.fail("listActions", started, cause);
    }
  }

  async getAction(id: string): Promise<Result<GtdAction>> {
    const started = Date.now();
    try {
      const [task, catalog] = await Promise.all([
        this.withRetry(() => this.client.getTask(id)),
        this.loadProjectCatalog(),
      ]);
      const action = this.toGtdAction(task, catalog);
      if (!action) {
        return err({
          provider: "todoist",
          code: "validation",
          message: `Ação ${id} não é física; descartada`,
          retryable: false,
          retryAfterMs: null,
          cause: null,
        });
      }
      console.log("[TodoistAdapter.getAction]", {
        ok: true,
        durationMs: Date.now() - started,
        id,
      });
      return ok(action);
    } catch (cause: unknown) {
      return this.fail("getAction", started, cause);
    }
  }

  async promoteToToday(
    id: string,
    date: string,
  ): Promise<Result<GtdAction>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      try {
        await this.withRetry(() =>
          this.client.updateTask(id, { dueDate: date }),
        );
        return await this.getAction(id);
      } catch (cause: unknown) {
        return this.fail("promoteToToday", started, cause);
      }
    });
  }

  async complete(id: string): Promise<Result<void>> {
    return this.enqueueWrite(async () => {
      const started = Date.now();
      console.log("[TodoistAdapter.complete] CRON v0.1 não deveria chamar", {
        id,
      });
      try {
        await this.withRetry(() => this.client.closeTask(id));
        console.log("[TodoistAdapter.complete]", {
          ok: true,
          durationMs: Date.now() - started,
        });
        return ok(undefined);
      } catch (cause: unknown) {
        return this.fail("complete", started, cause);
      }
    });
  }

  async resolveProject(
    token: GtdProject,
  ): Promise<Result<TodoistProjectRef>> {
    const started = Date.now();
    try {
      const catalog = await this.loadProjectCatalog();
      const found = [...catalog.byId.values()].find(
        (project) => project.gtdProject === token,
      );
      if (!found) {
        return err({
          provider: "todoist",
          code: "not_found",
          message: `Projeto ${GTD_PROJECT_NAMES[token]} não encontrado`,
          retryable: false,
          retryAfterMs: null,
          cause: null,
        });
      }
      console.log("[TodoistAdapter.resolveProject]", {
        ok: true,
        durationMs: Date.now() - started,
        token,
      });
      return ok(
        TodoistProjectRefSchema.parse({ id: found.id, name: found.name }),
      );
    } catch (cause: unknown) {
      return this.fail("resolveProject", started, cause);
    }
  }

  /**
   * Inbox GTD: projeto Inbox nativo do Todoist (captura ainda sem frente).
   */
  private async fetchInboxTasks(inboxProjectId: string): Promise<Task[]> {
    return this.collectTasks({ projectId: inboxProjectId });
  }

  private async fetchInboxAndActionableTasks(
    catalog: ProjectCatalog,
  ): Promise<Task[]> {
    const [inbox, all] = await Promise.all([
      this.fetchInboxTasks(catalog.inboxProjectId),
      this.collectTasks(),
    ]);
    const seen = new Set(inbox.map((task) => task.id));
    const rest = all.filter((task) => {
      if (seen.has(task.id)) {
        return false;
      }
      const project = catalog.byId.get(task.projectId);
      return project?.list !== "encubar" && project?.list !== "arquivar";
    });
    return [...inbox, ...rest];
  }

  private async fetchFrontTasks(
    front: FrontId,
    catalog: ProjectCatalog,
  ): Promise<Task[]> {
    const token = FRONT_CATALOG[front].gtdProject;
    if (!token) {
      return [];
    }
    const project = [...catalog.byId.values()].find(
      (entry) => entry.gtdProject === token,
    );
    if (!project) {
      return [];
    }
    return this.collectTasks({ projectId: project.id });
  }

  private async loadProjectCatalog(): Promise<ProjectCatalog> {
    const [user, projects] = await Promise.all([
      this.withRetry(() => this.client.getUser()),
      this.collectProjects(),
    ]);

    const byId = new Map<string, CatalogProject>();
    for (const project of projects) {
      byId.set(project.id, classifyProject(project, user.inboxProjectId));
    }

    return { inboxProjectId: user.inboxProjectId, byId };
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

  private toGtdAction(
    task: Task,
    catalog: ProjectCatalog,
  ): GtdAction | null {
    const snapshot = toSnapshot(task);
    if (snapshot.isCompleted) {
      return null;
    }

    const title = snapshot.content.trim();
    if (!isPhysicalAction(title)) {
      console.warn("[TodoistAdapter] descartada (não física)", {
        id: snapshot.id,
        title: title.slice(0, 80),
      });
      return null;
    }

    const project = catalog.byId.get(snapshot.projectId);
    const list: GtdList = project?.list ?? "proximas_acoes";

    if (list === "encubar" || list === "arquivar") {
      return null;
    }

    const gtdProject = project?.gtdProject ?? null;
    const front = gtdProject ? GTD_PROJECT_TO_FRONT[gtdProject] : null;

    return GtdActionSchema.parse({
      id: snapshot.id,
      title,
      front,
      project: gtdProject,
      list,
      due: dueOf(snapshot),
      contexts: contextsOf(snapshot.labels),
      physical: true,
      url: snapshot.url,
    });
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

function toSnapshot(task: Task): TodoistTaskSnapshot {
  return TodoistTaskSnapshotSchema.parse({
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

function dueOf(
  snapshot: TodoistTaskSnapshot,
): { readonly iso: string } | null {
  if (snapshot.dueDatetime) {
    return { iso: snapshot.dueDatetime };
  }
  if (snapshot.dueDate) {
    return { iso: `${snapshot.dueDate}T06:00:00-03:00` };
  }
  return null;
}

function contextsOf(labels: readonly string[]): ContextTag[] {
  const contexts: ContextTag[] = [];
  for (const label of labels) {
    const key = fold(label);
    if (PILAR_LABELS.has(key)) {
      continue;
    }
    const context = CONTEXT_BY_LABEL[key];
    if (context && !contexts.includes(context)) {
      contexts.push(context);
    }
  }
  return contexts;
}

function isPhysicalAction(title: string): boolean {
  if (title.length < 3) {
    return false;
  }
  return !/controle de atividades|^controle\b/i.test(title);
}

function classifyProject(
  project: PersonalProject | WorkspaceProject,
  inboxProjectId: string,
): CatalogProject {
  const inboxProject =
    project.id === inboxProjectId || isInboxProject(project);
  return {
    id: project.id,
    name: project.name,
    inboxProject,
    list: inboxProject ? "proximas_acoes" : matchGtdList(project.name),
    gtdProject: matchGtdProject(project.name),
  };
}

function isInboxProject(project: PersonalProject | WorkspaceProject): boolean {
  return "inboxProject" in project && project.inboxProject === true;
}

function matchGtdList(name: string): GtdList | null {
  const folded = fold(stripEmoji(name));
  for (const token of GTD_LISTS) {
    if (folded === fold(stripEmoji(GTD_LIST_NAMES[token]))) {
      return token;
    }
  }
  return null;
}

function matchGtdProject(name: string): GtdProject | null {
  const folded = fold(stripEmoji(name));
  for (const token of GTD_PROJECTS) {
    if (folded === fold(stripEmoji(GTD_PROJECT_NAMES[token]))) {
      return token;
    }
  }
  return null;
}

function stripEmoji(value: string): string {
  return value.replace(/\p{Extended_Pictographic}/gu, "").trim();
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
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
