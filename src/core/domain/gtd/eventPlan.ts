import { z } from "zod";

import {
  addCivilDays,
  addMinutesIso,
  civilDateOfIso,
} from "../clock.js";
import {
  EventRecurrenceSchema,
  type CalendarEvent,
  type EventRecurrence,
  type NotionProjectSelect,
  type TimeRange,
  type WeekdayCode,
} from "../schemas.js";
import { isReservedProjectName } from "./catalog.js";
import { normalizeProjectSelect } from "./projectPlan.js";

const WEEKDAY_CODES: readonly WeekdayCode[] = [
  "SU",
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
];

const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:\d{2}|Z)?$/;

export const EventSlotSchema = z.object({
  insufficient: z.boolean(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  recurrence: EventRecurrenceSchema.nullable().default(null),
  projectName: z.string().trim().default(""),
  select: z
    .unknown()
    .optional()
    .transform((value) => normalizeProjectSelect(value)),
  pageTitle: z.string().trim().default(""),
  cue: z.string().trim().default(""),
  markdown: z.string().trim().default(""),
  steps: z.array(z.string().trim().min(1)).default([]),
});
export type EventSlot = z.infer<typeof EventSlotSchema>;

export type HydratedEventPage = {
  readonly projectName: string;
  readonly select: NotionProjectSelect;
  readonly pageTitle: string;
  readonly cue: string;
  readonly markdown: string;
  readonly steps: readonly string[];
};

const MAX_EVENT_STEPS = 7;

export type ResolvedEventSlot = {
  readonly range: TimeRange;
  readonly recurrence: EventRecurrence | null;
};

export function resolveEventSlot(
  slot: Pick<EventSlot, "insufficient" | "start" | "end" | "recurrence">,
): ResolvedEventSlot | null {
  if (slot.insufficient) {
    return null;
  }
  const start = normalizeDateTime(slot.start);
  if (!start) {
    return null;
  }
  const end = normalizeDateTime(slot.end) ?? addMinutesIso(start, 60);
  if (Number.isNaN(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
    return null;
  }
  return {
    range: { start: { iso: start }, end: { iso: end } },
    recurrence: slot.recurrence,
  };
}

const WEEKDAY_PT: ReadonlyArray<readonly [RegExp, WeekdayCode]> = [
  [/^domingos?$|^dom$/, "SU"],
  [/^segunda(?:s|-feira)?$|^seg$|^2a$/, "MO"],
  [/^tercas?(?:-feira)?$|^3a$/, "TU"],
  [/^quarta(?:s|-feira)?$|^qua$|^4a$/, "WE"],
  [/^quinta(?:s|-feira)?$|^qui$|^5a$/, "TH"],
  [/^sexta(?:s|-feira)?$|^sex$|^6a$/, "FR"],
  [/^sabados?$|^sab$/, "SA"],
];

const MONTH_PT: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(?:janeiro|jan)$/, 1],
  [/^(?:fevereiro|fev)$/, 2],
  [/^(?:marco|mar)$/, 3],
  [/^(?:abril|abr)$/, 4],
  [/^(?:maio|mai)$/, 5],
  [/^(?:junho|jun)$/, 6],
  [/^(?:julho|jul)$/, 7],
  [/^(?:agosto|ago)$/, 8],
  [/^(?:setembro|set)$/, 9],
  [/^(?:outubro|out)$/, 10],
  [/^(?:novembro|nov)$/, 11],
  [/^(?:dezembro|dez)$/, 12],
];

const PROCESSOR_EVENT_COMMENT =
  /^(horário ilegível|projeto ilegível|conflito com |Notion falhou|página Notion falhou|página do evento falhou)/i;

export function humanEventComments(comments: readonly string[]): string[] {
  return comments.filter(
    (comment) => !PROCESSOR_EVENT_COMMENT.test(comment.trim()),
  );
}

export function eventCaptureText(
  task: { readonly content: string; readonly description: string },
  comments: readonly string[],
): string {
  return [task.content, task.description, ...humanEventComments(comments)]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

export function parseCaptureEventSlot(
  text: string,
  today: string,
): ResolvedEventSlot | null {
  const folded = foldPt(text);
  const time = matchClock(folded);
  if (!time) {
    return null;
  }
  const daily = isDaily(folded);
  const weekdayHit = matchWeekdayHit(folded);
  const weekly = Boolean(weekdayHit && isEvery(folded));
  const date =
    matchCivilDate(folded, today) ??
    (weekdayHit
      ? nextCivilDateForWeekday(
          today,
          weekdayHit.code,
          weekdayHit.skipThisWeek,
        )
      : null) ??
    (daily ? today : null) ??
    today;
  const start = `${date}T${time}-03:00`;
  const end = addMinutesIso(start, 60);
  return {
    range: { start: { iso: start }, end: { iso: end } },
    recurrence: daily
      ? { freq: "DAILY", interval: 1, byDay: [], until: null }
      : weekly && weekdayHit
        ? { freq: "WEEKLY", interval: 1, byDay: [weekdayHit.code], until: null }
        : null,
  };
}

function foldPt(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replaceAll("ª", "a")
    .replaceAll("º", "o")
    .toLowerCase();
}

function isDaily(text: string): boolean {
  return /\b(?:todo\s+dia|todos\s+os\s+dias|diariamente|toda\s+(?:manha|tarde|noite))\b/.test(
    text,
  );
}

function isEvery(text: string): boolean {
  return /\btod[oa]s?\s+(?:os\s+|as\s+)?/.test(text);
}

function matchWeekdayHit(
  text: string,
): { readonly code: WeekdayCode; readonly skipThisWeek: boolean } | null {
  const match = text.match(
    /\b(proxima\s+)?(domingos?|dom|segunda(?:s|-feira)?|seg|2a|tercas?(?:-feira)?|3a|quarta(?:s|-feira)?|qua|4a|quinta(?:s|-feira)?|qui|5a|sexta(?:s|-feira)?|sex|6a|sabados?|sab)\b/,
  );
  if (!match?.[2]) {
    return null;
  }
  const code = weekdayCodeOf(match[2]);
  if (!code) {
    return null;
  }
  return { code, skipThisWeek: Boolean(match[1]) };
}

function weekdayCodeOf(token: string): WeekdayCode | null {
  for (const [pattern, code] of WEEKDAY_PT) {
    if (pattern.test(token)) {
      return code;
    }
  }
  return null;
}

function matchCivilDate(text: string, today: string): string | null {
  if (/\bdepois\s+de\s+amanha\b/.test(text)) {
    return addCivilDays(today, 2);
  }
  if (/\bamanha\b|\btom\b/.test(text)) {
    return addCivilDays(today, 1);
  }
  if (/\bontem\b/.test(text)) {
    return addCivilDays(today, -1);
  }
  if (/\bhoje\b|\btod\b/.test(text)) {
    return today;
  }

  const inDays = text.match(/\b(?:em|daqui\s+a|\+)\s*(\d+)\s+dias?\b/);
  if (inDays?.[1]) {
    return addCivilDays(today, Number(inDays[1]));
  }
  const inWeeks = text.match(/\b(?:em|daqui\s+a)\s*(\d+)\s+semanas?\b/);
  if (inWeeks?.[1]) {
    return addCivilDays(today, Number(inWeeks[1]) * 7);
  }

  if (/\bproxima\s+semana\b/.test(text)) {
    return weekdayCode(today) === "MO"
      ? addCivilDays(today, 7)
      : nextCivilDateForWeekday(today, "MO", false);
  }
  if (/\bproximo\s+fim\s+de\s+semana\b/.test(text)) {
    return nextCivilDateForWeekday(today, "SA", true);
  }
  if (/\b(?:neste\s+)?fim\s+de\s+semana\b/.test(text)) {
    return nextCivilDateForWeekday(today, "SA", false);
  }

  return matchNumericOrNamedDate(text, today);
}

function matchNumericOrNamedDate(text: string, today: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return civilFromParts(iso[1], iso[2], iso[3]);
  }

  const br = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (br) {
    const year = br[3] ? expandYear(br[3], today) : today.slice(0, 4);
    const date = civilFromParts(year, br[2], br[1]);
    if (date && !br[3] && date < today) {
      return civilFromParts(String(Number(year) + 1), br[2], br[1]);
    }
    return date;
  }

  const named = text.match(
    /\b(\d{1,2})\s+(?:de\s+)?(janeiro|jan|fevereiro|fev|marco|mar|abril|abr|maio|mai|junho|jun|julho|jul|agosto|ago|setembro|set|outubro|out|novembro|nov|dezembro|dez)\b(?:\s+(?:de\s+)?(\d{4}))?/,
  );
  if (named?.[1] && named[2]) {
    const month = monthNumber(named[2]);
    if (!month) {
      return null;
    }
    const year = named[3] ?? today.slice(0, 4);
    const date = civilFromParts(year, String(month), named[1]);
    if (date && !named[3] && date < today) {
      return civilFromParts(String(Number(year) + 1), String(month), named[1]);
    }
    return date;
  }

  return null;
}

function monthNumber(token: string): number | null {
  for (const [pattern, month] of MONTH_PT) {
    if (pattern.test(token)) {
      return month;
    }
  }
  return null;
}

function expandYear(value: string, today: string): string {
  if (value.length === 4) {
    return value;
  }
  const century = today.slice(0, 2);
  return `${century}${value.padStart(2, "0")}`;
}

function civilFromParts(
  yearText: string | undefined,
  monthText: string | undefined,
  dayText: string | undefined,
): string | null {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const ms = Date.parse(`${date}T12:00:00-03:00`);
  if (Number.isNaN(ms)) {
    return null;
  }
  return date;
}

function matchClock(text: string): string | null {
  if (/\bmeio[\s-]?dia\b/.test(text)) {
    return "12:00:00";
  }
  if (/\bmeia[\s-]?noite\b/.test(text)) {
    return "00:00:00";
  }

  const spoken = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s+da\s+(manha|tarde|noite|madrugada)\b/,
  );
  if (spoken) {
    const clock = padClock(
      hourForPeriod(spoken[1], spoken[3]),
      spoken[2] ?? "00",
    );
    if (clock) {
      return clock;
    }
  }

  const ampm = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/);
  if (ampm) {
    const meridiem = ampm[3] ?? "";
    const hour = Number(ampm[1]);
    const adjusted =
      meridiem.startsWith("p") && hour < 12
        ? hour + 12
        : meridiem.startsWith("a") && hour === 12
          ? 0
          : hour;
    const clock = padClock(String(adjusted), ampm[2] ?? "00");
    if (clock) {
      return clock;
    }
  }

  const compact = text.match(/(?:^|[^\w])(?:as|@)\s*(\d{2})(\d{2})\b/);
  if (compact) {
    const clock = padClock(compact[1], compact[2]);
    if (clock) {
      return clock;
    }
  }

  const withMinutes = text.match(/\b(\d{1,2})[:h](\d{2})\b/);
  if (withMinutes) {
    const clock = padClock(withMinutes[1], withMinutes[2]);
    if (clock) {
      return clock;
    }
  }

  const hourWord = text.match(/\b(\d{1,2})\s*h(?:oras?)?\b/);
  if (hourWord) {
    const clock = padClock(hourWord[1], "00");
    if (clock) {
      return clock;
    }
  }

  const asHour = text.match(/(?:^|[^\w])(?:as|@)\s*(\d{1,2})(?!\d)/);
  if (asHour) {
    const clock = padClock(asHour[1], "00");
    if (clock) {
      return clock;
    }
  }

  if (/\b(?:de|pela|a)\s+manha\b/.test(text)) {
    return "09:00:00";
  }
  if (/\b(?:de|pela|a)\s+tarde\b/.test(text)) {
    return "12:00:00";
  }
  if (/\b(?:de|pela|a)\s+noite\b/.test(text)) {
    return "19:00:00";
  }

  return null;
}

function hourForPeriod(
  hourText: string | undefined,
  period: string | undefined,
): string | undefined {
  const hour = Number(hourText);
  if (!Number.isInteger(hour)) {
    return hourText;
  }
  if ((period === "tarde" || period === "noite") && hour > 0 && hour < 12) {
    return String(hour + 12);
  }
  if (period === "noite" && hour === 12) {
    return "0";
  }
  return hourText;
}

function padClock(hourText: string | undefined, minuteText: string | undefined): string | null {
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function nextCivilDateForWeekday(
  today: string,
  weekday: WeekdayCode,
  skipThisWeek = false,
): string {
  const todayIndex = WEEKDAY_CODES.indexOf(weekdayCode(today));
  const wantIndex = WEEKDAY_CODES.indexOf(weekday);
  let delta = (wantIndex - todayIndex + 7) % 7;
  if (skipThisWeek) {
    if (wantIndex > todayIndex) {
      delta += 7;
    } else if (delta === 0) {
      delta = 7;
    }
  }
  return addCivilDays(today, delta);
}

export function conflictWindow(range: TimeRange, recurring: boolean): {
  readonly from: string;
  readonly until: string;
} {
  const from = civilDateOfIso(range.start.iso);
  return {
    from,
    until: recurring ? addCivilDays(from, 14) : from,
  };
}

export function expandOccurrences(
  range: TimeRange,
  recurrence: EventRecurrence | null,
): TimeRange[] {
  const window = conflictWindow(range, recurrence !== null);
  const startDate = civilDateOfIso(range.start.iso);
  const startTime = timeOf(range.start.iso);
  const endTime = timeOf(range.end.iso);
  const crossesDay = civilDateOfIso(range.end.iso) !== startDate;
  const dates = datesInWindow(startDate, window.until).filter((date) =>
    occursOn(date, startDate, recurrence),
  );
  return dates.map((date) => ({
    start: { iso: `${date}T${startTime}` },
    end: {
      iso: `${crossesDay ? addCivilDays(date, 1) : date}T${endTime}`,
    },
  }));
}

export function findConflict(
  occurrences: readonly TimeRange[],
  events: readonly CalendarEvent[],
): CalendarEvent | null {
  const timed = events.filter((event) => !event.allDay);
  for (const occurrence of occurrences) {
    for (const event of timed) {
      if (overlaps(occurrence, event.range)) {
        return event;
      }
    }
  }
  return null;
}

export function hydrateEventPage(
  plan: EventSlot,
  task: { readonly content: string; readonly description: string },
  comments: readonly string[],
): HydratedEventPage | null {
  if (!isUsableEventProject(plan.projectName)) {
    return null;
  }
  const pageTitle = plan.pageTitle || task.content.trim();
  const steps = limitEventSteps(
    plan.steps.length > 0 ? plan.steps : comments,
  );
  const cue = plan.cue || fallbackCue(task, comments);
  const markdown =
    plan.markdown || fallbackEventMarkdown({ pageTitle, cue, steps });
  if (pageTitle.length === 0 || cue.length === 0) {
    return null;
  }
  return {
    projectName: plan.projectName,
    select: plan.select,
    pageTitle,
    cue,
    markdown,
    steps,
  };
}

export function isUsableEventProject(name: string): boolean {
  return name.length > 0 && !isReservedProjectName(name);
}

export function calendarEventBody(input: {
  readonly cue: string;
  readonly steps: readonly string[];
  readonly specUrl: string;
  readonly specTitle: string;
}): string {
  const cue = escapeHtml(input.cue.trim());
  const steps = limitEventSteps(input.steps);
  const list =
    steps.length === 0
      ? ""
      : `<br>${steps
          .map((step, index) => `${index + 1}. ${escapeHtml(step)}`)
          .join("<br>")}<br>`;
  return `<b>Cue:</b> ${cue}${list}<br><b>Spec:</b> <a href="${escapeHtml(input.specUrl)}">${escapeHtml(input.specTitle)}</a>`;
}

export function fallbackEventMarkdown(input: {
  readonly pageTitle: string;
  readonly cue: string;
  readonly steps: readonly string[];
}): string {
  const steps =
    input.steps.length > 0 ? input.steps : [input.cue || input.pageTitle];
  const agora = steps
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n");
  return [
    `> ${input.cue}`,
    "",
    "## Agora",
    agora,
    "",
    "## Não",
    "- Abrir tela nova neste bloco.",
    "- Transformar isto em tarefa do Todoist.",
  ].join("\n");
}

function fallbackCue(
  task: { readonly content: string; readonly description: string },
  comments: readonly string[],
): string {
  const description = firstLine(task.description);
  if (description.length > 0) {
    return description;
  }
  const comment = comments.map(firstLine).find((line) => line.length > 0);
  return comment ?? task.content.trim();
}

function limitEventSteps(steps: readonly string[]): string[] {
  return steps.map((step) => step.trim()).filter(Boolean).slice(0, MAX_EVENT_STEPS);
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim() ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function conflictComment(event: CalendarEvent): string {
  const date = civilDateOfIso(event.range.start.iso);
  const start = event.range.start.iso.slice(11, 16);
  const end = event.range.end.iso.slice(11, 16);
  const summary = event.summary.trim() || "evento";
  return `conflito com ${summary} ${date} ${start}–${end}`;
}

function normalizeDateTime(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim().replace(" ", "T");
  if (!ISO_DATE_TIME.test(trimmed)) {
    return null;
  }
  const withOffset = ensureOffset(trimmed);
  if (Number.isNaN(Date.parse(withOffset))) {
    return null;
  }
  return withOffset;
}

function ensureOffset(iso: string): string {
  if (/[+-]\d{2}:\d{2}$/.test(iso) || iso.endsWith("Z")) {
    return iso;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) {
    return `${iso}:00-03:00`;
  }
  return `${iso}-03:00`;
}

function timeOf(iso: string): string {
  return iso.slice(11);
}

function datesInWindow(from: string, until: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= until) {
    dates.push(cursor);
    cursor = addCivilDays(cursor, 1);
  }
  return dates;
}

function occursOn(
  date: string,
  startDate: string,
  recurrence: EventRecurrence | null,
): boolean {
  if (date < startDate) {
    return false;
  }
  if (recurrence === null) {
    return date === startDate;
  }
  if (recurrence.until !== null && date > recurrence.until) {
    return false;
  }
  const delta = daysBetween(startDate, date);
  if (recurrence.freq === "DAILY") {
    return delta % recurrence.interval === 0;
  }
  if (recurrence.freq === "WEEKLY") {
    const weekdays =
      recurrence.byDay.length > 0
        ? recurrence.byDay
        : [weekdayCode(startDate)];
    if (!weekdays.includes(weekdayCode(date))) {
      return false;
    }
    return Math.floor(delta / 7) % recurrence.interval === 0;
  }
  const startDay = Number(startDate.slice(8, 10));
  if (Number(date.slice(8, 10)) !== startDay) {
    return false;
  }
  return monthsBetween(startDate, date) % recurrence.interval === 0;
}

function weekdayCode(date: string): WeekdayCode {
  const ms = Date.parse(`${date}T12:00:00-03:00`);
  return WEEKDAY_CODES[new Date(ms).getUTCDay()] ?? "MO";
}

function daysBetween(from: string, to: string): number {
  const ms =
    Date.parse(`${to}T12:00:00-03:00`) - Date.parse(`${from}T12:00:00-03:00`);
  return Math.round(ms / 86_400_000);
}

function monthsBetween(from: string, to: string): number {
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));
  const toMonth = Number(to.slice(5, 7));
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return (
    Date.parse(a.start.iso) < Date.parse(b.end.iso) &&
    Date.parse(b.start.iso) < Date.parse(a.end.iso)
  );
}
