import type { LlmPort } from "../../ports/LlmPort.js";
import type { NotionPort } from "../../ports/NotionPort.js";
import type { TodoistPort } from "../../ports/TodoistPort.js";
import { ok, type Result } from "../result.js";
import { InboxRunSchema, type InboxRun, type TodoistProject, type TodoistTask } from "../schemas.js";
import { advanceIdleProjects } from "./advanceDoing.js";
import {
  GTD_ARCHIVE,
  GTD_INCUBATE,
  GTD_NEXT_ACTIONS,
  PILLAR_PROJECTS,
  STATE_LABEL_DOING,
} from "./catalog.js";
import type { GtdTree } from "./ensure.js";
import { extractJson } from "./json.js";
import { mergeContextLabels, withDoingLabel } from "./labels.js";
import { nextRewritePrompt, projectPlanPrompt } from "./prompts.js";
import {
  doingTaskOf,
  isUsableProjectPlan,
  limitPlannedTasks,
  NextRewriteSchema,
  ProjectPlanSchema,
  type PlannedTask,
  type ProjectPlan,
} from "./projectPlan.js";
import { classifyRouting, stripRoutingLabels } from "./routing.js";

export async function processInbox(input: {
  readonly todoist: TodoistPort;
  readonly notion: NotionPort;
  readonly llm: LlmPort;
  readonly tree: GtdTree;
  readonly labelsCreated?: readonly string[];
  readonly projectsCreated?: readonly string[];
}): Promise<Result<InboxRun>> {
  const processed: InboxRun["processed"] = [];
  const errors: string[] = [];
  let skipped = 0;
  const projectsCreated = [...(input.projectsCreated ?? [])];

  const inboxTasks = await input.todoist.listTasks({
    projectId: input.tree.inboxId,
  });
  if (!inboxTasks.ok) {
    return inboxTasks;
  }

  const listedProjects = await input.todoist.listProjects();
  if (!listedProjects.ok) {
    return listedProjects;
  }
  let projects = [...listedProjects.value];

  for (const task of inboxTasks.value) {
    const decision = classifyRouting(task.labels);
    if (decision.kind === "skip") {
      skipped += 1;
      continue;
    }

    try {
      if (decision.kind === "Next") {
        const detail = await processNext(input, task);
        processed.push({ taskId: task.id, routing: "Next", detail });
        continue;
      }
      if (decision.kind === "Maybe") {
        await moveAndStrip(input.todoist, task, input.tree.incubateId);
        processed.push({
          taskId: task.id,
          routing: "Maybe",
          detail: GTD_INCUBATE,
        });
        continue;
      }
      if (decision.kind === "Archive") {
        await moveAndStrip(input.todoist, task, input.tree.archiveId);
        processed.push({
          taskId: task.id,
          routing: "Archive",
          detail: GTD_ARCHIVE,
        });
        continue;
      }

      const result = await processProject(input, task, projects);
      if (result.status === "skipped") {
        skipped += 1;
        if (result.reason) {
          errors.push(result.reason);
        }
        continue;
      }
      projects = upsertProject(projects, result.project);
      if (result.createdProject) {
        projectsCreated.push(result.project.name);
      }
      processed.push({
        taskId: task.id,
        routing: "Project",
        detail: result.detail,
      });
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : "Falha ao processar item";
      errors.push(`${task.id}: ${message}`);
    }
  }

  const advanced = await advanceIdleProjects({
    todoist: input.todoist,
    notion: input.notion,
    llm: input.llm,
    tree: input.tree,
    projects,
  });
  if (!advanced.ok) {
    return advanced;
  }

  return ok(
    InboxRunSchema.parse({
      labelsCreated: [...(input.labelsCreated ?? [])],
      projectsCreated: [...projectsCreated, ...advanced.value.projectsCreated],
      processed,
      advanced: advanced.value.advanced,
      skipped,
      errors: [...errors, ...advanced.value.errors],
    }),
  );
}

async function processNext(
  input: {
    readonly todoist: TodoistPort;
    readonly llm: LlmPort;
    readonly tree: GtdTree;
  },
  task: TodoistTask,
): Promise<string> {
  const rewrite = await rewriteNext(input.llm, task);
  const labels = mergeContextLabels(
    stripRoutingLabels(task.labels),
    rewrite.labels,
  );
  await requireOk(input.todoist.moveTask(task.id, input.tree.nextActionsId));
  await requireOk(
    input.todoist.updateTask(task.id, {
      content: rewrite.title,
      labels,
    }),
  );
  return `${GTD_NEXT_ACTIONS}: ${rewrite.title}`;
}

async function moveAndStrip(
  todoist: TodoistPort,
  task: TodoistTask,
  projectId: string,
): Promise<void> {
  await requireOk(todoist.moveTask(task.id, projectId));
  await requireOk(
    todoist.updateTask(task.id, {
      labels: stripRoutingLabels(task.labels),
    }),
  );
}

async function processProject(
  input: {
    readonly todoist: TodoistPort;
    readonly notion: NotionPort;
    readonly llm: LlmPort;
    readonly tree: GtdTree;
  },
  task: TodoistTask,
  projects: readonly TodoistProject[],
): Promise<
  | { readonly status: "skipped"; readonly reason: string }
  | {
      readonly status: "ok";
      readonly project: TodoistProject;
      readonly createdProject: boolean;
      readonly detail: string;
    }
> {
  const comments = await input.todoist.listTaskComments(task.id);
  if (!comments.ok) {
    throw new Error(comments.error.message);
  }

  const existingParaNames = paraProjectNames(
    projects,
    input.tree.projectsFolderId,
  );
  const plan = await planProject(input.llm, {
    task,
    comments: comments.value,
    existingParaNames,
  });
  if (!isUsableProjectPlan(plan)) {
    return {
      status: "skipped",
      reason: `${task.id}: conteúdo insuficiente ou nome reservado — ficou na Inbox`,
    };
  }

  const found = findReusableProject(
    projects,
    plan.projectName,
    input.tree.projectsFolderId,
  );
  let project = found;
  let createdProject = false;
  if (!project) {
    const created = await input.todoist.createProject({
      name: plan.projectName,
      parentId: input.tree.projectsFolderId,
    });
    if (!created.ok) {
      throw new Error(created.error.message);
    }
    project = created.value;
    createdProject = true;
  }

  const alreadyHasDoing = await projectHasDoing(input.todoist, project.id);
  if (alreadyHasDoing) {
    return {
      status: "skipped",
      reason: `${task.id}: projeto já tem Doing — ficou na Inbox`,
    };
  }

  const tasks = limitPlannedTasks(plan.tasks);
  const doing = doingTaskOf(tasks);
  if (!doing) {
    return {
      status: "skipped",
      reason: `${task.id}: sem ação DOING — ficou na Inbox`,
    };
  }

  const notionPage = await input.notion.upsertProjectPage({
    title: project.name,
    select: plan.select,
  });
  if (!notionPage.ok) {
    return {
      status: "skipped",
      reason: `${task.id}: Notion falhou (${notionPage.error.message}) — ficou na Inbox`,
    };
  }

  const board = await input.notion.ensureProjectTaskBoard(notionPage.value.pageId);
  if (!board.ok) {
    return {
      status: "skipped",
      reason: `${task.id}: kanban Notion falhou (${board.error.message}) — ficou na Inbox`,
    };
  }

  const existingTitles = new Set(
    board.value.tasks.map((card) => card.title),
  );
  for (const planned of tasks) {
    if (existingTitles.has(planned.title)) {
      continue;
    }
    const card = await input.notion.createProjectTask({
      dataSourceId: board.value.dataSourceId,
      title: planned.title,
      column: planned.column,
    });
    if (!card.ok) {
      return {
        status: "skipped",
        reason: `${task.id}: card Notion falhou (${card.error.message}) — ficou na Inbox`,
      };
    }
    existingTitles.add(planned.title);
  }

  await materializeDoing(
    input.todoist,
    task,
    project.id,
    doing,
    plan.doingLabels,
  );

  return {
    status: "ok",
    project,
    createdProject,
    detail: `${project.name} · ${tasks.length} cards Notion · DOING ${doing.title}`,
  };
}

async function materializeDoing(
  todoist: TodoistPort,
  seed: TodoistTask,
  projectId: string,
  doing: PlannedTask,
  doingLabels: readonly string[],
): Promise<void> {
  const labels = withDoingLabel(
    mergeContextLabels(stripRoutingLabels(seed.labels), doingLabels),
  );
  await requireOk(todoist.moveTask(seed.id, projectId));
  await requireOk(
    todoist.updateTask(seed.id, {
      content: doing.title,
      labels,
    }),
  );
}

async function projectHasDoing(
  todoist: TodoistPort,
  projectId: string,
): Promise<boolean> {
  const tasks = await todoist.listTasks({ projectId });
  if (!tasks.ok) {
    throw new Error(tasks.error.message);
  }
  return tasks.value.some((task) => task.labels.includes(STATE_LABEL_DOING));
}

function paraProjectNames(
  projects: readonly TodoistProject[],
  folderId: string,
): string[] {
  const pillars = new Set<string>(PILLAR_PROJECTS);
  return projects
    .filter(
      (project) =>
        project.parentId === folderId && !pillars.has(project.name),
    )
    .map((project) => project.name);
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

async function rewriteNext(
  llm: LlmPort,
  task: TodoistTask,
): Promise<{ title: string; labels: string[] }> {
  const reply = await llm.complete(nextRewritePrompt(task));
  if (!reply.ok) {
    throw new Error(reply.error.message);
  }
  const parsed = NextRewriteSchema.parse(extractJson(reply.value));
  return { title: parsed.title, labels: parsed.labels };
}

async function planProject(
  llm: LlmPort,
  input: {
    readonly task: TodoistTask;
    readonly comments: readonly string[];
    readonly existingParaNames: readonly string[];
  },
): Promise<ProjectPlan> {
  const reply = await llm.complete(projectPlanPrompt(input));
  if (!reply.ok) {
    throw new Error(reply.error.message);
  }
  return ProjectPlanSchema.parse(extractJson(reply.value));
}

async function requireOk<T>(result: Promise<Result<T>>): Promise<T> {
  const resolved = await result;
  if (!resolved.ok) {
    throw new Error(resolved.error.message);
  }
  return resolved.value;
}

