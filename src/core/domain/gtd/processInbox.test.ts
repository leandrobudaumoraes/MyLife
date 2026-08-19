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
  KanbanColumn,
  ListTasksQuery,
  NotionPage,
  ProjectTaskBoard,
  ProjectTaskCard,
  TodoistLabel,
  TodoistProject,
  TodoistTask,
  UpdateProjectTaskColumnInput,
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
  assert.equal(todoist.tasks.filter((item) => item.projectId === para?.id).length, 1);
  assert.equal(notion.pages.length, 1);
  assert.equal(notion.cards.length, 2);
  assert.equal(notion.cards[0]?.column, "DOING");
  assert.equal(notion.cards[1]?.column, "TO DO");
  assert.equal(notion.lastSelect, "Instituto");
});

test("Project com select nulo no LLM grava Pessoal no Notion", async () => {
  const todoist = new MemoryTodoist([
    task({
      id: "t-ia",
      content: "criar estrutura do curso de IA",
      labels: ["Project"],
    }),
  ]);
  const notion = new MemoryNotion();
  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([
      JSON.stringify({
        insufficient: false,
        projectName: "Criar estrutura do curso de IA",
        select: null,
        doingLabels: ["Casa"],
        tasks: [{ title: "Listar os módulos do curso", column: "DOING" }],
      }),
    ]),
    tree,
  });
  assert.equal(result.ok, true);
  assert.equal(notion.lastSelect, "Pessoal");
});

test("Project cria o quadro no Notion e só a DOING no Todoist", async () => {
  const todoist = new MemoryTodoist([
    task({
      id: "t3",
      content: "montar o curso",
      labels: ["Project"],
    }),
  ]);
  const notion = new MemoryNotion();
  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([
      JSON.stringify({
        insufficient: false,
        projectName: "Montar o curso",
        select: "Pessoal",
        doingLabels: [],
        tasks: [
          { title: "Listar os módulos do curso", column: "DOING" },
          { title: "Escrever a primeira aula", column: "TO DO" },
          { title: "Pesquisar materiais", column: "BACKLOG" },
        ],
      }),
    ]),
    tree,
  });
  assert.equal(result.ok, true);
  assert.equal(todoist.tasks.length, 1);
  assert.equal(todoist.tasks[0]?.content, "Listar os módulos do curso");
  assert.equal(notion.cards.length, 3);
  assert.deepEqual(
    notion.cards.map((card) => card.column),
    ["DOING", "TO DO", "BACKLOG"],
  );
});

test("Project com Doing já existente deixa a captura na Inbox", async () => {
  const todoist = new MemoryTodoist([
    task({
      id: "t4",
      content: "outra captura do mesmo curso",
      labels: ["Project"],
    }),
  ]);
  todoist.projects.push({
    id: "para-ia",
    name: "Criar estrutura do curso de IA",
    parentId: "folder",
    inboxProject: false,
  });
  todoist.tasks.push({
    ...task({
      id: "doing-1",
      content: "Definir tópicos do curso",
      labels: ["Doing"],
    }),
    projectId: "para-ia",
  });
  const result = await processInbox({
    todoist,
    notion: new MemoryNotion(),
    llm: new ScriptedLlm([
      JSON.stringify({
        insufficient: false,
        projectName: "Criar estrutura do curso de IA",
        select: "Pessoal",
        doingLabels: [],
        tasks: [{ title: "Escrever a ementa", column: "DOING" }],
      }),
    ]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.skipped, 1);
  assert.equal(todoist.tasks.find((item) => item.id === "t4")?.projectId, "inbox");
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

test("projeto Notion sem DOING promove TO DO e espelha no Todoist", async () => {
  const todoist = new MemoryTodoist([]);
  todoist.projects.push({
    id: "para-curso",
    name: "Montar o curso",
    parentId: "folder",
    inboxProject: false,
  });
  const notion = new MemoryNotion();
  notion.seedBoard("np-curso", "Montar o curso", [
    { title: "Escrever a primeira aula", column: "TO DO" },
    { title: "Pesquisar materiais", column: "BACKLOG" },
  ]);

  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([JSON.stringify({ labels: ["Casa"] })]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.advanced.length, 1);
  assert.equal(result.value.advanced[0]?.projectName, "Montar o curso");
  assert.equal(result.value.advanced[0]?.taskTitle, "Escrever a primeira aula");
  assert.equal(
    notion.cards.find((card) => card.title === "Escrever a primeira aula")
      ?.column,
    "DOING",
  );
  const mirrored = todoist.tasks.find(
    (item) => item.content === "Escrever a primeira aula",
  );
  assert.ok(mirrored);
  assert.equal(mirrored?.projectId, "para-curso");
  assert.ok(mirrored?.labels.includes("Doing"));
  assert.ok(mirrored?.labels.includes("Casa"));
  assert.equal(
    todoist.tasks.filter((item) => item.projectId === "para-curso").length,
    1,
  );
});

test("Todoist vazio fecha a DOING no Notion e promove a TO DO", async () => {
  const todoist = new MemoryTodoist([]);
  todoist.projects.push({
    id: "para-curso",
    name: "Montar o curso",
    parentId: "folder",
    inboxProject: false,
  });
  const notion = new MemoryNotion();
  notion.seedBoard("np-curso", "Montar o curso", [
    { title: "Listar os módulos", column: "DOING" },
    { title: "Escrever a primeira aula", column: "TO DO" },
  ]);

  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([JSON.stringify({ labels: ["Casa"] })]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.advanced.length, 1);
  assert.equal(result.value.advanced[0]?.taskTitle, "Escrever a primeira aula");
  assert.equal(
    notion.cards.find((card) => card.title === "Listar os módulos")?.column,
    "DONE",
  );
  assert.equal(
    notion.cards.find((card) => card.title === "Escrever a primeira aula")
      ?.column,
    "DOING",
  );
  const mirrored = todoist.tasks.find(
    (item) => item.content === "Escrever a primeira aula",
  );
  assert.ok(mirrored);
  assert.equal(mirrored?.projectId, "para-curso");
  assert.ok(mirrored?.labels.includes("Doing"));
  assert.equal(todoist.tasks.length, 1);
});

test("não promove se o PARA no Todoist ainda tem tarefa aberta", async () => {
  const todoist = new MemoryTodoist([]);
  todoist.projects.push({
    id: "para-curso",
    name: "Montar o curso",
    parentId: "folder",
    inboxProject: false,
  });
  todoist.tasks.push({
    ...task({
      id: "doing-1",
      content: "Listar os módulos",
      labels: ["Doing"],
    }),
    projectId: "para-curso",
  });
  const notion = new MemoryNotion();
  notion.seedBoard("np-curso", "Montar o curso", [
    { title: "Escrever a primeira aula", column: "TO DO" },
  ]);

  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.advanced.length, 0);
  assert.equal(
    notion.cards.find((card) => card.title === "Escrever a primeira aula")
      ?.column,
    "TO DO",
  );
  assert.equal(todoist.tasks.length, 1);
});

test("sem TO DO promove BACKLOG para DOING", async () => {
  const todoist = new MemoryTodoist([]);
  todoist.projects.push({
    id: "para-curso",
    name: "Montar o curso",
    parentId: "folder",
    inboxProject: false,
  });
  const notion = new MemoryNotion();
  notion.seedBoard("np-curso", "Montar o curso", [
    { title: "Pesquisar materiais", column: "BACKLOG" },
  ]);

  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.advanced[0]?.taskTitle, "Pesquisar materiais");
  assert.equal(notion.cards[0]?.column, "DOING");
  assert.equal(todoist.tasks[0]?.content, "Pesquisar materiais");
  assert.ok(todoist.tasks[0]?.labels.includes("Doing"));
});

test("Project recém-criado não ganha segunda DOING na mesma corrida", async () => {
  const todoist = new MemoryTodoist([
    task({
      id: "t3",
      content: "montar o curso",
      labels: ["Project"],
    }),
  ]);
  const notion = new MemoryNotion();
  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([
      JSON.stringify({
        insufficient: false,
        projectName: "Montar o curso",
        select: "Pessoal",
        doingLabels: [],
        tasks: [
          { title: "Listar os módulos do curso", column: "DOING" },
          { title: "Escrever a primeira aula", column: "TO DO" },
        ],
      }),
    ]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.advanced.length, 0);
  assert.equal(todoist.tasks.length, 1);
  assert.equal(todoist.tasks[0]?.content, "Listar os módulos do curso");
});

test("página Notion sem kanban Tarefas não cria DOING", async () => {
  const todoist = new MemoryTodoist([]);
  const notion = new MemoryNotion();
  notion.pages.push({
    pageId: "np-solta",
    title: "Ideia sem quadro",
    url: "https://notion.so/np-solta",
    status: "Em andamento",
  });
  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.advanced.length, 0);
  assert.equal(todoist.tasks.length, 0);
});

test("sem PARA no Todoist promove TO DO e cria o projeto", async () => {
  const todoist = new MemoryTodoist([]);
  const notion = new MemoryNotion();
  notion.seedBoard("np-curso", "Montar o curso", [
    { title: "Escrever a primeira aula", column: "TO DO" },
  ]);
  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const para = todoist.projects.find(
    (project) => project.name === "Montar o curso",
  );
  assert.ok(para);
  assert.equal(para?.parentId, "folder");
  assert.ok(result.value.projectsCreated.includes("Montar o curso"));
  assert.equal(todoist.tasks[0]?.projectId, para?.id);
  assert.ok(todoist.tasks[0]?.labels.includes("Doing"));
});

test("sem PARA no Todoist espelha a DOING existente sem marcar DONE", async () => {
  const todoist = new MemoryTodoist([]);
  const notion = new MemoryNotion();
  notion.seedBoard("np-curso", "Montar o curso", [
    { title: "Listar os módulos", column: "DOING" },
    { title: "Escrever a primeira aula", column: "TO DO" },
  ]);
  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    notion.cards.find((card) => card.title === "Listar os módulos")?.column,
    "DOING",
  );
  assert.equal(
    notion.cards.find((card) => card.title === "Escrever a primeira aula")
      ?.column,
    "TO DO",
  );
  assert.equal(todoist.tasks[0]?.content, "Listar os módulos");
  assert.ok(todoist.tasks[0]?.labels.includes("Doing"));
});

test("tarefa concluída no Todoist (isCompleted) fecha a DOING e sobe a próxima", async () => {
  const todoist = new MemoryTodoist([]);
  todoist.projects.push({
    id: "para-curso",
    name: "Montar o curso",
    parentId: "folder",
    inboxProject: false,
  });
  todoist.tasks.push({
    ...task({
      id: "done-1",
      content: "Listar os módulos",
      labels: ["Doing"],
    }),
    projectId: "para-curso",
    isCompleted: true,
  });
  const notion = new MemoryNotion();
  notion.seedBoard("np-curso", "Montar o curso", [
    { title: "Listar os módulos", column: "DOING" },
    { title: "Escrever a primeira aula", column: "TO DO" },
  ]);
  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    notion.cards.find((card) => card.title === "Listar os módulos")?.column,
    "DONE",
  );
  assert.equal(
    notion.cards.find((card) => card.title === "Escrever a primeira aula")
      ?.column,
    "DOING",
  );
  const open = todoist.tasks.filter((item) => !item.isCompleted);
  assert.equal(open.length, 1);
  assert.equal(open[0]?.content, "Escrever a primeira aula");
});

test("PARA vazio só com DOING no Notion marca DONE e não inventa carta", async () => {
  const todoist = new MemoryTodoist([]);
  todoist.projects.push({
    id: "para-curso",
    name: "Montar o curso",
    parentId: "folder",
    inboxProject: false,
  });
  const notion = new MemoryNotion();
  notion.seedBoard("np-curso", "Montar o curso", [
    { title: "Listar os módulos", column: "DOING" },
  ]);
  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.advanced.length, 0);
  assert.equal(notion.cards[0]?.column, "DONE");
  assert.equal(todoist.tasks.length, 0);
});

test("projeto pausado no Notion não promove mesmo com PARA vazio", async () => {
  const todoist = new MemoryTodoist([]);
  todoist.projects.push({
    id: "para-curso",
    name: "Montar o curso",
    parentId: "folder",
    inboxProject: false,
  });
  const notion = new MemoryNotion();
  notion.seedBoard(
    "np-curso",
    "Montar o curso",
    [
      { title: "Listar os módulos", column: "DOING" },
      { title: "Escrever a primeira aula", column: "TO DO" },
    ],
    "Pausado",
  );

  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.advanced.length, 0);
  assert.equal(
    notion.cards.find((card) => card.title === "Listar os módulos")?.column,
    "DONE",
  );
  assert.equal(
    notion.cards.find((card) => card.title === "Escrever a primeira aula")
      ?.column,
    "TO DO",
  );
  assert.equal(todoist.tasks.length, 0);
  assert.equal(notion.pageStatus("np-curso"), "Pausado");
});

test("projeto não iniciado sem PARA não cria projeto no Todoist", async () => {
  const todoist = new MemoryTodoist([]);
  const notion = new MemoryNotion();
  notion.seedBoard(
    "np-curso",
    "Montar o curso",
    [{ title: "Escrever a primeira aula", column: "TO DO" }],
    "Não iniciada",
  );
  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.advanced.length, 0);
  assert.equal(
    todoist.projects.some((project) => project.name === "Montar o curso"),
    false,
  );
  assert.equal(todoist.tasks.length, 0);
});

test("Doing leftover em projeto pausado não retoma", async () => {
  const todoist = new MemoryTodoist([]);
  todoist.projects.push({
    id: "para-curso",
    name: "Montar o curso",
    parentId: "folder",
    inboxProject: false,
  });
  todoist.tasks.push({
    ...task({
      id: "doing-1",
      content: "Listar os módulos",
      labels: ["Doing"],
    }),
    projectId: "para-curso",
  });
  const notion = new MemoryNotion();
  notion.seedBoard(
    "np-curso",
    "Montar o curso",
    [
      { title: "Listar os módulos", column: "DOING" },
      { title: "Escrever a primeira aula", column: "TO DO" },
    ],
    "Pausado",
  );

  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.advanced.length, 0);
  assert.equal(notion.pageStatus("np-curso"), "Pausado");
  assert.equal(
    notion.cards.find((card) => card.title === "Escrever a primeira aula")
      ?.column,
    "TO DO",
  );
  assert.equal(todoist.tasks.length, 1);
});

test("Doing no Todoist retoma projeto pausado sem DOING no Notion", async () => {
  const todoist = new MemoryTodoist([]);
  todoist.projects.push({
    id: "para-curso",
    name: "Montar o curso",
    parentId: "folder",
    inboxProject: false,
  });
  todoist.tasks.push({
    ...task({
      id: "doing-2",
      content: "Escrever a primeira aula",
      labels: ["Doing"],
    }),
    projectId: "para-curso",
  });
  const notion = new MemoryNotion();
  notion.seedBoard(
    "np-curso",
    "Montar o curso",
    [
      { title: "Listar os módulos", column: "DONE" },
      { title: "Escrever a primeira aula", column: "TO DO" },
    ],
    "Pausado",
  );

  const result = await processInbox({
    todoist,
    notion,
    llm: new ScriptedLlm([]),
    tree,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.advanced.length, 0);
  assert.equal(notion.pageStatus("np-curso"), "Em andamento");
  assert.equal(
    notion.cards.find((card) => card.title === "Escrever a primeira aula")
      ?.column,
    "TO DO",
  );
  assert.equal(todoist.tasks.length, 1);
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
  lastSelect: UpsertProjectPageInput["select"] = null;
  private boards = new Map<
    string,
    { dataSourceId: string; cards: ProjectTaskCard[] }
  >();
  private seq = 1;

  get cards(): ProjectTaskCard[] {
    return [...this.boards.values()].flatMap((board) => board.cards);
  }

  pageStatus(pageId: string): string | null {
    return this.pages.find((page) => page.pageId === pageId)?.status ?? null;
  }

  seedBoard(
    pageId: string,
    title: string,
    cards: Array<{ title: string; column: KanbanColumn }>,
    status: string | null = "Em andamento",
  ): void {
    this.pages.push({
      pageId,
      title,
      url: `https://notion.so/${pageId}`,
      status,
    });
    this.boards.set(pageId, {
      dataSourceId: `ds-${pageId}`,
      cards: cards.map((card, index) => ({
        pageId: `${pageId}-c${index}`,
        title: card.title,
        column: card.column,
      })),
    });
  }

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
    this.lastSelect = input.select;
    const existing = this.pages.find((page) => page.title === input.title);
    if (existing) {
      return ok(existing);
    }
    const page: NotionPage = {
      pageId: `np${this.seq}`,
      title: input.title,
      url: `https://notion.so/np${this.seq}`,
      status: "Em andamento",
    };
    this.seq += 1;
    this.pages.push(page);
    return ok(page);
  }

  async markProjectInProgress(pageId: string): Promise<Result<NotionPage>> {
    const page = this.pages.find((item) => item.pageId === pageId);
    if (!page) {
      return ok({
        pageId,
        title: "",
        url: `https://notion.so/${pageId}`,
        status: "Em andamento",
      });
    }
    const updated: NotionPage = { ...page, status: "Em andamento" };
    this.pages = this.pages.map((item) =>
      item.pageId === pageId ? updated : item,
    );
    return ok(updated);
  }

  async ensureProjectTaskBoard(
    pageId: string,
  ): Promise<Result<ProjectTaskBoard>> {
    const board = this.boardOf(pageId);
    return ok({ dataSourceId: board.dataSourceId, tasks: [...board.cards] });
  }

  async findProjectTaskBoard(
    pageId: string,
  ): Promise<Result<ProjectTaskBoard | null>> {
    const board = this.boards.get(pageId);
    if (!board) {
      return ok(null);
    }
    return ok({ dataSourceId: board.dataSourceId, tasks: [...board.cards] });
  }

  async createProjectTask(
    input: CreateProjectTaskInput,
  ): Promise<Result<NotionPage>> {
    const board = [...this.boards.values()].find(
      (item) => item.dataSourceId === input.dataSourceId,
    );
    if (!board) {
      return ok({
        pageId: "missing",
        title: input.title,
        url: "https://notion.so/missing",
        status: null,
      });
    }
    const card: ProjectTaskCard = {
      pageId: `c${this.seq}`,
      title: input.title,
      column: input.column,
    };
    this.seq += 1;
    board.cards.push(card);
    return ok({
      pageId: card.pageId,
      title: card.title,
      url: `https://notion.so/${card.pageId}`,
      status: null,
    });
  }

  async updateProjectTaskColumn(
    input: UpdateProjectTaskColumnInput,
  ): Promise<Result<NotionPage>> {
    for (const board of this.boards.values()) {
      const card = board.cards.find((item) => item.pageId === input.pageId);
      if (!card) {
        continue;
      }
      card.column = input.column;
      return ok({
        pageId: card.pageId,
        title: card.title,
        url: `https://notion.so/${card.pageId}`,
        status: null,
      });
    }
    return ok({
      pageId: input.pageId,
      title: "",
      url: `https://notion.so/${input.pageId}`,
      status: null,
    });
  }

  private boardOf(pageId: string): {
    dataSourceId: string;
    cards: ProjectTaskCard[];
  } {
    const existing = this.boards.get(pageId);
    if (existing) {
      return existing;
    }
    const created = { dataSourceId: `ds-${pageId}`, cards: [] };
    this.boards.set(pageId, created);
    return created;
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
    const open = this.tasks.filter((item) => !item.isCompleted);
    if (!query) {
      return ok(open);
    }
    return ok(open.filter((item) => item.projectId === query.projectId));
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

  async completeTask(id: string): Promise<Result<void>> {
    this.tasks = this.tasks.map((item) =>
      item.id === id ? { ...item, isCompleted: true } : item,
    );
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
  return { pageId: "x", title: "", url: "https://notion.so/x", status: null };
}
