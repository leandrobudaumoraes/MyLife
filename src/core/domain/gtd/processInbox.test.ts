import assert from "node:assert/strict";
import { test } from "node:test";

import type { LlmPort } from "../../ports/LlmPort.js";
import type { NotionPort } from "../../ports/NotionPort.js";
import type { TodoistPort } from "../../ports/TodoistPort.js";
import { ok, type Result } from "../result.js";
import type {
  CreateProjectTaskInput,
  CreateTodoistLabelInput,
  CreateTodoistProjectInput,
  CreateTodoistTaskInput,
  ListTasksQuery,
  NotionPage,
  ProjectTaskBoard,
  TodoistLabel,
  TodoistProject,
  TodoistTask,
  UpdateTodoistTaskPatch,
  UpsertChildPageInput,
  UpsertProjectPageInput,
} from "../schemas.js";
import type { GtdTree } from "./ensure.js";
import { processInbox } from "./processInbox.js";

const tree: GtdTree = {
  inboxId: "inbox",
  nextActionsId: "next",
  incubateId: "maybe",
  archiveId: "archive",
  projectsFolderId: "folder",
};

test("item Project vira projeto PARA, DOING no Todoist e kanban no Notion", async () => {
  const todoist = new MemoryTodoist([
    task({
      id: "t1",
      content: "preciso organizar o instituto essa semana",
      labels: ["Project"],
    }),
  ]);
  const notion = new MemoryNotion();
  const llm = new ScriptedLlm([
    JSON.stringify({
      insufficient: false,
      projectName: "Normalizar o instituto",
      select: "Instituto",
      doingLabels: ["Casa"],
      tasks: [
        { title: "Listar o que está atrasado no instituto", column: "DOING" },
        { title: "Agendar revisão com a coordenação", column: "TO DO" },
      ],
    }),
  ]);

  const result = await processInbox({ todoist, notion, llm, tree });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.processed.length, 1);
  assert.equal(result.value.processed[0]?.routing, "Project");

  const para = todoist.projects.find(
    (project) => project.name === "Normalizar o instituto",
  );
  assert.ok(para);
  const doing = todoist.tasks.find((item) => item.id === "t1");
  assert.equal(doing?.projectId, para?.id);
  assert.ok(doing?.labels.includes("Doing"));
  assert.ok(doing?.labels.includes("Casa"));
  assert.equal(doing?.content, "Listar o que está atrasado no instituto");
  assert.equal(todoist.tasks.filter((item) => item.projectId === para?.id).length, 2);
  assert.equal(notion.pages.length, 1);
  assert.equal(notion.cards.length, 2);
});

test("Next move para Próximas ações e tira a etiqueta de roteamento", async () => {
  const todoist = new MemoryTodoist([
    task({
      id: "t2",
      content: "ligar maria nilda",
      labels: ["Next"],
    }),
  ]);
  const result = await processInbox({
    todoist,
    notion: new MemoryNotion(),
    llm: new ScriptedLlm([
      JSON.stringify({
        title: "Ligar para Maria Nilda perguntar avaliação TDAH",
        labels: ["Celular"],
      }),
    ]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const moved = todoist.tasks[0];
  assert.equal(moved?.projectId, "next");
  assert.equal(moved?.labels.includes("Next"), false);
  assert.ok(moved?.labels.includes("Celular"));
});

function task(input: {
  readonly id: string;
  readonly content: string;
  readonly labels: string[];
}): TodoistTask {
  return {
    id: input.id,
    content: input.content,
    description: "",
    projectId: "inbox",
    sectionId: null,
    labels: input.labels,
    dueDate: null,
    dueDatetime: null,
    isCompleted: false,
    url: `https://todoist.com/showTask?id=${input.id}`,
  };
}

class ScriptedLlm implements LlmPort {
  constructor(private readonly replies: string[]) {}

  async complete(_prompt: string): Promise<Result<string>> {
    const reply = this.replies.shift();
    return ok(reply ?? "{}");
  }
}

class MemoryNotion implements NotionPort {
  pages: NotionPage[] = [];
  cards: Array<{ title: string; column: string }> = [];

  async listDatabasePages(): Promise<Result<readonly NotionPage[]>> {
    return ok(this.pages);
  }

  async getPage(pageId: string): Promise<Result<NotionPage>> {
    const page = this.pages.find((item) => item.pageId === pageId);
    return page ? ok(page) : ok(this.pages[0] ?? emptyPage());
  }

  async upsertChildPage(
    _input: UpsertChildPageInput,
  ): Promise<Result<NotionPage>> {
    return ok(emptyPage());
  }

  async upsertProjectPage(
    input: UpsertProjectPageInput,
  ): Promise<Result<NotionPage>> {
    const page: NotionPage = {
      pageId: "np1",
      title: input.title,
      url: "https://notion.so/np1",
    };
    this.pages = [page];
    return ok(page);
  }

  async ensureProjectTaskBoard(
    _pageId: string,
  ): Promise<Result<ProjectTaskBoard>> {
    return ok({ dataSourceId: "ds1", existingTitles: [] });
  }

  async createProjectTask(
    input: CreateProjectTaskInput,
  ): Promise<Result<NotionPage>> {
    this.cards.push({ title: input.title, column: input.column });
    return ok({
      pageId: `c${this.cards.length}`,
      title: input.title,
      url: "https://notion.so/c",
    });
  }
}

class MemoryTodoist implements TodoistPort {
  projects: TodoistProject[] = [
    { id: "inbox", name: "Inbox", parentId: null, inboxProject: true },
    {
      id: "next",
      name: "⏩ Próximas ações",
      parentId: null,
      inboxProject: false,
    },
    { id: "maybe", name: "💤 Encubar", parentId: null, inboxProject: false },
    { id: "archive", name: "📌 Arquivar", parentId: null, inboxProject: false },
    {
      id: "folder",
      name: "📁 Projetos",
      parentId: null,
      inboxProject: false,
    },
  ];
  labels: TodoistLabel[] = [];
  private seq = 10;

  constructor(public tasks: TodoistTask[]) {}

  async listTasks(
    query?: ListTasksQuery,
  ): Promise<Result<readonly TodoistTask[]>> {
    if (!query) {
      return ok(this.tasks);
    }
    return ok(this.tasks.filter((item) => item.projectId === query.projectId));
  }

  async getTask(id: string): Promise<Result<TodoistTask>> {
    const found = this.tasks.find((item) => item.id === id);
    return found ? ok(found) : ok(this.tasks[0] ?? task({ id, content: "", labels: [] }));
  }

  async listTaskComments(_taskId: string): Promise<Result<readonly string[]>> {
    return ok(["urgente para o sábado"]);
  }

  async updateTask(
    id: string,
    patch: UpdateTodoistTaskPatch,
  ): Promise<Result<TodoistTask>> {
    this.tasks = this.tasks.map((item) => {
      if (item.id !== id) {
        return item;
      }
      return {
        ...item,
        content: patch.content ?? item.content,
        labels: patch.labels ? [...patch.labels] : item.labels,
      };
    });
    return this.getTask(id);
  }

  async updateTaskDue(
    id: string,
    _date: string,
  ): Promise<Result<TodoistTask>> {
    return this.getTask(id);
  }

  async moveTask(id: string, projectId: string): Promise<Result<TodoistTask>> {
    this.tasks = this.tasks.map((item) =>
      item.id === id ? { ...item, projectId } : item,
    );
    return this.getTask(id);
  }

  async createTask(
    input: CreateTodoistTaskInput,
  ): Promise<Result<TodoistTask>> {
    const created = task({
      id: `n${this.seq}`,
      content: input.content,
      labels: [...input.labels],
    });
    this.seq += 1;
    const stored = { ...created, projectId: input.projectId };
    this.tasks.push(stored);
    return ok(stored);
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

function emptyPage(): NotionPage {
  return { pageId: "x", title: "", url: "https://notion.so/x" };
}
