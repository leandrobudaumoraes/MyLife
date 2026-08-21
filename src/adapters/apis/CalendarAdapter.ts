import "reflect-metadata";

import { google, type calendar_v3 } from "googleapis";
import { inject, injectable } from "inversify";

import {
  civilDayBounds,
  civilIsoFromGoogleDateTime,
  toCivilIso,
} from "../../core/domain/clock.js";
import { err, ok, type Result } from "../../core/domain/result.js";
import {
  CalendarEventSchema,
  IntegrationErrorSchema,
  TIME_ZONE,
  type CalendarEvent,
  type DeleteEventInput,
  type EventRecurrence,
  type IntegrationConfig,
  type IntegrationError,
  type ListEventsQuery,
  type TimeRange,
  type UpsertEventInput,
} from "../../core/domain/schemas.js";
import type { CalendarPort } from "../../core/ports/CalendarPort.js";
import { TOKENS } from "../../core/ports/tokens.js";

const CALENDAR_TIMEOUT_MS = 15_000;
const OAUTH_ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
] as const;

@injectable()
export class CalendarAdapter implements CalendarPort {
  private readonly calendar: calendar_v3.Calendar;

  constructor(@inject(TOKENS.Config) _config: IntegrationConfig) {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
    const missing = OAUTH_ENV_KEYS.filter((key) => !process.env[key]?.trim());
    if (!clientId || !clientSecret || !refreshToken || missing.length > 0) {
      throw new Error(
        `Google Calendar OAuth incompleto: defina ${OAUTH_ENV_KEYS.join(", ")} no ambiente.`,
      );
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    this.calendar = google.calendar({
      version: "v3",
      auth: oauth2Client,
      timeout: CALENDAR_TIMEOUT_MS,
    });
  }

  async listEvents(
    query: ListEventsQuery,
  ): Promise<Result<readonly CalendarEvent[]>> {
    const started = Date.now();
    try {
      const until = query.untilDate ?? query.date;
      const items = await this.listRangeEvents(
        query.calendarId,
        query.date,
        until,
      );
      const events = items.flatMap((item) => {
        const mapped = this.toEvent(item, query.calendarId);
        return mapped ? [mapped] : [];
      });
      console.log("[CalendarAdapter.listEvents]", {
        ok: true,
        durationMs: Date.now() - started,
        date: query.date,
        count: events.length,
      });
      return ok(CalendarEventSchema.array().parse(events));
    } catch (cause: unknown) {
      return this.fail("listEvents", started, query.date, cause);
    }
  }

  async upsertEvent(input: UpsertEventInput): Promise<Result<CalendarEvent>> {
    const started = Date.now();
    const date = input.range.start.iso.slice(0, 10);
    try {
      const requestBody: calendar_v3.Schema$Event = {
        summary: input.summary,
        start: {
          dateTime: input.range.start.iso,
          timeZone: TIME_ZONE,
        },
        end: {
          dateTime: input.range.end.iso,
          timeZone: TIME_ZONE,
        },
      };
      if (input.description !== null) {
        requestBody.description = input.description;
      }
      if (input.recurrence) {
        requestBody.recurrence = [toRrule(input.recurrence)];
      }
      if (input.reminders && input.reminders.length > 0) {
        requestBody.reminders = {
          useDefault: false,
          overrides: input.reminders.map((reminder) => ({
            method: reminder.method,
            minutes: reminder.minutes,
          })),
        };
      }

      const eventId = input.eventId ?? undefined;
      const response = eventId
        ? await this.withRetry(() =>
            this.calendar.events.update({
              calendarId: input.calendarId,
              eventId,
              requestBody,
            }),
          )
        : await this.withRetry(() =>
            this.calendar.events.insert({
              calendarId: input.calendarId,
              requestBody,
            }),
          );

      const mapped = this.toEvent(response.data, input.calendarId);
      if (!mapped) {
        return err({
          provider: "google_calendar",
          code: "validation",
          message: "Evento retornou payload inválido",
          retryable: false,
          retryAfterMs: null,
          cause: null,
        });
      }

      console.log("[CalendarAdapter.upsertEvent]", {
        ok: true,
        durationMs: Date.now() - started,
        date,
      });
      return ok(mapped);
    } catch (cause: unknown) {
      return this.fail("upsertEvent", started, date, cause);
    }
  }

  async deleteEvent(input: DeleteEventInput): Promise<Result<void>> {
    const started = Date.now();
    try {
      await this.withRetry(() =>
        this.calendar.events.delete({
          calendarId: input.calendarId,
          eventId: input.eventId,
        }),
      );
      console.log("[CalendarAdapter.deleteEvent]", {
        ok: true,
        durationMs: Date.now() - started,
      });
      return ok(undefined);
    } catch (cause: unknown) {
      return this.fail("deleteEvent", started, "", cause);
    }
  }

  private async listRangeEvents(
    calendarId: string,
    fromDate: string,
    untilDate: string,
  ): Promise<calendar_v3.Schema$Event[]> {
    const { timeMin } = civilDayBounds(fromDate);
    const { timeMax } = civilDayBounds(untilDate);
    const items: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.withRetry(() =>
        this.calendar.events.list({
          calendarId,
          timeMin,
          timeMax,
          ...(pageToken ? { pageToken } : {}),
          maxResults: 250,
          singleEvents: true,
          orderBy: "startTime",
          timeZone: TIME_ZONE,
        }),
      );
      items.push(...(response.data.items ?? []));
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
    return items;
  }

  private toEvent(
    event: calendar_v3.Schema$Event,
    calendarId: string,
  ): CalendarEvent | null {
    if (!event.id || event.status === "cancelled") {
      return null;
    }
    const range = rangeOf(event);
    if (!range) {
      return null;
    }
    return CalendarEventSchema.parse({
      eventId: event.id,
      calendarId,
      summary: event.summary ?? "",
      range,
      htmlLink: event.htmlLink ?? null,
      allDay: Boolean(event.start?.date && !event.start.dateTime),
      description: event.description ?? null,
    });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (cause: unknown) {
        const mapped = mapGoogleError(cause);
        const maxAttempts =
          mapped.code === "rate_limited"
            ? 3
            : mapped.code === "conflict"
              ? 1
              : mapped.code === "timeout" || mapped.code === "unavailable"
                ? 2
                : 0;
        if (!mapped.retryable || attempt >= maxAttempts) {
          throw cause;
        }
        attempt += 1;
        const waitMs = mapped.retryAfterMs ?? (attempt === 1 ? 400 : 1600);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  private fail(
    operation: string,
    started: number,
    date: string,
    cause: unknown,
  ): Result<never> {
    const error = mapGoogleError(cause);
    console.log("[CalendarAdapter]", {
      provider: "google_calendar",
      operation,
      ok: false,
      durationMs: Date.now() - started,
      date,
    });
    return err(error);
  }
}

function toRrule(recurrence: EventRecurrence): string {
  const parts = [`FREQ=${recurrence.freq}`];
  if (recurrence.interval > 1) {
    parts.push(`INTERVAL=${recurrence.interval}`);
  }
  if (recurrence.freq === "WEEKLY" && recurrence.byDay.length > 0) {
    parts.push(`BYDAY=${recurrence.byDay.join(",")}`);
  }
  if (recurrence.freq === "MONTHLY" && recurrence.byMonthDay) {
    parts.push(`BYMONTHDAY=${recurrence.byMonthDay}`);
  }
  if (recurrence.until) {
    parts.push(`UNTIL=${recurrence.until.replaceAll("-", "")}`);
  }
  return `RRULE:${parts.join(";")}`;
}

function rangeOf(event: calendar_v3.Schema$Event): TimeRange | null {
  const startIso = googleWhenToIso(event.start);
  const endIso = googleWhenToIso(event.end);
  if (!startIso || !endIso) {
    return null;
  }
  return { start: { iso: startIso }, end: { iso: endIso } };
}

function googleWhenToIso(
  when: calendar_v3.Schema$EventDateTime | undefined,
): string | null {
  if (!when) {
    return null;
  }
  if (when.dateTime) {
    return civilIsoFromGoogleDateTime(when.dateTime, when.timeZone);
  }
  if (when.date) {
    return toCivilIso(`${when.date}T00:00:00-03:00`);
  }
  return null;
}

function mapGoogleError(cause: unknown): IntegrationError {
  const already = IntegrationErrorSchema.safeParse(cause);
  if (already.success) {
    return already.data;
  }

  const status = googleStatus(cause);
  const reason = googleReason(cause);
  const message =
    googleMessage(cause) ??
    (cause instanceof Error ? cause.message : "Falha na API Google Calendar");

  if (status === 401) {
    return googleError("unauthorized", message, false, null, cause);
  }
  if (
    status === 403 &&
    (reason === "rateLimitExceeded" ||
      reason === "userRateLimitExceeded" ||
      reason === "quotaExceeded" ||
      reason === "dailyLimitExceeded")
  ) {
    return googleError("rate_limited", message, true, 1000, cause);
  }
  if (status === 403) {
    return googleError("forbidden_write", message, false, null, cause);
  }
  if (status === 404) {
    return googleError("not_found", message, false, null, cause);
  }
  if (status === 409) {
    return googleError("conflict", message, true, 400, cause);
  }
  if (status === 429) {
    return googleError("rate_limited", message, true, 1000, cause);
  }
  if (status === 408 || isTimeout(cause)) {
    return googleError("timeout", message, true, 400, cause);
  }
  if (status >= 500) {
    return googleError("unavailable", message, true, 400, cause);
  }

  return googleError("unavailable", message, true, 400, cause);
}

function googleError(
  code: IntegrationError["code"],
  message: string,
  retryable: boolean,
  retryAfterMs: number | null,
  cause: unknown,
): IntegrationError {
  return {
    provider: "google_calendar",
    code,
    message,
    retryable,
    retryAfterMs,
    cause,
  };
}

function googleStatus(cause: unknown): number {
  if (typeof cause !== "object" || cause === null) {
    return 0;
  }
  const record = cause as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  if (typeof record.response?.status === "number") {
    return record.response.status;
  }
  if (typeof record.status === "number") {
    return record.status;
  }
  if (typeof record.code === "number") {
    return record.code;
  }
  if (typeof record.code === "string" && /^\d+$/.test(record.code)) {
    return Number(record.code);
  }
  return 0;
}

function googleReason(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null) {
    return null;
  }
  const record = cause as {
    errors?: Array<{ reason?: string }>;
    response?: {
      data?: {
        error?: { errors?: Array<{ reason?: string }>; status?: string };
      };
    };
  };
  return (
    record.response?.data?.error?.errors?.[0]?.reason ??
    record.errors?.[0]?.reason ??
    record.response?.data?.error?.status ??
    null
  );
}

function googleMessage(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null) {
    return null;
  }
  const record = cause as {
    message?: unknown;
    response?: { data?: { error?: { message?: unknown } } };
  };
  if (typeof record.response?.data?.error?.message === "string") {
    return record.response.data.error.message;
  }
  if (typeof record.message === "string") {
    return record.message;
  }
  return null;
}

function isTimeout(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }
  const record = cause as { code?: unknown; message?: unknown };
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  return /timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(`${code} ${message}`);
}
