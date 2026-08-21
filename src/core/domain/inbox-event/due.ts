import { toCivilIso } from "../clock.js";
import type { TodoistTask } from "../schemas.js";

export type DueInspection =
  | { readonly ok: true; readonly startIso: string }
  | {
      readonly ok: false;
      readonly missing: "date_and_time" | "time";
      readonly detail: string;
    };

export function inspectDue(
  task: Pick<TodoistTask, "dueDate" | "dueDatetime">,
): DueInspection {
  const clockSource = clockSourceOf(task);
  if (clockSource) {
    return { ok: true, startIso: toCivilIso(clockSource) };
  }

  const dateOnly = dateOnlyOf(task.dueDate);
  if (!dateOnly) {
    return {
      ok: false,
      missing: "date_and_time",
      detail: "Falta data e hora.",
    };
  }

  return {
    ok: false,
    missing: "time",
    detail: `Falta horário. Data atual: ${formatCivilDate(dateOnly)}.`,
  };
}

const DEFAULT_NEXT_STEP =
  "O que fazer: edite a tarefa, coloque data e hora, depois remova a etiqueta Pending.";

export const CONFLICT_NEXT_STEP =
  "O que fazer: mude data e hora da tarefa, ou marque prioridade P1 para criar mesmo com conflito. Depois remova a etiqueta Pending.";

export function pendenciaComment(
  detail: string,
  nextStep: string = DEFAULT_NEXT_STEP,
): string {
  return [
    "Pending — nada foi gravado no Google Calendar nem no Notion.",
    "",
    detail,
    nextStep,
  ].join("\n");
}

function clockSourceOf(
  task: Pick<TodoistTask, "dueDate" | "dueDatetime">,
): string | null {
  if (task.dueDatetime && task.dueDatetime.includes("T")) {
    return task.dueDatetime;
  }
  if (task.dueDate && task.dueDate.includes("T")) {
    return task.dueDate;
  }
  return null;
}

function dateOnlyOf(dueDate: string | null): string | null {
  if (!dueDate) {
    return null;
  }
  const day = dueDate.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function formatCivilDate(yyyyMmDd: string): string {
  const [year, month, day] = yyyyMmDd.split("-");
  return `${day}/${month}/${year}`;
}
