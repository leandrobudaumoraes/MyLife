import type { LlmPort } from "../../ports/LlmPort.js";
import type { Result } from "../result.js";
import {
  EventRecurrenceSchema,
  type EventRecurrence,
  type TodoistComment,
  type TodoistTask,
} from "../schemas.js";
import { parseRecurrence, recurrenceLabelOf } from "./recurrence.js";

export type InboxEventDraft = {
  readonly title: string;
  readonly briefingMarkdown: string;
  readonly recurrenceLabel: string | null;
  readonly recurrence: EventRecurrence | null;
};

const RecurrenceJsonSchema = EventRecurrenceSchema.nullable();

export async function draftInboxEvent(
  llm: LlmPort,
  task: TodoistTask,
  comments: readonly TodoistComment[],
): Promise<Result<InboxEventDraft>> {
  const fallback = fallbackDraft(task, comments);
  const reply = await llm.complete(buildPrompt(task, comments));
  if (!reply.ok) {
    return reply;
  }

  const parsed = parseDraftJson(reply.value);
  if (!parsed) {
    return { ok: true, value: fallback };
  }

  const recurrence =
    parsed.recurrence ??
    (task.isRecurring ? parseRecurrence(task.dueString ?? "") : null);

  return {
    ok: true,
    value: {
      title: parsed.title.trim() || fallback.title,
      briefingMarkdown:
        parsed.briefingMarkdown.trim() || fallback.briefingMarkdown,
      recurrenceLabel:
        parsed.recurrenceLabel?.trim() ||
        recurrenceLabelOf(task.dueString, recurrence),
      recurrence,
    },
  };
}

function fallbackDraft(
  task: TodoistTask,
  comments: readonly TodoistComment[],
): InboxEventDraft {
  const recurrence = task.isRecurring
    ? parseRecurrence(task.dueString ?? "")
    : null;
  return {
    title: task.content.trim(),
    briefingMarkdown: fallbackBriefing(task, comments),
    recurrenceLabel: recurrenceLabelOf(task.dueString, recurrence),
    recurrence,
  };
}

function fallbackBriefing(
  task: TodoistTask,
  comments: readonly TodoistComment[],
): string {
  const lines = [
    "# O que é",
    task.content.trim(),
    "",
    "## Contexto",
    task.description.trim() || "Sem descrição na tarefa.",
  ];

  if (comments.length > 0) {
    lines.push("", "## Comentários");
    for (const comment of comments) {
      if (comment.content.trim().length > 0) {
        lines.push(`- ${comment.content.trim()}`);
      }
      if (comment.attachmentUrl) {
        const name = comment.attachmentName ?? "anexo";
        lines.push(`- Anexo: [${name}](${comment.attachmentUrl})`);
      }
    }
  }

  return lines.join("\n");
}

function buildPrompt(
  task: TodoistTask,
  comments: readonly TodoistComment[],
): string {
  const payload = {
    titulo: task.content,
    descricao: task.description,
    data: task.dueDate,
    hora: task.dueDatetime,
    recorrenciaTexto: task.dueString,
    recorrente: task.isRecurring,
    prioridade: task.priority,
    comentarios: comments.map((comment) => ({
      texto: comment.content,
      anexo: comment.attachmentName,
      url: comment.attachmentUrl,
    })),
  };

  return [
    "Você adapta uma captura do Todoist para um evento de agenda.",
    "Responda SOMENTE um JSON válido, sem markdown, com as chaves:",
    '{"title":"string","briefingMarkdown":"string","recurrenceLabel":string|null,"recurrence":{"freq":"DAILY"|"WEEKLY"|"MONTHLY","interval":1,"byDay":["MO"],"byMonthDay":15,"until":null}|null}',
    "title: título curto de evento (não de tarefa). Português do Brasil.",
    "briefingMarkdown: fácil de ler. Seções: O que é, Quando, Onde (se houver), Levar, Contexto, Anexos.",
    "Listas, não parágrafos longos. Não invente fato que não esteja na captura.",
    "recurrenceLabel: uma frase tipo 'todo dia 15', ou null se não for recorrente.",
    "recurrence: RRULE estruturada, ou null se avulso. byDay vazio se não for semanal. byMonthDay null se não for mensal no dia N.",
    "until sempre null.",
    `Captura: ${JSON.stringify(payload)}`,
  ].join("\n");
}

function parseDraftJson(raw: string): {
  title: string;
  briefingMarkdown: string;
  recurrenceLabel: string | null;
  recurrence: EventRecurrence | null;
} | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match?.[0]) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(match[0]);
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.title !== "string" ||
      typeof record.briefingMarkdown !== "string"
    ) {
      return null;
    }
    const recurrenceLabel =
      typeof record.recurrenceLabel === "string"
        ? record.recurrenceLabel
        : null;
    const recurrenceParsed = RecurrenceJsonSchema.safeParse(
      record.recurrence === undefined ? null : record.recurrence,
    );
    return {
      title: record.title,
      briefingMarkdown: record.briefingMarkdown,
      recurrenceLabel,
      recurrence: recurrenceParsed.success ? recurrenceParsed.data : null,
    };
  } catch {
    return null;
  }
}
