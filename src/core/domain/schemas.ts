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
  dueString: z.string().nullable(),
  isRecurring: z.boolean(),
  priority: z.number().int(),
  durationMinutes: z.number().int().positive().nullable(),
  isCompleted: z.boolean(),
  url: z.string(),
});
export type TodoistTask = z.infer<typeof TodoistTaskSchema>;

export const TodoistCommentSchema = z.object({
  content: z.string(),
  attachmentName: z.string().nullable(),
  attachmentUrl: z.string().nullable(),
});
export type TodoistComment = z.infer<typeof TodoistCommentSchema>;

export const TodoistReminderSchema = z.object({
  type: z.enum(["relative", "absolute"]),
  minuteOffset: z.number().int().nullable(),
  dueDatetime: z.string().nullable(),
  service: z.enum(["push", "email"]).nullable(),
});
export type TodoistReminder = z.infer<typeof TodoistReminderSchema>;

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

export const UpcomingEventRecordSchema = z.object({
  pageId: z.string(),
  title: z.string(),
  url: z.string(),
  calendarEventId: z.string().nullable(),
  calendarHtmlLink: z.string().nullable(),
});
export type UpcomingEventRecord = z.infer<typeof UpcomingEventRecordSchema>;

export const UpsertUpcomingEventInputSchema = z.object({
  pageId: z.string().nullable(),
  title: z.string(),
  startIso: z.string(),
  recurrenceLabel: z.string().nullable(),
  markdown: z.string(),
  calendarEventId: z.string().nullable(),
  calendarHtmlLink: z.string().nullable(),
});
export type UpsertUpcomingEventInput = z.infer<
  typeof UpsertUpcomingEventInputSchema
>;

export const CalendarEventSchema = z.object({
  eventId: z.string(),
  calendarId: z.string(),
  summary: z.string(),
  range: TimeRangeSchema,
  htmlLink: z.string().nullable(),
  allDay: z.boolean(),
  description: z.string().nullable(),
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
  byMonthDay: z.number().int().min(1).max(31).nullable().default(null),
  until: z.string().nullable().default(null),
});
export type EventRecurrence = z.infer<typeof EventRecurrenceSchema>;

export const CalendarReminderSchema = z.object({
  method: z.enum(["popup", "email"]),
  minutes: z.number().int().nonnegative(),
});
export type CalendarReminder = z.infer<typeof CalendarReminderSchema>;

export const UpsertEventInputSchema = z.object({
  eventId: z.string().nullable(),
  calendarId: z.string(),
  summary: z.string(),
  range: TimeRangeSchema,
  description: z.string().nullable(),
  recurrence: EventRecurrenceSchema.nullable(),
  reminders: z.array(CalendarReminderSchema).nullable(),
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
  notionUpcomingEventsDbId: z.string(),
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

export const InboxEventOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    taskId: z.string(),
    status: z.literal("promoted"),
    notionUrl: z.string(),
    eventId: z.string(),
  }),
  z.object({
    taskId: z.string(),
    status: z.literal("pendencia"),
    reason: z.string(),
  }),
  z.object({
    taskId: z.string(),
    status: z.literal("failed"),
    message: z.string(),
  }),
]);
export type InboxEventOutcome = z.infer<typeof InboxEventOutcomeSchema>;

export const InboxEventRunSchema = z.object({
  scanned: z.number().int().nonnegative(),
  promoted: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  outcomes: z.array(InboxEventOutcomeSchema),
});
export type InboxEventRun = z.infer<typeof InboxEventRunSchema>;
