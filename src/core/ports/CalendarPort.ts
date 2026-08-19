import type { Result } from "../domain/result.js";
import type {
  CalendarEvent,
  DeleteEventInput,
  ListEventsQuery,
  UpsertEventInput,
} from "../domain/schemas.js";

/**
 * Porta Google Calendar. O domínio não importa `googleapis`.
 */
export interface CalendarPort {
  listEvents(query: ListEventsQuery): Promise<Result<readonly CalendarEvent[]>>;
  upsertEvent(input: UpsertEventInput): Promise<Result<CalendarEvent>>;
  deleteEvent(input: DeleteEventInput): Promise<Result<void>>;
}

export type IGoogleCalendarPort = CalendarPort;
