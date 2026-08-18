import { z } from "zod";

export const TIME_ZONE = "America/Sao_Paulo" as const;

export const FrontIdSchema = z.enum([
  "mim",
  "casa",
  "instituto",
  "loja_lua_branca",
  "familia",
]);
export type FrontId = z.infer<typeof FrontIdSchema>;

export const AgentIdSchema = z.enum([
  "pessoal",
  "infraestrutura_casa",
  "profissional_instituto",
  "operacoes_loja_lua_branca",
  "logistica_familiar",
  "mestre",
]);
export type AgentId = z.infer<typeof AgentIdSchema>;

export const SpecialistAgentIdSchema = z.enum([
  "pessoal",
  "infraestrutura_casa",
  "profissional_instituto",
  "operacoes_loja_lua_branca",
  "logistica_familiar",
]);
export type SpecialistAgentId = z.infer<typeof SpecialistAgentIdSchema>;

export const CalendarPrefixSchema = z.enum([
  "SAUDE",
  "LAR",
  "INSTITUTO",
  "LOJA",
  "FAMILIA",
  "ENGENHARIA",
]);
export type CalendarPrefix = z.infer<typeof CalendarPrefixSchema>;

export const GtdListSchema = z.enum([
  "proximas_acoes",
  "encubar",
  "arquivar",
  "projetos",
]);
export type GtdList = z.infer<typeof GtdListSchema>;

export const GtdProjectSchema = z.enum([
  "vitalidade",
  "lar",
  "familia",
  "instituto",
]);
export type GtdProject = z.infer<typeof GtdProjectSchema>;

export const KanbanColumnSchema = z.enum([
  "inbox",
  "next",
  "waiting",
  "timeblocked",
  "done",
]);
export type KanbanColumn = z.infer<typeof KanbanColumnSchema>;

export const EnergyLevelSchema = z.enum(["alta", "media", "baixa"]);
export type EnergyLevel = z.infer<typeof EnergyLevelSchema>;

export const ContextTagSchema = z.enum([
  "casa",
  "rua",
  "carro",
  "celular",
  "alta",
  "baixa",
  "compra",
]);
export type ContextTag = z.infer<typeof ContextTagSchema>;

export const CivilInstantSchema = z.object({
  iso: z.string(),
});
export type CivilInstant = z.infer<typeof CivilInstantSchema>;

export const TimeRangeSchema = z.object({
  start: CivilInstantSchema,
  end: CivilInstantSchema,
});
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const GtdActionSchema = z.object({
  id: z.string(),
  title: z.string(),
  /**
   * Frente PARA. `null` = Inbox ainda sem projeto (ex.: trabalho PagBank
   * vazado na Inbox — restrição de relógio, não frente do Life OS).
   */
  front: FrontIdSchema.nullable(),
  project: GtdProjectSchema.nullable(),
  list: GtdListSchema,
  due: CivilInstantSchema.nullable(),
  contexts: z.array(ContextTagSchema),
  physical: z.literal(true),
  url: z.string(),
});
export type GtdAction = z.infer<typeof GtdActionSchema>;

export const NotionSpecRefSchema = z.object({
  pageId: z.string(),
  title: z.string(),
  url: z.string(),
  cue: z.string(),
});
export type NotionSpecRef = z.infer<typeof NotionSpecRefSchema>;

export const CalendarEventRefSchema = z.object({
  eventId: z.string(),
  calendarId: z.string(),
  seriesId: z.string().nullable(),
  prefix: CalendarPrefixSchema,
  summary: z.string(),
  range: TimeRangeSchema,
  protectedSlot: z.boolean(),
  specUrl: z.string().nullable(),
  cue: z.string().nullable(),
});
export type CalendarEventRef = z.infer<typeof CalendarEventRefSchema>;

export const TimeBlockKindSchema = z.enum([
  "protected_series",
  "exception_occurrence",
  "flex_timeblock",
  "travel_buffer",
]);
export type TimeBlockKind = z.infer<typeof TimeBlockKindSchema>;

export const TimeBlockProposalSchema = z.object({
  agentId: SpecialistAgentIdSchema,
  front: FrontIdSchema,
  prefix: CalendarPrefixSchema,
  title: z.string().min(3).max(64),
  range: TimeRangeSchema,
  kind: TimeBlockKindSchema,
  gtdActionId: z.string().nullable(),
  spec: NotionSpecRefSchema.nullable(),
  cue: z.string().min(1).max(140),
  energy: EnergyLevelSchema,
  priority: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  conflictsWithProtected: z.boolean(),
  rationale: z.string().max(280),
});
export type TimeBlockProposal = z.infer<typeof TimeBlockProposalSchema>;

export const KanbanCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  front: FrontIdSchema,
  column: KanbanColumnSchema,
  gtdActionId: z.string().nullable(),
});
export type KanbanCard = z.infer<typeof KanbanCardSchema>;

export const KanbanMoveSchema = z.object({
  cardId: z.string(),
  from: KanbanColumnSchema,
  to: KanbanColumnSchema,
  front: FrontIdSchema,
  gtdActionId: z.string().nullable(),
  timeBlock: TimeRangeSchema.nullable(),
});
export type KanbanMove = z.infer<typeof KanbanMoveSchema>;

export const DailyPlanSchema = z.object({
  date: z.string(),
  generatedAt: CivilInstantSchema,
  blocks: z.array(TimeBlockProposalSchema),
  kanban: z.array(KanbanMoveSchema),
  uncoveredFronts: z.array(FrontIdSchema),
  notes: z.array(z.string()),
});
export type DailyPlan = z.infer<typeof DailyPlanSchema>;

export const SpecialistConstraintsSchema = z.object({
  plantao: z.boolean(),
  ritoNoSabado: z.boolean(),
  smileOrConsult: z.boolean(),
  maxNewCalendarEvents: z.number().int(),
  lojaItemLimit: z.literal(1),
  institutoDeliveries: z.literal(1),
});
export type SpecialistConstraints = z.infer<typeof SpecialistConstraintsSchema>;

export const SpecialistOutputSchema = z.object({
  agentId: SpecialistAgentIdSchema,
  front: FrontIdSchema,
  proposals: z.array(TimeBlockProposalSchema).max(3),
  kanbanMoves: z.array(KanbanMoveSchema),
  todoistTodayIds: z.array(z.string()).max(8),
  uncovered: z.boolean(),
  warnings: z.array(z.string().max(200)).max(8),
});
export type SpecialistOutput = z.infer<typeof SpecialistOutputSchema>;

export const RejectedReasonSchema = z.enum([
  "protected_overlap",
  "pagbank_overlap",
  "sleep_overlap",
  "lunch_overlap",
  "noise_cap",
  "duplicate_front_flex",
  "loja_second_item",
  "instituto_second_delivery",
  "no_physical_action",
  "past_slot",
  "schema_invalid",
]);
export type RejectedReason = z.infer<typeof RejectedReasonSchema>;

export const RejectedProposalSchema = z.object({
  proposal: TimeBlockProposalSchema,
  reason: RejectedReasonSchema,
});
export type RejectedProposal = z.infer<typeof RejectedProposalSchema>;

export const OrchestratorResultSchema = z.object({
  plan: DailyPlanSchema,
  writtenEventIds: z.array(z.string()),
  skipped: z.array(z.string()),
  rejected: z.array(RejectedProposalSchema),
  partial: z.boolean(),
});
export type OrchestratorResult = z.infer<typeof OrchestratorResultSchema>;

export const ListQuerySchema = z.object({
  date: z.string(),
  front: z.union([FrontIdSchema, z.literal("all")]),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

export const NotionHubRefSchema = z.object({
  front: FrontIdSchema,
  pageId: z.string(),
  url: z.string(),
});
export type NotionHubRef = z.infer<typeof NotionHubRefSchema>;

export const DailyPlanPageSchema = z.object({
  pageId: z.string(),
  date: z.string(),
  url: z.string(),
  blocksWritten: z.number().int().nonnegative(),
});
export type DailyPlanPage = z.infer<typeof DailyPlanPageSchema>;

export const NotionSpecRowSchema = z.object({
  pageId: z.string(),
  name: z.string(),
  pilar: z.string(),
  prefixo: CalendarPrefixSchema,
  slot: z.string(),
  calendarIds: z.array(z.string()),
  cue: z.string(),
  status: z.enum(["ativo", "rascunho"]),
  url: z.string(),
});
export type NotionSpecRow = z.infer<typeof NotionSpecRowSchema>;

export const TodoistTaskSnapshotSchema = z.object({
  id: z.string(),
  content: z.string(),
  projectId: z.string(),
  sectionId: z.string().nullable(),
  labels: z.array(z.string()),
  dueDate: z.string().nullable(),
  dueDatetime: z.string().nullable(),
  isCompleted: z.boolean(),
  url: z.string(),
});
export type TodoistTaskSnapshot = z.infer<typeof TodoistTaskSnapshotSchema>;

export const TodoistProjectRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type TodoistProjectRef = z.infer<typeof TodoistProjectRefSchema>;

export const BusyQuerySchema = z.object({
  date: z.string(),
  calendarIds: z.array(z.string()),
});
export type BusyQuery = z.infer<typeof BusyQuerySchema>;

export const UpsertFlexEventInputSchema = z.object({
  lifeOsKey: z.string(),
  prefix: CalendarPrefixSchema,
  title: z.string(),
  range: TimeRangeSchema,
  cue: z.string(),
  specUrl: z.string().nullable(),
  specTitle: z.string().nullable(),
  colorId: z.string(),
  transparency: z.enum(["opaque", "transparent"]),
});
export type UpsertFlexEventInput = z.infer<typeof UpsertFlexEventInputSchema>;

export const DeleteOccurrenceInputSchema = z.object({
  eventId: z.string(),
  calendarId: z.string(),
  reason: z.enum(["plantao", "smile", "rito", "user_exception"]),
});
export type DeleteOccurrenceInput = z.infer<typeof DeleteOccurrenceInputSchema>;

export const IntegrationProviderSchema = z.enum([
  "todoist",
  "notion",
  "google_calendar",
  "llm",
]);
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;

export const IntegrationErrorCodeSchema = z.enum([
  "unauthorized",
  "not_found",
  "rate_limited",
  "timeout",
  "conflict",
  "validation",
  "forbidden_write",
  "unavailable",
]);
export type IntegrationErrorCode = z.infer<typeof IntegrationErrorCodeSchema>;

export const IntegrationErrorSchema = z.object({
  provider: IntegrationProviderSchema,
  code: IntegrationErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  retryAfterMs: z.number().nullable(),
  cause: z.unknown(),
});
export type IntegrationError = z.infer<typeof IntegrationErrorSchema>;

export const IntegrationConfigSchema = z.object({
  todoistToken: z.string(),
  notionApiKey: z.string(),
  googleCalendarId: z.string(),
  googleCalendarInstitutoId: z.string(),
});
export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;
