import { z } from "zod";

import {
  KanbanColumnSchema,
  NotionProjectSelectSchema,
  type KanbanColumn,
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
  select: NotionProjectSelectSchema.nullable(),
  doingLabels: z.array(z.string()).default([]),
  tasks: z.array(PlannedTaskSchema),
});
export type ProjectPlan = z.infer<typeof ProjectPlanSchema>;

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
