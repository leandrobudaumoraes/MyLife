import type { TodoistTask } from "../schemas.js";
import {
  CONTEXT_LABELS,
  GTD_ARCHIVE,
  GTD_INCUBATE,
  GTD_NEXT_ACTIONS,
  PILLAR_PROJECTS,
} from "./catalog.js";


export function doingContextPrompt(title: string): string {
  return [
    "Esta ação GTD vai para DOING. O título já está pronto — não reescreva.",
    "Responda só JSON: {\"labels\":[...]}",
    `labels: só entre ${CONTEXT_LABELS.join(", ")}. No máximo uma localização, uma energia, Compra só se for compra. Dúvida: [].`,
    "Não use nome de pilar. Não invente etiqueta.",
    "",
    `Título: ${title}`,
  ].join("\n");
}

export function nextRewritePrompt(task: TodoistTask): string {
  return [
    "Reescreva esta captura da Inbox do Todoist como UMA próxima ação GTD.",
    "Responda só JSON: {\"title\":\"...\",\"labels\":[...]}",
    "title: verbo no infinitivo + objeto concreto, completável numa sessão.",
    `labels: só entre ${CONTEXT_LABELS.join(", ")}. No máximo uma localização, uma energia, Compra só se for compra. Dúvida: omita.`,
    "Não use nome de pilar. Não invente etiqueta.",
    "",
    `Título: ${task.content}`,
    `Descrição: ${task.description}`,
    `Etiquetas atuais: ${task.labels.join(", ") || "(nenhuma)"}`,
  ].join("\n");
}

export function projectPlanPrompt(input: {
  readonly task: TodoistTask;
  readonly comments: readonly string[];
  readonly existingParaNames: readonly string[];
}): string {
  const comments =
    input.comments.length === 0
      ? "(nenhum)"
      : input.comments.map((comment) => `- ${comment}`).join("\n");
  const existing =
    input.existingParaNames.length === 0
      ? "(nenhum)"
      : input.existingParaNames.map((name) => `- ${name}`).join("\n");

  return [
    "Esta captura da Inbox Todoist tem a etiqueta Project: é um projeto PARA, não uma próxima ação.",
    "Analise título, descrição e comentários. O título da captura NÃO é, por padrão, o nome do projeto.",
    "Responda só JSON:",
    '{"insufficient":false,"projectName":"...","select":"Pessoal"|"Familia"|"Loja"|"Casa"|"Instituto","doingLabels":["Casa"],"tasks":[{"title":"...","column":"BACKLOG"|"TO DO"|"DOING"|"DONE"}]}',
    "projectName: resultado curto (outcome), distinto de listas GTD e pilares.",
    `Pilares reservados: ${PILLAR_PROJECTS.join(" / ")}. Listas: ${GTD_NEXT_ACTIONS}, ${GTD_INCUBATE}, ${GTD_ARCHIVE}.`,
    "Se a captura for o mesmo resultado de um projeto já existente, reutilize o nome EXATO da lista.",
    "insufficient:true se não der para nomear um resultado. Aí tasks=[].",
    "tasks: ações GTD (verbo + objeto) para o kanban do Notion. No máximo 7. Exatamente uma column DOING (primeira ação física). DONE só se já estiver feito. Resto BACKLOG ou TO DO. O Todoist só recebe a DOING.",
    `doingLabels: contexto só da DOING, entre ${CONTEXT_LABELS.join(", ")}. Dúvida: [].`,
    "select: SEMPRE um dos cinco. Mapa: Família→Familia; Casa ou financeiro do lar→Casa; Instituto→Instituto; Loja Lua Branca→Loja; Saúde, amizades, Engenharia/IA/carreira/PagBank ou dúvida→Pessoal. Nunca null. Não invente opção.",
    "",
    "Projetos PARA já existentes:",
    existing,
    "",
    `Título: ${input.task.content}`,
    `Descrição: ${input.task.description}`,
    "Comentários:",
    comments,
  ].join("\n");
}

export function eventSlotPrompt(input: {
  readonly task: TodoistTask;
  readonly comments: readonly string[];
  readonly today: string;
}): string {
  const comments =
    input.comments.length === 0
      ? "(nenhum)"
      : input.comments.map((comment) => `- ${comment}`).join("\n");

  return [
    "Esta captura da Inbox Todoist tem a etiqueta Event: vira UM compromisso no Google Calendar.",
    "Não reescreva o título em GTD. Não invente dia, hora nem recorrência que o texto não peça.",
    `Hoje (America/Sao_Paulo): ${input.today}.`,
    "Responda só JSON:",
    '{"insufficient":false,"start":"2026-08-20T10:00:00-03:00","end":"2026-08-20T11:00:00-03:00","recurrence":null}',
    "start e end: ISO com fuso -03:00. Se só houver hora de início, end=null (o código põe 60 min).",
    "recurrence: null se for avulso. Se o texto pedir série: {\"freq\":\"DAILY\"|\"WEEKLY\"|\"MONTHLY\",\"interval\":1,\"byDay\":[\"MO\"],\"until\":\"2026-09-03\" ou null}.",
    "byDay só em WEEKLY (MO TU WE TH FR SA SU). until só se o texto disser até quando.",
    "insufficient:true se faltar dia ou hora — aí start=null, end=null, recurrence=null. Não chute amanhã.",
    "",
    `Título: ${input.task.content}`,
    `Descrição: ${input.task.description}`,
    "Comentários:",
    comments,
  ].join("\n");
}
