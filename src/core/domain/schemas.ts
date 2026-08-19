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
  inboxProject: z.boolean(),
});
export type TodoistProject = z.infer<typeof TodoistProjectSchema>;

export const NotionPageSchema = z.object({
  pageId: z.string(),
  title: z.string(),
  url: z.string(),
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
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const ListEventsQuerySchema = z.object({
  date: z.string(),
  calendarId: z.string(),
});
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

export const UpsertEventInputSchema = z.object({
  eventId: z.string().nullable(),
  calendarId: z.string(),
  summary: z.string(),
  range: TimeRangeSchema,
  description: z.string().nullable(),
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
