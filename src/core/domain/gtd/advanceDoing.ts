import type { LlmPort } from "../../ports/LlmPort.js";
import type { NotionPort } from "../../ports/NotionPort.js";
import type { TodoistPort } from "../../ports/TodoistPort.js";
import { ok, type Result } from "../result.js";
import type {
  AdvancedDoingItem,
  NotionPage,
  ProjectTaskBoard,
  ProjectTaskCard,
  TodoistProject,
  TodoistTask,
} from "../schemas.js";
import {
  isNotionProjectInProgress,
  isReservedProjectName,
  STATE_LABEL_DOING,
} from "./catalog.js";
import type { GtdTree } from "./ensure.js";
import { extractJson } from "./json.js";
import { mergeContextLabels, withDoingLabel } from "./labels.js";
import { doingContextPrompt } from "./prompts.js";
import {
  DoingContextSchema,
  doingCardsOf,
  pickNextDoing,
} from "./projectPlan.js";

export async function advanceIdleProjects(input: {
  readonly todoist: TodoistPort;
  readonly notion: NotionPort;
  readonly llm: LlmPort;
  readonly tree: GtdTree;
  readonly projects: readonly TodoistProject[];
}): Promise<
  Result<{
    readonly advanced: AdvancedDoingItem[];
    readonly projectsCreated: string[];
    readonly errors: string[];
  }>
> {
  const advanced: AdvancedDoingItem[] = [];
  const projectsCreated: string[] = [];
  const errors: string[] = [];
  let projects = [...input.projects];

  const pages = await input.notion.listDatabasePages();
  if (!pages.ok) {
    return ok({
      advanced,
      projectsCreated,
      errors: [`Notion: ${pages.error.message}`],
    });
  }

  for (const page of pages.value) {
    if (page.title.length === 0 || isReservedProjectName(page.title)) {
      continue;
    }

    try {
      const board = await input.notion.findProjectTaskBoard(page.pageId);
      if (!board.ok) {
        errors.push(`${page.title}: ${board.error.message}`);
        continue;
      }
      if (!board.value) {
        continue;
      }

      const existing = findReusableProject(
        projects,
        page.title,
        input.tree.projectsFolderId,
      );

      if (!isNotionProjectInProgress(page.status)) {
        const paused = await handlePausedProject({
          todoist: input.todoist,
          notion: input.notion,
          page,
          board: board.value,
          existing,
        });
        if (!paused.ok) {
          errors.push(`${page.title}: ${paused.error}`);
        }
        continue;
      }

      if (existing) {
        const open = await listOpenTasks(input.todoist, existing.id);
        if (open.length > 0) {
          continue;
        }
        const closed = await closeDoingCards(
          input.notion,
          board.value.tasks,
        );
        if (!closed.ok) {
          errors.push(`${page.title}: ${closed.error}`);
          continue;
        }
      }

      const next = existing
        ? pickNextDoing(board.value.tasks)
        : pickCardToMirror(board.value.tasks);
      if (!next) {
        continue;
      }

      const resolved = existing
        ? { project: existing, created: false as const }
        : await createParaProject(
            input.todoist,
            page.title,
            input.tree.projectsFolderId,
          );
      projects = upsertProject(projects, resolved.project);
      if (resolved.created) {
        projectsCreated.push(resolved.project.name);
      }

      if (next.column !== "DOING") {
        const moved = await input.notion.updateProjectTaskColumn({
          pageId: next.pageId,
          column: "DOING",
        });
        if (!moved.ok) {
          errors.push(`${page.title}: ${moved.error.message}`);
          continue;
        }
      }

      const labels = withDoingLabel(
        mergeContextLabels([], await contextLabels(input.llm, next.title)),
      );
      const created = await input.todoist.createTask({
        content: next.title,
        projectId: resolved.project.id,
        labels,
      });
      if (!created.ok) {
        errors.push(`${page.title}: ${created.error.message}`);
        continue;
      }

      advanced.push({
        projectName: page.title,
        taskTitle: next.title,
      });
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : "Falha ao avançar projeto";
      errors.push(`${page.title}: ${message}`);
    }
  }

  return ok({ advanced, projectsCreated, errors });
}

function pickCardToMirror(
  tasks: readonly ProjectTaskCard[],
): ProjectTaskCard | null {
  const doing = doingCardsOf(tasks);
  return doing[0] ?? pickNextDoing(tasks);
}

async function handlePausedProject(input: {
  readonly todoist: TodoistPort;
  readonly notion: NotionPort;
  readonly page: NotionPage;
  readonly board: ProjectTaskBoard;
  readonly existing: TodoistProject | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.existing) {
    return { ok: true };
  }

  const open = await listOpenTasks(input.todoist, input.existing.id);
  if (open.length === 0) {
    return closeDoingCards(input.notion, input.board.tasks);
  }

  const hasDoing = open.some((task) =>
    task.labels.includes(STATE_LABEL_DOING),
  );
  if (hasDoing && doingCardsOf(input.board.tasks).length === 0) {
    const resumed = await input.notion.markProjectInProgress(input.page.pageId);
    if (!resumed.ok) {
      return { ok: false, error: resumed.error.message };
    }
  }

  return { ok: true };
}

async function closeDoingCards(
  notion: NotionPort,
  tasks: readonly ProjectTaskCard[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const card of doingCardsOf(tasks)) {
    const updated = await notion.updateProjectTaskColumn({
      pageId: card.pageId,
      column: "DONE",
    });
    if (!updated.ok) {
      return { ok: false, error: updated.error.message };
    }
  }
  return { ok: true };
}

async function listOpenTasks(
  todoist: TodoistPort,
  projectId: string,
): Promise<readonly TodoistTask[]> {
  const tasks = await todoist.listTasks({ projectId });
  if (!tasks.ok) {
    throw new Error(tasks.error.message);
  }
  return tasks.value.filter((task) => !task.isCompleted);
}

async function createParaProject(
  todoist: TodoistPort,
  name: string,
  folderId: string,
): Promise<{ readonly project: TodoistProject; readonly created: boolean }> {
  const created = await todoist.createProject({
    name,
    parentId: folderId,
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  return { project: created.value, created: true };
}

function findReusableProject(
  projects: readonly TodoistProject[],
  name: string,
  folderId: string,
): TodoistProject | null {
  const underFolder = projects.find(
    (project) => project.name === name && project.parentId === folderId,
  );
  if (underFolder) {
    return underFolder;
  }
  return (
    projects.find(
      (project) => project.name === name && !project.inboxProject,
    ) ?? null
  );
}

function upsertProject(
  projects: readonly TodoistProject[],
  project: TodoistProject,
): TodoistProject[] {
  return [...projects.filter((item) => item.id !== project.id), project];
}

async function contextLabels(llm: LlmPort, title: string): Promise<string[]> {
  const reply = await llm.complete(doingContextPrompt(title));
  if (!reply.ok) {
    return [];
  }
  try {
    const parsed = DoingContextSchema.safeParse(extractJson(reply.value));
    return parsed.success ? parsed.data.labels : [];
  } catch {
    return [];
  }
}
