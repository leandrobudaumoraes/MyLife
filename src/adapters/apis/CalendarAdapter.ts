import "reflect-metadata";

import { google, type calendar_v3 } from "googleapis";
import { inject, injectable } from "inversify";

import {
  assertNotProtectedWrite,
  type ProtectedSeriesCatalog,
} from "../../core/domain/catalog.js";
import { err, ok, type Result } from "../../core/domain/result.js";
import {
  CalendarEventRefSchema,
  CalendarPrefixSchema,
  IntegrationErrorSchema,
  TIME_ZONE,
  type CalendarEventRef,
  type CalendarPrefix,
  type BusyQuery,
  type DeleteOccurrenceInput,
  type IntegrationConfig,
  type IntegrationError,
  type TimeRange,
  type UpsertFlexEventInput,
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
  private readonly primaryCalendarId: string;
  private readonly institutoCalendarId: string;
  private readonly catalog: ProtectedSeriesCatalog;

  constructor(
    @inject(TOKENS.Config) config: IntegrationConfig,
    @inject(TOKENS.ProtectedSeries) catalog: ProtectedSeriesCatalog,
  ) {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
    const missing = OAUTH_ENV_KEYS.filter(
      (key) => !process.env[key]?.trim(),
    );
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
    this.primaryCalendarId = config.googleCalendarId;
    this.institutoCalendarId = config.googleCalendarInstitutoId;
    this.catalog = catalog;
  }

  async listBusy(
    query: BusyQuery,
  ): Promise<Result<readonly CalendarEventRef[]>> {
    const started = Date.now();
    try {
      const calendarIds = [...new Set(query.calendarIds)].filter((id) =>
        this.isTrackedCalendar(id),
      );
      const events: CalendarEventRef[] = [];
      for (const calendarId of calendarIds) {
        const items = await this.listDayEvents(calendarId, query.date);
        for (const item of items) {
          if (item.transparency === "transparent") {
            continue;
          }
          const mapped = this.toEventRef(item, calendarId);
          if (mapped) {
            events.push(mapped);
          }
        }
      }
      console.log("[CalendarAdapter.listBusy]", {
        provider: "google_calendar",
        operation: "listBusy",
        ok: true,
        durationMs: Date.now() - started,
        date: query.date,
      });
      return ok(CalendarEventRefSchema.array().parse(events));
    } catch (cause: unknown) {
      return this.fail("listBusy", started, query.date, cause);
    }
  }

  async listProtectedOccurrences(
    date: string,
  ): Promise<Result<readonly CalendarEventRef[]>> {
    const started = Date.now();
    try {
      const items = await this.listDayEvents(this.primaryCalendarId, date);
      const events = items.flatMap((item) => {
        const seriesId = seriesIdOf(item);
        if (!seriesId || !this.catalog.isProtectedSeries(seriesId)) {
          return [];
        }
        const mapped = this.toEventRef(item, this.primaryCalendarId);
        return mapped ? [mapped] : [];
      });
      console.log("[CalendarAdapter.listProtectedOccurrences]", {
        provider: "google_calendar",
        operation: "listProtectedOccurrences",
        ok: true,
        durationMs: Date.now() - started,
        date,
      });
      return ok(CalendarEventRefSchema.array().parse(events));
    } catch (cause: unknown) {
      return this.fail("listProtectedOccurrences", started, date, cause);
    }
  }

  async upsertFlexEvent(
    input: UpsertFlexEventInput,
  ): Promise<Result<CalendarEventRef>> {
    const started = Date.now();
    const date = civilDateOf(input.range.start.iso);
    try {
      const existing = await this.findFlexByLifeOsKey(input.lifeOsKey, date);
      assertNotProtectedWrite(seriesIdOf(existing));

      const requestBody = this.toFlexEventBody(input);
      const existingId = existing?.id;
      const response = existingId
        ? await this.withRetry(() =>
            this.calendar.events.update({
              calendarId: this.primaryCalendarId,
              eventId: existingId,
              requestBody,
            }),
          )
        : await this.withRetry(() =>
            this.calendar.events.insert({
              calendarId: this.primaryCalendarId,
              requestBody,
            }),
          );

      const mapped = this.toEventRef(response.data, this.primaryCalendarId, {
        prefix: input.prefix,
        title: input.title,
        cue: input.cue,
        specUrl: input.specUrl,
      });
      if (!mapped) {
        return err({
          provider: "google_calendar",
          code: "validation",
          message: `Evento flex ${input.lifeOsKey} retornou payload inválido`,
          retryable: false,
          retryAfterMs: null,
          cause: null,
        });
      }

      console.log("[CalendarAdapter.upsertFlexEvent]", {
        provider: "google_calendar",
        operation: "upsertFlexEvent",
        ok: true,
        durationMs: Date.now() - started,
        date,
      });
      return ok(mapped);
    } catch (cause: unknown) {
      return this.fail("upsertFlexEvent", started, date, cause);
    }
  }

  async deleteOccurrence(
    input: DeleteOccurrenceInput,
  ): Promise<Result<void>> {
    const started = Date.now();
    try {
      const fetched = await this.withRetry(() =>
        this.calendar.events.get({
          calendarId: input.calendarId,
          eventId: input.eventId,
        }),
      );
      const event = fetched.data;
      const eventId = event.id;
      const seriesId = seriesIdOf(event);
      const deletesSeries =
        Boolean(event.recurrence?.length) && !event.recurringEventId;
      const deletesProtectedMaster =
        typeof eventId === "string" &&
        this.catalog.isProtectedSeries(eventId) &&
        !event.recurringEventId;

      if (deletesSeries || deletesProtectedMaster) {
        return err({
          provider: "google_calendar",
          code: "forbidden_write",
          message: `Delete da série ${eventId ?? input.eventId} é proibido; apague só a ocorrência`,
          retryable: false,
          retryAfterMs: null,
          cause: null,
        });
      }

      if (!seriesId || !this.catalog.isProtectedSeries(seriesId)) {
        assertNotProtectedWrite(seriesId);
      }

      await this.withRetry(() =>
        this.calendar.events.delete({
          calendarId: input.calendarId,
          eventId: input.eventId,
        }),
      );
      console.log("[CalendarAdapter.deleteOccurrence]", {
        provider: "google_calendar",
        operation: "deleteOccurrence",
        ok: true,
        durationMs: Date.now() - started,
        date: civilDateNowFallback(),
      });
      return ok(undefined);
    } catch (cause: unknown) {
      return this.fail(
        "deleteOccurrence",
        started,
        civilDateNowFallback(),
        cause,
      );
    }
  }

  async listInstitutoRites(
    date: string,
  ): Promise<Result<readonly CalendarEventRef[]>> {
    const started = Date.now();
    try {
      const items = await this.listDayEvents(this.institutoCalendarId, date);
      const events = items.flatMap((item) => {
        const mapped = this.toEventRef(item, this.institutoCalendarId, {
          prefix: "INSTITUTO",
        });
        return mapped ? [mapped] : [];
      });
      console.log("[CalendarAdapter.listInstitutoRites]", {
        provider: "google_calendar",
        operation: "listInstitutoRites",
        ok: true,
        durationMs: Date.now() - started,
        date,
      });
      return ok(CalendarEventRefSchema.array().parse(events));
    } catch (cause: unknown) {
      return this.fail("listInstitutoRites", started, date, cause);
    }
  }

  private async findFlexByLifeOsKey(
    lifeOsKey: string,
    date: string,
  ): Promise<calendar_v3.Schema$Event | null> {
    const { timeMin, timeMax } = civilDayBounds(date);
    const items = await this.listEvents({
      calendarId: this.primaryCalendarId,
      timeMin,
      timeMax,
      privateExtendedProperty: [`lifeOsKey=${lifeOsKey}`],
    });
    return items[0] ?? null;
  }

  private async listDayEvents(
    calendarId: string,
    date: string,
  ): Promise<calendar_v3.Schema$Event[]> {
    const { timeMin, timeMax } = civilDayBounds(date);
    return this.listEvents({
      calendarId,
      timeMin,
      timeMax,
    });
  }

  private async listEvents(
    params: calendar_v3.Params$Resource$Events$List,
  ): Promise<calendar_v3.Schema$Event[]> {
    const items: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.withRetry(() =>
        this.calendar.events.list({
          ...params,
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

  private toFlexEventBody(
    input: UpsertFlexEventInput,
  ): calendar_v3.Schema$Event {
    return {
      summary: input.title,
      description: buildDescription(input.cue, input.specUrl, input.specTitle),
      start: {
        dateTime: input.range.start.iso,
        timeZone: TIME_ZONE,
      },
      end: {
        dateTime: input.range.end.iso,
        timeZone: TIME_ZONE,
      },
      colorId: input.colorId,
      transparency: input.transparency,
      reminders:
        input.transparency === "transparent"
          ? {
              useDefault: false,
              overrides: [{ method: "popup", minutes: 10 }],
            }
          : { useDefault: true },
      extendedProperties: {
        private: {
          lifeOsKey: input.lifeOsKey,
          lifeOs: "1",
        },
      },
    };
  }

  private toEventRef(
    event: calendar_v3.Schema$Event,
    calendarId: string,
    fallback?: {
      readonly prefix?: CalendarPrefix;
      readonly title?: string;
      readonly cue?: string | null;
      readonly specUrl?: string | null;
    },
  ): CalendarEventRef | null {
    if (!event.id || event.status === "cancelled") {
      return null;
    }
    if (
      event.eventType === "workingLocation" ||
      event.eventType === "birthday"
    ) {
      return null;
    }

    const range = rangeOf(event);
    if (!range) {
      return null;
    }

    const seriesId = seriesIdOf(event);
    const prefix =
      (seriesId ? this.catalog.prefixOf(seriesId) : null) ??
      prefixFromSummary(event.summary ?? "") ??
      fallback?.prefix;
    if (!prefix) {
      return null;
    }

    return CalendarEventRefSchema.parse({
      eventId: event.id,
      calendarId,
      seriesId,
      prefix,
      summary: event.summary ?? fallback?.title ?? prefix,
      range,
      protectedSlot: seriesId ? this.catalog.isProtectedSeries(seriesId) : false,
      specUrl: fallback?.specUrl ?? specUrlFromDescription(event.description),
      cue: fallback?.cue ?? cueFromDescription(event.description),
    });
  }

  private isTrackedCalendar(calendarId: string): boolean {
    return (
      calendarId === this.primaryCalendarId ||
      calendarId === this.institutoCalendarId ||
      calendarId === "primary"
    );
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

function seriesIdOf(event: calendar_v3.Schema$Event | null): string | null {
  if (!event) {
    return null;
  }
  return event.recurringEventId ?? null;
}

function rangeOf(event: calendar_v3.Schema$Event): TimeRange | null {
  const start =
    event.start?.dateTime ??
    (event.start?.date ? `${event.start.date}T00:00:00-03:00` : null);
  const end =
    event.end?.dateTime ??
    (event.end?.date ? `${event.end.date}T00:00:00-03:00` : null);
  if (!start || !end) {
    return null;
  }
  return { start: { iso: start }, end: { iso: end } };
}

function prefixFromSummary(summary: string): CalendarPrefix | null {
  const match = /^(SAUDE|LAR|INSTITUTO|LOJA|FAMILIA|ENGENHARIA)\b/.exec(
    summary.trim(),
  );
  const parsed = CalendarPrefixSchema.safeParse(match?.[1]);
  return parsed.success ? parsed.data : null;
}

function cueFromDescription(html: string | null | undefined): string | null {
  if (!html) {
    return null;
  }
  const match =
    /Cue:<\/b>\s*([^<]+)/i.exec(html) ?? /Cue:\s*([^\n<]+)/i.exec(html);
  const cue = match?.[1]?.replaceAll("&nbsp;", " ").trim();
  return cue && cue.length > 0 ? cue : null;
}

function specUrlFromDescription(
  html: string | null | undefined,
): string | null {
  if (!html) {
    return null;
  }
  const tagged = /Spec:<\/b>\s*<a href="([^"]+)"/i.exec(html);
  if (tagged?.[1]) {
    return tagged[1];
  }
  return null;
}

function buildDescription(
  cue: string,
  specUrl: string | null,
  specTitle: string | null,
): string {
  const cueHtml = `<b>Cue:</b> ${escapeHtml(cue)}`;
  if (!specUrl) {
    return cueHtml;
  }
  const title = specTitle && specTitle.length > 0 ? specTitle : specUrl;
  return `${cueHtml}<br><b>Spec:</b> <a href="${escapeHtml(specUrl)}">${escapeHtml(title)}</a>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function civilDayBounds(date: string): { timeMin: string; timeMax: string } {
  return {
    timeMin: `${date}T00:00:00-03:00`,
    timeMax: `${nextCivilDate(date)}T00:00:00-03:00`,
  };
}

function nextCivilDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1));
  return next.toISOString().slice(0, 10);
}

function civilDateOf(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return match?.[1] ?? iso.slice(0, 10);
}

function civilDateNowFallback(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
