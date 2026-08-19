import assert from "node:assert/strict";
import { test } from "node:test";

import { ok, type Result } from "../result.js";
import type {
  CreateTodoistLabelInput,
  CreateTodoistProjectInput,
  CreateTodoistTaskInput,
  IntegrationError,
  ListTasksQuery,
  TodoistLabel,
  TodoistProject,
  TodoistTask,
  UpdateTodoistTaskPatch,
} from "../schemas.js";
import type { TodoistPort } from "../../ports/TodoistPort.js";
import { LABEL_CATALOG } from "./catalog.js";
import { ensureGtd } from "./ensure.js";

test("ensure cria pasta, listas, pilares e o catálogo de etiquetas inclusive Project", async () => {
  const todoist = new MemoryTodoist();
  const result = await ensureGtd(todoist);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const names = todoist.projects.map((project) => project.name);
  assert.ok(names.includes("📁 Projetos"));
  assert.ok(names.includes("⏩ Próximas ações"));
  assert.ok(names.includes("🩺 Saúde"));

  const labelNames = todoist.labels.map((label) => label.name);
  for (const spec of LABEL_CATALOG) {
    assert.ok(labelNames.includes(spec.name), `faltou ${spec.name}`);
  }
  assert.ok(result.value.labelsCreated.includes("Project"));

  const again = await ensureGtd(todoist);
  assert.equal(again.ok, true);
  if (!again.ok) {
    return;
  }
  assert.deepEqual(again.value.labelsCreated, []);
  assert.deepEqual(again.value.projectsCreated, []);
});

class MemoryTodoist implements TodoistPort {
  projects: TodoistProject[] = [
    {
      id: "inbox",
      name: "Inbox",
      parentId: null,
      inboxProject: true,
    },
  ];
  labels: TodoistLabel[] = [];
  private seq = 1;

  async listTasks(
    _query?: ListTasksQuery,
  ): Promise<Result<readonly TodoistTask[]>> {
    return ok([]);
  }

  async getTask(_id: string): Promise<Result<TodoistTask>> {
    return fail("not_found", "sem tarefa");
  }

  async listTaskComments(_taskId: string): Promise<Result<readonly string[]>> {
    return ok([]);
  }

  async updateTask(
    _id: string,
    _patch: UpdateTodoistTaskPatch,
  ): Promise<Result<TodoistTask>> {
    return fail("not_found", "sem tarefa");
  }

  async updateTaskDue(
    _id: string,
    _date: string,
  ): Promise<Result<TodoistTask>> {
    return fail("not_found", "sem tarefa");
  }

  async moveTask(
    _id: string,
    _projectId: string,
  ): Promise<Result<TodoistTask>> {
    return fail("not_found", "sem tarefa");
  }

  async createTask(
    _input: CreateTodoistTaskInput,
  ): Promise<Result<TodoistTask>> {
    return fail("not_found", "sem tarefa");
  }

  async completeTask(_id: string): Promise<Result<void>> {
    return ok(undefined);
  }

  async listProjects(): Promise<Result<readonly TodoistProject[]>> {
    return ok(this.projects);
  }

  async createProject(
    input: CreateTodoistProjectInput,
  ): Promise<Result<TodoistProject>> {
    const project: TodoistProject = {
      id: `p${this.seq}`,
      name: input.name,
      parentId: input.parentId,
      inboxProject: false,
    };
    this.seq += 1;
    this.projects.push(project);
    return ok(project);
  }

  async listLabels(): Promise<Result<readonly TodoistLabel[]>> {
    return ok(this.labels);
  }

  async createLabel(
    input: CreateTodoistLabelInput,
  ): Promise<Result<TodoistLabel>> {
    const label: TodoistLabel = {
      id: `l${this.seq}`,
      name: input.name,
      color: input.color,
    };
    this.seq += 1;
    this.labels.push(label);
    return ok(label);
  }
}

function fail(code: IntegrationError["code"], message: string): Result<never> {
  return {
    ok: false,
    error: {
      provider: "todoist",
      code,
      message,
      retryable: false,
      retryAfterMs: null,
      cause: null,
    },
  };
}
