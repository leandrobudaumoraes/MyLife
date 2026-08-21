import { instantMs, sameInstant, toCivilIso } from "../clock.js";
import type { CalendarEvent, TimeRange } from "../schemas.js";
import { plainTextFromHtml } from "./links.js";

export type ConflictSplit = {
  readonly own: CalendarEvent[];
  readonly foreign: CalendarEvent[];
};

export function overlappingEvents(
  range: TimeRange,
  events: readonly CalendarEvent[],
  ignoreEventId: string | null = null,
): CalendarEvent[] {
  return events.filter((event) => {
    if (event.allDay) {
      return false;
    }
    if (ignoreEventId && event.eventId === ignoreEventId) {
      return false;
    }
    return rangesOverlap(range, event.range);
  });
}

export function splitOverlappingEvents(
  range: TimeRange,
  events: readonly CalendarEvent[],
): ConflictSplit {
  const own: CalendarEvent[] = [];
  const foreign: CalendarEvent[] = [];
  for (const event of overlappingEvents(range, events)) {
    if (isOwnInboxEvent(event, range)) {
      own.push(event);
    } else {
      foreign.push(event);
    }
  }
  return { own, foreign };
}

/**
 * Só a captura anterior do Life OS (corpo com Briefing).
 * Mesmo título + mesmo início é compromisso de terceiro — senão o script
 * atualiza o evento alheio em vez de marcar Pending.
 */
export function isOwnInboxEvent(
  event: CalendarEvent,
  proposed: TimeRange,
): boolean {
  if (!sameInstant(event.range.start.iso, proposed.start.iso)) {
    return false;
  }
  return isInboxBriefing(event.description);
}

export function rangesOverlap(left: TimeRange, right: TimeRange): boolean {
  const leftStart = instantMs(left.start.iso);
  const leftEnd = instantMs(left.end.iso);
  const rightStart = instantMs(right.start.iso);
  const rightEnd = instantMs(right.end.iso);
  if (
    leftStart === null ||
    leftEnd === null ||
    rightStart === null ||
    rightEnd === null
  ) {
    return false;
  }
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function conflictDetail(
  events: readonly CalendarEvent[],
  proposed: TimeRange,
): string {
  const header = `Sua captura: ${formatRange(proposed)}. Nada foi gravado no Calendar nem no Notion.`;
  if (events.length === 1) {
    const only = events[0];
    if (only) {
      return `${header} Já existe neste horário: ${describeEvent(only)}.`;
    }
  }

  const lines = [header, "Já existem neste horário:"];
  for (const event of events) {
    lines.push(`- ${describeEvent(event)}`);
  }
  return lines.join("\n");
}

export function isInboxBriefing(description: string | null): boolean {
  if (!description) {
    return false;
  }
  const text = plainTextFromHtml(description).toLowerCase();
  return /(?:^|\s)briefing:\s*https?:\/\//u.test(text) || text.startsWith("briefing:");
}

function describeEvent(event: CalendarEvent): string {
  const title = event.summary.trim() || "(sem título)";
  const link = event.htmlLink ? `\n${event.htmlLink}` : "";
  return `"${title}" (${formatRange(event.range)})${link}`;
}

function formatRange(range: TimeRange): string {
  const startLocal = toCivilIso(range.start.iso);
  const endLocal = toCivilIso(range.end.iso);
  const start = formatClock(startLocal);
  const sameDay = startLocal.slice(0, 10) === endLocal.slice(0, 10);
  const end = sameDay ? endLocal.slice(11, 16) : formatClock(endLocal);
  return `${start}–${end}`;
}

function formatClock(iso: string): string {
  const local = toCivilIso(iso);
  const day = local.slice(0, 10);
  const time = local.slice(11, 16);
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year} ${time}`;
}
