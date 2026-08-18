import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { FRONT_CATALOG } from "../catalog.js";
import {
  TIME_ZONE,
  TimeBlockProposalSchema,
  type CalendarEventRef,
  type CivilInstant,
  type DailyPlan,
  type FrontId,
  type GtdAction,
  type KanbanCard,
  type KanbanMove,
  type NotionSpecRef,
  type RejectedProposal,
  type SpecialistAgentId,
  type SpecialistConstraints,
  type SpecialistOutput,
  type TimeBlockProposal,
  type TimeRange,
  type TodoistProjectRef,
  type UpsertFlexEventInput,
} from "../schemas.js";
import {
  casaActionEligibleToday,
  parseProposalInstant,
  resolveCasaFlexRange,
  sanitizeProposalCopy,
  selectCasaFallbackAction,
  SPECIALIST_ISOLATION_HINT,
  stripLegacySchedulePrefix,
} from "./proposal-guard.js";
import {
  MASTER_CALLOUT_PROMPT,
  SPECIALIST_ORDER,
  SPECIALIST_SYSTEM_PROMPTS,
  TRIAGE_SYSTEM_PROMPT,
  frontOfAgent,
} from "./specialist-prompts.js";

export const SPECIALIST_TIMEOUT_MS = 25_000;
export const CORPORATE_WINDOW = {
  start: "09:00:00",
  end: "18:00:00",
} as const;

const FRONT_TIEBREAK: readonly FrontId[] = [
  "familia",
  "mim",
  "casa",
  "instituto",
  "loja_lua_branca",
];

const WEEKDAY_PT = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
] as const;

const DEFAULT_CONSTRAINTS: SpecialistConstraints = {
  plantao: false,
  ritoNoSabado: false,
  smileOrConsult: false,
  maxNewCalendarEvents: 3,
  lojaItemLimit: 1,
  institutoDeliveries: 1,
};

const TriageTargetSchema = z.enum([
  "pessoal",
  "infraestrutura_casa",
  "profissional_instituto",
  "operacoes_loja_lua_branca",
  "logistica_familiar",
  "ignore_pagbank",
]);

export const DelegationSchema = z.object({
  actionId: z.string(),
  agentId: TriageTargetSchema,
  rationale: z.string().max(280),
});
export type Delegation = z.infer<typeof DelegationSchema>;

const TriageResultSchema = z.object({
  delegations: z.array(DelegationSchema),
});

const SpecialistDraftProposalSchema = z.object({
  title: z.string().min(3).max(64),
  start: z.string().min(4).max(32),
  end: z.string().min(4).max(32),
  cue: z.string().min(1).max(140),
  gtdActionId: z.string().nullable(),
  energy: z.enum(["alta", "media", "baixa"]),
  priority: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  rationale: z.string().max(280),
});

const SpecialistDraftSchema = z.object({
  proposals: z.array(SpecialistDraftProposalSchema).max(3),
  kanbanMoves: z
    .array(
      z.object({
        cardId: z.string(),
        from: z.enum(["inbox", "next", "waiting", "timeblocked", "done"]),
        to: z.enum(["inbox", "next", "waiting", "timeblocked", "done"]),
      }),
    )
    .max(3),
  todoistTodayIds: z.array(z.string()).max(8),
  uncovered: z.boolean(),
  warnings: z.array(z.string().max(200)).max(8),
});

const CalloutSchema = z.object({
  callout: z.string().min(1).max(140),
});

export class LlmConfigError extends Error {
  override readonly name = "LlmConfigError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Estado compartilhado do grafo (spec 02 + Inbox/projetos do passo 4).
 */
export interface AgentState {
  readonly date: string;
  readonly now: CivilInstant;
  readonly inbox: readonly GtdAction[];
  readonly projects: readonly TodoistProjectRef[];
  readonly specs: readonly NotionSpecRef[];
  readonly kanban: readonly KanbanCard[];
  readonly occupied: readonly CalendarEventRef[];
  readonly rites: readonly CalendarEventRef[];
  readonly gaps: readonly TimeRange[];
  readonly constraints: SpecialistConstraints;
  readonly delegations: readonly Delegation[];
  readonly specialistOutputs: readonly SpecialistOutput[];
  readonly plan: DailyPlan;
  readonly conflicts: readonly RejectedProposal[];
  readonly calendarWrites: readonly UpsertFlexEventInput[];
  readonly todoistTodayIds: readonly string[];
}

function replace<T>(empty: () => T) {
  return Annotation<T>({
    reducer: (_left: T, right: T) => right,
    default: empty,
  });
}

export const AgentStateAnnotation = Annotation.Root({
  date: Annotation<string>,
  now: Annotation<CivilInstant>,
  inbox: replace<GtdAction[]>(() => []),
  projects: replace<TodoistProjectRef[]>(() => []),
  specs: replace<NotionSpecRef[]>(() => []),
  kanban: replace<KanbanCard[]>(() => []),
  occupied: replace<CalendarEventRef[]>(() => []),
  rites: replace<CalendarEventRef[]>(() => []),
  gaps: replace<TimeRange[]>(() => []),
  constraints: replace<SpecialistConstraints>(() => DEFAULT_CONSTRAINTS),
  delegations: replace<Delegation[]>(() => []),
  specialistOutputs: replace<SpecialistOutput[]>(() => []),
  plan: Annotation<DailyPlan>,
  conflicts: replace<RejectedProposal[]>(() => []),
  calendarWrites: replace<UpsertFlexEventInput[]>(() => []),
  todoistTodayIds: replace<string[]>(() => []),
});

type GraphState = typeof AgentStateAnnotation.State;
type GraphUpdate = typeof AgentStateAnnotation.Update;

export function emptyDailyPlan(
  date: string,
  generatedAt: CivilInstant,
): DailyPlan {
  return {
    date,
    generatedAt,
    blocks: [],
    kanban: [],
    uncoveredFronts: [],
    notes: [],
  };
}

function createReasoningModel(): ChatOpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LlmConfigError(
      "OPENAI_API_KEY ausente — o motor LangGraph precisa da chave para raciocinar",
    );
  }

  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0,
    apiKey,
    timeout: SPECIALIST_TIMEOUT_MS,
  });
}

async function invokeStructured<T>(
  llm: ChatOpenAI,
  schema: z.ZodType<T>,
  schemaName: string,
  system: string,
  user: string,
): Promise<T> {
  const runnable = llm.withStructuredOutput(schema, {
    name: schemaName,
    strict: true,
  });
  const raw: unknown = await runnable.invoke([
    new SystemMessage(system),
    new HumanMessage(user),
  ]);
  return schema.parse(raw);
}

async function triageNode(
  state: GraphState,
  llm: ChatOpenAI,
): Promise<GraphUpdate> {
  const weekday = weekdayInSaoPaulo(state.date);
  const constraints = detectConstraints(state.date, state.occupied, state.rites);
  const gaps = computeGaps(state.date, state.occupied);

  const user = [
    `DATE: ${state.date}`,
    `WEEKDAY: ${weekday} (${WEEKDAY_PT[weekday]})`,
    `NOW: ${state.now.iso}`,
    `PROJECTS: ${JSON.stringify(state.projects)}`,
    `SPECS: ${JSON.stringify(state.specs.map((spec) => spec.title))}`,
    `INBOX: ${JSON.stringify(
      state.inbox.map((action) => ({
        id: action.id,
        title: action.title,
        front: action.front,
        project: action.project,
        contexts: action.contexts,
        due: action.due,
      })),
    )}`,
    "Devolva delegations para cada item da Inbox.",
  ].join("\n");

  const result = await invokeStructured(
    llm,
    TriageResultSchema,
    "TriageResult",
    TRIAGE_SYSTEM_PROMPT,
    user,
  );

  const inboxIds = new Set(state.inbox.map((action) => action.id));
  const seen = new Set<string>();
  const delegations: Delegation[] = [];

  for (const row of result.delegations) {
    if (!inboxIds.has(row.actionId) || seen.has(row.actionId)) {
      continue;
    }
    seen.add(row.actionId);
    delegations.push(row);
  }

  for (const action of state.inbox) {
    if (seen.has(action.id)) {
      continue;
    }
    delegations.push({
      actionId: action.id,
      agentId: inferDelegation(action),
      rationale: "Fallback: item sem delegação do LLM.",
    });
    seen.add(action.id);
  }

  console.log("[LifeOsGraph.triage]", {
    date: state.date,
    delegations: delegations.map((row) => ({
      actionId: row.actionId,
      agentId: row.agentId,
    })),
  });

  return { constraints, gaps, delegations };
}

async function specialistNode(
  state: GraphState,
  llm: ChatOpenAI,
): Promise<GraphUpdate> {
  const weekday = weekdayInSaoPaulo(state.date);
  const outputs = await Promise.all(
    SPECIALIST_ORDER.map((agentId) =>
      runSpecialist(llm, state, agentId, weekday),
    ),
  );

  console.log("[LifeOsGraph.specialist]", {
    outputs: outputs.map((out) => ({
      agentId: out.agentId,
      proposals: out.proposals.length,
      uncovered: out.uncovered,
      warnings: out.warnings,
    })),
  });

  return { specialistOutputs: outputs };
}

async function builderNode(
  state: GraphState,
  llm: ChatOpenAI,
): Promise<GraphUpdate> {
  const weekday = weekdayInSaoPaulo(state.date);
  const ignored = state.delegations.filter(
    (row) => row.agentId === "ignore_pagbank",
  );
  const merged: TimeBlockProposal[] = [];
  const rejected: RejectedProposal[] = [];
  const kanban: KanbanMove[] = [];
  const todayIds = new Set<string>();
  const notes: string[] = [];

  if (ignored.length > 0) {
    notes.push(
      `PagBank ignorado pelo orquestrador (${ignored.length} item(ns)); timebox 09:00–18:00.`,
    );
  }

  for (const out of state.specialistOutputs) {
    try {
      assertOwnFront(out);
    } catch (cause: unknown) {
      notes.push(cause instanceof Error ? cause.message : String(cause));
      continue;
    }

    for (const move of out.kanbanMoves) {
      kanban.push(move);
    }
    for (const id of out.todoistTodayIds) {
      todayIds.add(id);
    }
    if (out.uncovered) {
      notes.push(`Frente ${out.front} descoberta (${out.agentId}).`);
    }
    notes.push(...out.warnings);

    for (const proposal of out.proposals) {
      if (proposal.kind === "protected_series") {
        continue;
      }
      merged.push(proposal);
    }
  }

  const policy = applyPolicies({
    date: state.date,
    now: state.now,
    weekday,
    occupied: state.occupied,
    proposals: merged,
  });
  rejected.push(...policy.rejected);

  const calendarWrites = policy.accepted.map((proposal) =>
    toCalendarWrite(state.date, proposal),
  );

  for (const proposal of policy.accepted) {
    if (proposal.gtdActionId) {
      todayIds.add(proposal.gtdActionId);
    }
  }

  const uncoveredFronts = state.specialistOutputs
    .filter((out) => out.uncovered)
    .map((out) => out.front);

  const callout = await narratePlan(llm, policy.accepted, state.constraints);
  notes.unshift(callout);

  const plan: DailyPlan = {
    date: state.date,
    generatedAt: state.now,
    blocks: policy.accepted,
    kanban,
    uncoveredFronts,
    notes: notes.filter((note, index, all) => all.indexOf(note) === index),
  };

  console.log("[LifeOsGraph.builder]", {
    accepted: policy.accepted.map((block) => block.title),
    rejected: rejected.map((row) => ({
      title: row.proposal.title,
      reason: row.reason,
    })),
    calendarWrites: calendarWrites.length,
  });

  return {
    plan,
    conflicts: rejected,
    calendarWrites,
    todoistTodayIds: [...todayIds],
  };
}

async function runSpecialist(
  llm: ChatOpenAI,
  state: GraphState,
  agentId: SpecialistAgentId,
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6,
): Promise<SpecialistOutput> {
  const front = frontOfAgent(agentId);
  const delegatedIds = new Set(
    state.delegations
      .filter((row) => row.agentId === agentId)
      .map((row) => row.actionId),
  );
  const delegatedAway = new Set(
    state.delegations
      .filter((row) => row.agentId !== agentId)
      .map((row) => row.actionId),
  );
  const actions = state.inbox.filter(
    (action) =>
      delegatedIds.has(action.id) ||
      (action.front === front && !delegatedAway.has(action.id)),
  );
  const specs = state.specs;
  const kanban = state.kanban.filter((card) => card.front === front);

  const empty: SpecialistOutput = {
    agentId,
    front,
    proposals: [],
    kanbanMoves: [],
    todoistTodayIds: [],
    uncovered: false,
    warnings: [],
  };

  const user = [
    `DATE: ${state.date}`,
    `WEEKDAY: ${weekday} (${WEEKDAY_PT[weekday]})`,
    SPECIALIST_ISOLATION_HINT,
    `CONSTRAINTS: ${JSON.stringify(state.constraints)}`,
    `OCCUPIED: ${JSON.stringify(
      state.occupied.map((event) => ({
        summary: event.summary,
        range: event.range,
        prefix: event.prefix,
      })),
    )}`,
    `GAPS: ${JSON.stringify(state.gaps)}`,
    `ACTIONS: ${JSON.stringify(
      actions.map((action) => ({
        id: action.id,
        title: action.title,
        due: action.due,
        contexts: action.contexts,
        project: action.project,
      })),
    )}`,
    `SPECS: ${JSON.stringify(specs)}`,
    `KANBAN: ${JSON.stringify(kanban)}`,
    "Devolva SpecialistDraft JSON.",
  ].join("\n");

  try {
    const draft = await withTimeout(
      invokeStructured(
        llm,
        SpecialistDraftSchema,
        `Specialist_${agentId}`,
        SPECIALIST_SYSTEM_PROMPTS[agentId],
        user,
      ),
      SPECIALIST_TIMEOUT_MS,
      agentId,
    );

    const proposals: TimeBlockProposal[] = [];
    for (const row of draft.proposals) {
      const built = toProposal(
        state.date,
        weekday,
        state.gaps,
        agentId,
        front,
        row,
        actions,
        specs,
      );
      if (built) {
        proposals.push(built);
      }
    }

    if (agentId === "infraestrutura_casa" && proposals.length === 0) {
      const candidate = selectCasaFallbackAction(actions, state.date);
      if (candidate) {
        const built = toProposal(
          state.date,
          weekday,
          state.gaps,
          agentId,
          front,
          {
            title: candidate.title.slice(0, 64),
            start: "20:00",
            end: "21:00",
            cue: candidate.title,
            gtdActionId: candidate.id,
            energy: "media",
            priority: 2,
            rationale: `Ação física de hoje: ${candidate.title}`,
          },
          actions,
          specs,
        );
        if (built) {
          proposals.push(built);
        }
      }
    }

    const actionIds = new Set(actions.map((action) => action.id));
    const cardIds = new Set(kanban.map((card) => card.id));

    return {
      agentId,
      front,
      proposals: proposals.slice(0, 3),
      kanbanMoves: draft.kanbanMoves
        .filter((move) => cardIds.has(move.cardId))
        .map((move) => ({
          cardId: move.cardId,
          from: move.from,
          to: move.to,
          front,
          gtdActionId:
            kanban.find((card) => card.id === move.cardId)?.gtdActionId ?? null,
          timeBlock: null,
        })),
      todoistTodayIds: [
        ...new Set([
          ...draft.todoistTodayIds.filter((id) => actionIds.has(id)),
          ...(agentId === "infraestrutura_casa"
            ? proposals
                .map((proposal) => proposal.gtdActionId)
                .filter((id): id is string => id !== null)
            : []),
        ]),
      ].slice(0, 8),
      uncovered:
        agentId === "infraestrutura_casa" && proposals.length > 0
          ? false
          : draft.uncovered,
      warnings: draft.warnings,
    };
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.warn("[LifeOsGraph.specialist] falha", { agentId, message });
    return {
      ...empty,
      uncovered: true,
      warnings: [`Especialista ${agentId} falhou: ${message}`.slice(0, 200)],
    };
  }
}

function toProposal(
  date: string,
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6,
  gaps: readonly TimeRange[],
  agentId: SpecialistAgentId,
  front: FrontId,
  draft: z.infer<typeof SpecialistDraftProposalSchema>,
  actions: readonly GtdAction[],
  specs: readonly NotionSpecRef[],
): TimeBlockProposal | null {
  const catalog = FRONT_CATALOG[front];
  const action =
    draft.gtdActionId === null
      ? null
      : (actions.find((item) => item.id === draft.gtdActionId) ?? null);
  if (draft.gtdActionId && !action) {
    return null;
  }

  const otherTitles = actions
    .filter((item) => item.id !== action?.id)
    .map((item) => item.title);

  const range =
    front === "casa" && casaActionEligibleToday(action, date)
      ? resolveCasaFlexRange({
          date,
          weekday,
          gaps,
          draftStart: draft.start,
          draftEnd: draft.end,
          contexts: action?.contexts ?? [],
          title: action?.title ?? draft.title,
        })
      : (() => {
          const start = parseProposalInstant(date, draft.start, weekday);
          const end = parseProposalInstant(date, draft.end, weekday);
          return start && end ? { start, end } : null;
        })();

  if (!range) {
    return null;
  }

  const sourceTitle = action?.title ?? draft.title;
  const title = stripLegacySchedulePrefix(
    stripPrefix(catalog.prefix, draft.title),
  );
  const cue = sanitizeProposalCopy(draft.cue, sourceTitle, otherTitles, 140);
  const rationale = sanitizeProposalCopy(
    draft.rationale,
    sourceTitle,
    otherTitles,
    280,
  );

  const spec =
    front === "casa"
      ? null
      : (specs.find((item) => cue.includes(item.title)) ?? null);

  const parsed = TimeBlockProposalSchema.safeParse({
    agentId,
    front,
    prefix: catalog.prefix,
    title: (title.length >= 3 ? title : sourceTitle).slice(0, 64),
    range,
    kind: "flex_timeblock",
    gtdActionId: draft.gtdActionId,
    spec,
    cue,
    energy: draft.energy,
    priority: draft.priority,
    conflictsWithProtected: false,
    rationale,
  });

  return parsed.success ? parsed.data : null;
}

function applyPolicies(input: {
  readonly date: string;
  readonly now: CivilInstant;
  readonly weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly occupied: readonly CalendarEventRef[];
  readonly proposals: readonly TimeBlockProposal[];
}): {
  readonly accepted: TimeBlockProposal[];
  readonly rejected: RejectedProposal[];
} {
  const rejected: RejectedProposal[] = [];
  const surviving: TimeBlockProposal[] = [];

  for (const proposal of input.proposals) {
    const reason = classifyRejection(proposal, input);
    if (reason) {
      rejected.push({ proposal, reason });
    } else {
      surviving.push(proposal);
    }
  }

  surviving.sort(compareFlex);

  const accepted: TimeBlockProposal[] = [];
  const fronts = new Set<FrontId>();

  for (const proposal of surviving) {
    if (accepted.length >= 3) {
      rejected.push({ proposal, reason: "noise_cap" });
      continue;
    }
    if (fronts.has(proposal.front)) {
      rejected.push({ proposal, reason: "duplicate_front_flex" });
      continue;
    }
    if (
      accepted.some((block) => rangesOverlap(block.range, proposal.range))
    ) {
      rejected.push({ proposal, reason: "duplicate_front_flex" });
      continue;
    }
    accepted.push(proposal);
    fronts.add(proposal.front);
  }

  return { accepted, rejected };
}

function classifyRejection(
  proposal: TimeBlockProposal,
  input: {
    readonly date: string;
    readonly now: CivilInstant;
    readonly weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    readonly occupied: readonly CalendarEventRef[];
  },
): RejectedProposal["reason"] | null {
  if (proposal.kind === "flex_timeblock" && !proposal.gtdActionId) {
    return "no_physical_action";
  }

  const startMs = Date.parse(proposal.range.start.iso);
  const endMs = Date.parse(proposal.range.end.iso);
  if (
    Number.isNaN(startMs) ||
    Number.isNaN(endMs) ||
    startMs >= endMs ||
    !proposal.range.start.iso.startsWith(input.date)
  ) {
    return "schema_invalid";
  }

  if (startMs <= Date.parse(input.now.iso)) {
    return "past_slot";
  }

  if (startMs < Date.parse(`${input.date}T06:00:00-03:00`)) {
    return "sleep_overlap";
  }
  if (endMs > Date.parse(`${input.date}T22:00:00-03:00`)) {
    return "sleep_overlap";
  }

  const lunch = civilRange(input.date, "12:00:00", "13:00:00");
  if (input.weekday >= 1 && input.weekday <= 5 && rangesOverlap(proposal.range, lunch)) {
    return "lunch_overlap";
  }

  if (
    input.weekday >= 1 &&
    input.weekday <= 5 &&
    overlapsCorporateTimebox(input.date, proposal.range)
  ) {
    return "pagbank_overlap";
  }

  const morningCoffee = civilRange(input.date, "08:20:00", "09:00:00");
  if (
    input.weekday >= 1 &&
    input.weekday <= 5 &&
    rangesOverlap(proposal.range, morningCoffee)
  ) {
    return "noise_cap";
  }

  if (
    input.occupied.some(
      (event) =>
        event.protectedSlot && rangesOverlap(event.range, proposal.range),
    ) ||
    proposal.conflictsWithProtected
  ) {
    return "protected_overlap";
  }

  if (proposal.front === "loja_lua_branca") {
    return "loja_second_item";
  }
  if (proposal.front === "instituto") {
    return "instituto_second_delivery";
  }

  return null;
}

function compareFlex(a: TimeBlockProposal, b: TimeBlockProposal): number {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  const duration =
    durationMs(a.range) - durationMs(b.range);
  if (duration !== 0) {
    return duration;
  }
  return FRONT_TIEBREAK.indexOf(a.front) - FRONT_TIEBREAK.indexOf(b.front);
}

function toCalendarWrite(
  date: string,
  proposal: TimeBlockProposal,
): UpsertFlexEventInput {
  const catalog = FRONT_CATALOG[proposal.front];
  return {
    lifeOsKey: `lifeos:${date}:${proposal.front}:${proposal.gtdActionId ?? "none"}`,
    prefix: proposal.prefix,
    title: `${proposal.prefix} - ${stripPrefix(proposal.prefix, proposal.title)}`,
    range: proposal.range,
    cue: proposal.cue,
    specUrl: proposal.spec?.url ?? null,
    specTitle: proposal.spec?.title ?? null,
    colorId: catalog.colorId,
    transparency: "opaque",
  };
}

async function narratePlan(
  llm: ChatOpenAI,
  accepted: readonly TimeBlockProposal[],
  constraints: SpecialistConstraints,
): Promise<string> {
  const fallback = "Todoist «Ao acordar». Sair ~07:00 com o Arthur.";
  try {
    const result = await invokeStructured(
      llm,
      CalloutSchema,
      "DailyPlanCallout",
      MASTER_CALLOUT_PROMPT,
      `ACCEPTED_BLOCKS: ${JSON.stringify(accepted.map((block) => ({
        prefix: block.prefix,
        title: block.title,
        cue: block.cue,
        range: block.range,
      })))}\nCONSTRAINTS: ${JSON.stringify(constraints)}`,
    );
    return result.callout.replaceAll("\n", " ").slice(0, 140);
  } catch {
    return fallback;
  }
}

function detectConstraints(
  date: string,
  occupied: readonly CalendarEventRef[],
  rites: readonly CalendarEventRef[],
): SpecialistConstraints {
  const weekday = weekdayInSaoPaulo(date);
  const plantao = occupied.some((event) =>
    /plant[aã]o/i.test(event.summary),
  );
  const smileOrConsult = occupied.some(
    (event) =>
      event.prefix === "SAUDE" &&
      !event.protectedSlot &&
      rangesOverlap(event.range, civilRange(date, "17:30:00", "20:00:00")),
  );

  return {
    plantao,
    ritoNoSabado: weekday === 6 && rites.length > 0,
    smileOrConsult,
    maxNewCalendarEvents: 3,
    lojaItemLimit: 1,
    institutoDeliveries: 1,
  };
}

function computeGaps(
  date: string,
  occupied: readonly CalendarEventRef[],
): TimeRange[] {
  const weekday = weekdayInSaoPaulo(date);
  const window = civilRange(date, "06:00:00", "22:00:00");
  const blocked: TimeRange[] = occupied.map((event) => event.range);

  if (weekday >= 1 && weekday <= 5) {
    blocked.push(civilRange(date, "09:00:00", "12:00:00"));
    blocked.push(civilRange(date, "12:00:00", "13:00:00"));
    blocked.push(civilRange(date, "13:00:00", "18:00:00"));
  }
  if (weekday === 6) {
    blocked.push(civilRange(date, "09:00:00", "12:00:00"));
  }

  return subtractBusy(window, blocked).filter(
    (gap) => durationMs(gap) >= 25 * 60 * 1000,
  );
}

function subtractBusy(
  window: TimeRange,
  busy: readonly TimeRange[],
): TimeRange[] {
  const windowStart = Date.parse(window.start.iso);
  const windowEnd = Date.parse(window.end.iso);
  const blocks = busy
    .map((range) => ({
      start: Math.max(windowStart, Date.parse(range.start.iso)),
      end: Math.min(windowEnd, Date.parse(range.end.iso)),
    }))
    .filter((block) => block.start < block.end)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (!last || block.start > last.end) {
      merged.push({ ...block });
    } else {
      last.end = Math.max(last.end, block.end);
    }
  }

  const gaps: TimeRange[] = [];
  let cursor = windowStart;
  for (const block of merged) {
    if (block.start > cursor) {
      gaps.push(msRange(cursor, block.start));
    }
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < windowEnd) {
    gaps.push(msRange(cursor, windowEnd));
  }
  return gaps;
}

function assertOwnFront(out: SpecialistOutput): void {
  if (out.proposals.some((proposal) => proposal.front !== out.front)) {
    throw new Error(`Especialista ${out.agentId} propôs frente alheia`);
  }
}

function inferDelegation(action: GtdAction): Delegation["agentId"] {
  const haystack = `${action.title} ${action.id}`.toLowerCase();
  if (
    /pagbank|concilia|recebív|engenharia|bug de/.test(haystack) ||
    action.front === null
  ) {
    return "ignore_pagbank";
  }
  if (action.front) {
    return FRONT_CATALOG[action.front].agentId;
  }
  return "ignore_pagbank";
}

function stripPrefix(prefix: string, title: string): string {
  return title.replace(new RegExp(`^${prefix}\\s*-\\s*`, "i"), "").slice(0, 64);
}

function overlapsCorporateTimebox(date: string, range: TimeRange): boolean {
  const weekday = weekdayInSaoPaulo(date);
  if (weekday === 0 || weekday === 6) {
    return false;
  }
  return rangesOverlap(
    range,
    civilRange(date, CORPORATE_WINDOW.start, CORPORATE_WINDOW.end),
  );
}

function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return (
    Date.parse(a.start.iso) < Date.parse(b.end.iso) &&
    Date.parse(a.end.iso) > Date.parse(b.start.iso)
  );
}

function durationMs(range: TimeRange): number {
  return Date.parse(range.end.iso) - Date.parse(range.start.iso);
}

function civilRange(date: string, start: string, end: string): TimeRange {
  return {
    start: { iso: `${date}T${start}-03:00` },
    end: { iso: `${date}T${end}-03:00` },
  };
}

function msRange(startMs: number, endMs: number): TimeRange {
  return {
    start: { iso: toCivilIso(startMs) },
    end: { iso: toCivilIso(endMs) },
  };
}

function toCivilIso(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));

  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}-03:00`;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout ${label} (${ms}ms)`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

export function civilDateNow(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function civilNowIso(now: Date = new Date()): string {
  return toCivilIso(now.getTime());
}

export function weekdayInSaoPaulo(date: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const instant = new Date(`${date}T12:00:00-03:00`);
  return instant.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * Compila o StateGraph triage → specialist → builder.
 */
export function createLifeOsGraph() {
  const llm = createReasoningModel();

  return new StateGraph(AgentStateAnnotation)
    .addNode("triage", (state) => triageNode(state, llm))
    .addNode("specialist", (state) => specialistNode(state, llm))
    .addNode("builder", (state) => builderNode(state, llm))
    .addEdge(START, "triage")
    .addEdge("triage", "specialist")
    .addEdge("specialist", "builder")
    .addEdge("builder", END)
    .compile();
}

export type LifeOsGraph = ReturnType<typeof createLifeOsGraph>;
