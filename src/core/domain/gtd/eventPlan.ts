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
  const trimmed = value.trim();
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
