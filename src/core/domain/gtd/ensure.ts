import { err, ok, type Result } from "../result.js";
import type {
  IntegrationError,
  TodoistFilter,
  TodoistLabel,
  TodoistProject,
} from "../schemas.js";
import type { TodoistPort } from "../../ports/TodoistPort.js";
import {
  FILTER_CATALOG,
  GTD_ARCHIVE,
  GTD_INCUBATE,
  GTD_NEXT_ACTIONS,
  GTD_PROJECTS_FOLDER,
  LABEL_CATALOG,
} from "./catalog.js";

export type GtdTree = {
  readonly inboxId: string;
  readonly nextActionsId: string;
  readonly incubateId: string;
  readonly archiveId: string;
  readonly projectsFolderId: string;
};

export type GtdEnsureResult = {
  readonly tree: GtdTree;
  readonly labelsCreated: readonly string[];
  readonly filtersCreated: readonly string[];
  readonly projectsCreated: readonly string[];
};

export async function ensureGtd(
  todoist: TodoistPort,
): Promise<Result<GtdEnsureResult>> {
  const labelsCreated: string[] = [];
  const filtersCreated: string[] = [];
  const projectsCreated: string[] = [];

  const labels = await todoist.listLabels();
  if (!labels.ok) {
    return labels;
  }
  const missingLabels = missingLabelNames(labels.value);
  for (const spec of LABEL_CATALOG) {
    if (!missingLabels.has(spec.name)) {
      continue;
    }
    const created = await todoist.createLabel({
      name: spec.name,
      color: spec.color,
    });
    if (!created.ok) {
      return created;
    }
    labelsCreated.push(spec.name);
  }

  const filters = await todoist.listFilters();
  if (!filters.ok) {
    return filters;
  }
  const missingFilters = missingFilterNames(filters.value);
  for (const spec of FILTER_CATALOG) {
    if (!missingFilters.has(spec.name)) {
      continue;
    }
    const created = await todoist.createFilter({
      name: spec.name,
      query: spec.query,
      color: spec.color,
    });
    if (!created.ok) {
      return created;
    }
    filtersCreated.push(spec.name);
  }

  const listed = await todoist.listProjects();
  if (!listed.ok) {
    return listed;
  }
  let projects = [...listed.value];

  const folder = await ensureNamedProject(
    todoist,
    projects,
    GTD_PROJECTS_FOLDER,
    null,
    projectsCreated,
  );
  if (!folder.ok) {
    return folder;
  }
  projects = upsertProject(projects, folder.value);

  for (const name of ROOT_GTD_LIST) {
    const created = await ensureNamedProject(
      todoist,
      projects,
      name,
      null,
      projectsCreated,
    );
    if (!created.ok) {
      return created;
    }
    projects = upsertProject(projects, created.value);
  }

  const tree = resolveTree(projects);
  if (!tree.ok) {
    return tree;
  }

  return ok({
    tree: tree.value,
    labelsCreated,
    filtersCreated,
    projectsCreated,
  });
}

const ROOT_GTD_LIST = [GTD_NEXT_ACTIONS, GTD_INCUBATE, GTD_ARCHIVE] as const;

function missingLabelNames(labels: readonly TodoistLabel[]): Set<string> {
  const present = new Set(labels.map((label) => label.name));
  return new Set(
    LABEL_CATALOG.filter((spec) => !present.has(spec.name)).map(
      (spec) => spec.name,
    ),
  );
}

function missingFilterNames(filters: readonly TodoistFilter[]): Set<string> {
  const present = new Set(filters.map((filter) => filter.name));
  return new Set(
    FILTER_CATALOG.filter((spec) => !present.has(spec.name)).map(
      (spec) => spec.name,
    ),
  );
}

async function ensureNamedProject(
  todoist: TodoistPort,
  projects: readonly TodoistProject[],
  name: string,
  parentId: string | null,
  createdNames: string[],
): Promise<Result<TodoistProject>> {
  const existing = projects.find((project) => project.name === name);
  if (existing) {
    return ok(existing);
  }
  const created = await todoist.createProject({ name, parentId });
  if (created.ok) {
    createdNames.push(name);
  }
  return created;
}

function upsertProject(
  projects: readonly TodoistProject[],
  project: TodoistProject,
): TodoistProject[] {
  const without = projects.filter((item) => item.id !== project.id);
  return [...without, project];
}

function resolveTree(
  projects: readonly TodoistProject[],
): Result<GtdTree> {
  const inbox = projects.find((project) => project.inboxProject);
  const nextActions = projects.find(
    (project) => project.name === GTD_NEXT_ACTIONS,
  );
  const incubate = projects.find((project) => project.name === GTD_INCUBATE);
  const archive = projects.find((project) => project.name === GTD_ARCHIVE);
  const folder = projects.find(
    (project) => project.name === GTD_PROJECTS_FOLDER,
  );

  if (!inbox || !nextActions || !incubate || !archive || !folder) {
    return err(
      gtdError(
        "A árvore GTD não materializou Inbox, listas ou pasta Projetos.",
      ),
    );
  }

  return ok({
    inboxId: inbox.id,
    nextActionsId: nextActions.id,
    incubateId: incubate.id,
    archiveId: archive.id,
    projectsFolderId: folder.id,
  });
}

function gtdError(message: string): IntegrationError {
  return {
    provider: "todoist",
    code: "validation",
    message,
    retryable: false,
    retryAfterMs: null,
    cause: null,
  };
}
