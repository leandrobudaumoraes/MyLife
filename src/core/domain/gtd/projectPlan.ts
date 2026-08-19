import { z } from "zod";

import {
  KanbanColumnSchema,
  NotionProjectSelectSchema,
  type KanbanColumn,
  type NotionProjectSelect,
} from "../schemas.js";
import { isReservedProjectName } from "./catalog.js";

export const NextRewriteSchema = z.object({
  title: z.string().trim().min(1),
  labels: z.array(z.string()).default([]),
});
export type NextRewrite = z.infer<typeof NextRewriteSchema>;

export const PlannedTaskSchema = z.object({
  title: z.string().trim().min(1),
  column: KanbanColumnSchema,
});
export type PlannedTask = z.infer<typeof PlannedTaskSchema>;

export const ProjectPlanSchema = z.object({
  insufficient: z.boolean(),
  projectName: z.string().trim(),
  select: z
    .unknown()
    .optional()
    .transform((value) => normalizeProjectSelect(value)),
  doingLabels: z.array(z.string()).default([]),
  tasks: z.array(PlannedTaskSchema),
});
export type ProjectPlan = z.infer<typeof ProjectPlanSchema>;

const SELECT_ALIASES: Readonly<Record<string, NotionProjectSelect>> = {
  pessoal: "Pessoal",
  saude: "Pessoal",
  amizades: "Pessoal",
  engenharia: "Pessoal",
  ia: "Pessoal",
  pagbank: "Pessoal",
  carreira: "Pessoal",
  familia: "Familia",
  casa: "Casa",
  financeiro: "Casa",
  lar: "Casa",
  instituto: "Instituto",
  metatron: "Instituto",
  loja: "Loja",
  "loja lua branca": "Loja",
};

export function normalizeProjectSelect(value: unknown): NotionProjectSelect {
  if (typeof value !== "string") {
    return "Pessoal";
  }
  const folded = foldSelectToken(value);
  if (folded.length === 0) {
    return "Pessoal";
  }
  const exact = NotionProjectSelectSchema.safeParse(
    value.trim().replace(/^\p{Extended_Pictographic}\s*/u, ""),
  );
  if (exact.success) {
    return exact.data;
  }
  const aliased = SELECT_ALIASES[folded];
  if (aliased) {
    return aliased;
  }
  for (const [alias, select] of Object.entries(SELECT_ALIASES)) {
    if (alias.length < 4) {
      continue;
    }
    if (folded.includes(alias)) {
      return select;
    }
  }
  return "Pessoal";
}

function foldSelectToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const MAX_PLANNED_TASKS = 7;

export function forceSingleDoing(
  tasks: readonly PlannedTask[],
): PlannedTask[] {
  if (tasks.length === 0) {
    return [];
  }

  const normalized = tasks.map((task) => ({
    title: task.title,
    column: task.column,
  }));

  const doingIndexes = normalized.flatMap((task, index) =>
    task.column === "DOING" ? [index] : [],
  );

  if (doingIndexes.length === 0) {
    const first = normalized[0];
    if (first) {
      first.column = "DOING";
    }
    return demoteExtraDoing(normalized, 0);
  }

  const keep = doingIndexes[0] ?? 0;
  return demoteExtraDoing(normalized, keep);
}

function demoteExtraDoing(
  tasks: PlannedTask[],
  keepIndex: number,
): PlannedTask[] {
  return tasks.map((task, index) => {
    if (task.column === "DOING" && index !== keepIndex) {
      return { title: task.title, column: "TO DO" };
    }
    return task;
  });
}

export function limitPlannedTasks(
  tasks: readonly PlannedTask[],
): PlannedTask[] {
  const forced = forceSingleDoing(tasks);
  if (forced.length <= MAX_PLANNED_TASKS) {
    return forced;
  }
  const doing = forced.find((task) => task.column === "DOING");
  const rest = forced.filter((task) => task !== doing);
  return doing ? [doing, ...rest.slice(0, MAX_PLANNED_TASKS - 1)] : forced.slice(0, MAX_PLANNED_TASKS);
}

export function demoteDoingIfOccupied(
  tasks: readonly PlannedTask[],
  alreadyHasDoing: boolean,
): PlannedTask[] {
  if (!alreadyHasDoing) {
    return [...tasks];
  }
  return tasks.map((task) =>
    task.column === "DOING"
      ? { title: task.title, column: "TO DO" }
      : task,
  );
}

export function isUsableProjectPlan(plan: ProjectPlan): boolean {
  if (plan.insufficient) {
    return false;
  }
  if (plan.projectName.length === 0 || isReservedProjectName(plan.projectName)) {
    return false;
  }
  return plan.tasks.length > 0;
}

export function doingTaskOf(
  tasks: readonly PlannedTask[],
): PlannedTask | null {
  return tasks.find((task) => task.column === "DOING") ?? null;
}
