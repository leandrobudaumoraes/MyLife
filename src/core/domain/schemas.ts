import { z } from "zod";

export const TIME_ZONE = "America/Sao_Paulo" as const;

export const CivilInstantSchema = z.object({
  iso: z.string(),
});
export type CivilInstant = z.infer<typeof CivilInstantSchema>;

export const TimeRangeSchema = z.object({
  start: CivilInstantSchema,
  end: CivilInstantSchema,
});
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const TodoistTaskSchema = z.object({
  id: z.string(),
  content: z.string(),
  description: z.string(),
  projectId: z.string(),
  sectionId: z.string().nullable(),
  labels: z.array(z.string()),
  dueDate: z.string().nullable(),
  dueDatetime: z.string().nullable(),
  isCompleted: z.boolean(),
  url: z.string(),
});
export type TodoistTask = z.infer<typeof TodoistTaskSchema>;

export const TodoistProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  inboxProject: z.boolean(),
});
export type TodoistProject = z.infer<typeof TodoistProjectSchema>;

export const TodoistLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});
export type TodoistLabel = z.infer<typeof TodoistLabelSchema>;

export const ListTasksQuerySchema = z.object({
  projectId: z.string(),
});
export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;

export const CreateTodoistProjectInputSchema = z.object({
  name: z.string(),
  parentId: z.string().nullable(),
});
export type CreateTodoistProjectInput = z.infer<
  typeof CreateTodoistProjectInputSchema
>;

export const CreateTodoistLabelInputSchema = z.object({
  name: z.string(),
  color: z.string(),
});
export type CreateTodoistLabelInput = z.infer<
  typeof CreateTodoistLabelInputSchema
>;

export const TodoistFilterSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string(),
});
export type TodoistFilter = z.infer<typeof TodoistFilterSchema>;

export const CreateTodoistFilterInputSchema = z.object({
  name: z.string(),
  query: z.string(),
  color: z.string(),
});
export type CreateTodoistFilterInput = z.infer<
  typeof CreateTodoistFilterInputSchema
>;

export const CreateTodoistTaskInputSchema = z.object({
  content: z.string(),
  projectId: z.string(),
  labels: z.array(z.string()),
});
export type CreateTodoistTaskInput = z.infer<typeof CreateTodoistTaskInputSchema>;

export const UpdateTodoistTaskPatchSchema = z.object({
  content: z.string().optional(),
  labels: z.array(z.string()).optional(),
});
export type UpdateTodoistTaskPatch = z.infer<typeof UpdateTodoistTaskPatchSchema>;

export const KanbanColumnSchema = z.enum([
  "BACKLOG",
  "TO DO",
  "DOING",
  "DONE",
]);
export type KanbanColumn = z.infer<typeof KanbanColumnSchema>;

export const NotionProjectSelectSchema = z.enum([
  "Pessoal",
  "Familia",
  "Loja",
  "Casa",
  "Instituto",
]);
export type NotionProjectSelect = z.infer<typeof NotionProjectSelectSchema>;

export const UpsertProjectPageInputSchema = z.object({
  title: z.string(),
  select: NotionProjectSelectSchema.nullable(),
  markInProgress: z.boolean().default(true),
});
export type UpsertProjectPageInput = z.infer<typeof UpsertProjectPageInputSchema>;

export const ProjectTaskCardSchema = z.object({
  pageId: z.string(),
  title: z.string(),
  column: KanbanColumnSchema,
});
export type ProjectTaskCard = z.infer<typeof ProjectTaskCardSchema>;

export const ProjectTaskBoardSchema = z.object({
  dataSourceId: z.string(),
  tasks: z.array(ProjectTaskCardSchema),
});
export type ProjectTaskBoard = z.infer<typeof ProjectTaskBoardSchema>;

export const CreateProjectTaskInputSchema = z.object({
  dataSourceId: z.string(),
  title: z.string(),
  column: KanbanColumnSchema,
});
export type CreateProjectTaskInput = z.infer<typeof CreateProjectTaskInputSchema>;

export const ProjectEventCardSchema = z.object({
  pageId: z.string(),
  title: z.string(),
});
export type ProjectEventCard = z.infer<typeof ProjectEventCardSchema>;

export const ProjectEventBoardSchema = z.object({
  dataSourceId: z.string(),
  events: z.array(ProjectEventCardSchema),
});
export type ProjectEventBoard = z.infer<typeof ProjectEventBoardSchema>;

export const CreateProjectEventInputSchema = z.object({
  dataSourceId: z.string(),
  title: z.string(),
  date: z.string(),
  markdown: z.string(),
});
export type CreateProjectEventInput = z.infer<
  typeof CreateProjectEventInputSchema
>;

export const UpdateProjectTaskColumnInputSchema = z.object({
  pageId: z.string(),
  column: KanbanColumnSchema,
});
export type UpdateProjectTaskColumnInput = z.infer<
  typeof UpdateProjectTaskColumnInputSchema
>;

export const InboxRoutingSchema = z.enum([
  "Next",
  "Maybe",
  "Archive",
  "Project",
  "Event",
]);
export type InboxRouting = z.infer<typeof InboxRoutingSchema>;

export const InboxRunItemSchema = z.object({
  taskId: z.string(),
  routing: InboxRoutingSchema,
  detail: z.string(),
});
export type InboxRunItem = z.infer<typeof InboxRunItemSchema>;

export const AdvancedDoingItemSchema = z.object({
  projectName: z.string(),
  taskTitle: z.string(),
});
export type AdvancedDoingItem = z.infer<typeof AdvancedDoingItemSchema>;

export const InboxRunSchema = z.object({
  labelsCreated: z.array(z.string()),
  filtersCreated: z.array(z.string()),
  projectsCreated: z.array(z.string()),
  processed: z.array(InboxRunItemSchema),
  advanced: z.array(AdvancedDoingItemSchema),
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});
export type InboxRun = z.infer<typeof InboxRunSchema>;

export const NotionPageSchema = z.object({
  pageId: z.string(),
  title: z.string(),
  url: z.string(),
  status: z.string().nullable(),
});
export type NotionPage = z.infer<typeof NotionPageSchema>;

export const UpsertChildPageInputSchema = z.object({
  parentId: z.string(),
  title: z.string(),
  markdown: z.string(),
});
export type UpsertChildPageInput = z.infer<typeof UpsertChildPageInputSchema>;

export const CalendarEventSchema = z.object({
  eventId: z.string(),
  calendarId: z.string(),
  summary: z.string(),
  range: TimeRangeSchema,
  htmlLink: z.string().nullable(),
  allDay: z.boolean(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const ListEventsQuerySchema = z.object({
  date: z.string(),
  untilDate: z.string().optional(),
  calendarId: z.string(),
});
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

export const EventRecurrenceFreqSchema = z.enum(["DAILY", "WEEKLY", "MONTHLY"]);
export type EventRecurrenceFreq = z.infer<typeof EventRecurrenceFreqSchema>;

export const WeekdayCodeSchema = z.enum([
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
  "SU",
]);
export type WeekdayCode = z.infer<typeof WeekdayCodeSchema>;

export const EventRecurrenceSchema = z.object({
  freq: EventRecurrenceFreqSchema,
  interval: z.number().int().positive().default(1),
  byDay: z.array(WeekdayCodeSchema).default([]),
  until: z.string().nullable().default(null),
});
export type EventRecurrence = z.infer<typeof EventRecurrenceSchema>;

export const UpsertEventInputSchema = z.object({
  eventId: z.string().nullable(),
  calendarId: z.string(),
  summary: z.string(),
  range: TimeRangeSchema,
  description: z.string().nullable(),
  recurrence: EventRecurrenceSchema.nullable(),
});
export type UpsertEventInput = z.infer<typeof UpsertEventInputSchema>;

export const DeleteEventInputSchema = z.object({
  eventId: z.string(),
  calendarId: z.string(),
});
export type DeleteEventInput = z.infer<typeof DeleteEventInputSchema>;

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

export const SmokeCheckSchema = z.object({
  todoistProjects: z.number().int().nonnegative(),
  notionPages: z.number().int().nonnegative(),
  calendarEvents: z.number().int().nonnegative(),
  llmReply: z.string(),
  graphReply: z.string(),
});
export type SmokeCheck = z.infer<typeof SmokeCheckSchema>;
