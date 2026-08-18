export const TOKENS = {
  Clock: Symbol.for("IClock"),
  Todoist: Symbol.for("ITodoistPort"),
  Notion: Symbol.for("INotionPort"),
  GoogleCalendar: Symbol.for("IGoogleCalendarPort"),
  Llm: Symbol.for("ILlmPort"),
  ProtectedSeries: Symbol.for("ProtectedSeriesCatalog"),
  Config: Symbol.for("IntegrationConfig"),
} as const;
