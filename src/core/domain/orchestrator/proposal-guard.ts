import {
  TIME_ZONE,
  type CivilInstant,
  type ContextTag,
  type GtdAction,
  type TimeRange,
} from "../schemas.js";

const WEEKDAY_PREFIX =
  /^(seg(?:unda)?|ter(?:[cç]a)?|qua(?:rta)?|qui(?:nta)?|sex(?:ta)?|s[áa]b(?:ado)?|dom(?:ingo)?)[.]?\s+/i;

const TIME_AT_START = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/;

const WEEKDAY_TIME_PREFIX =
  /^(seg(?:unda)?|ter(?:[cç]a)?|qua(?:rta)?|qui(?:nta)?|sex(?:ta)?|s[áa]b(?:ado)?|dom(?:ingo)?)[.]?\s+\d{1,2}:\d{2}(?::\d{2})?\s*:?\s*/i;

const WEEKDAY_TIME_ANYWHERE =
  /\b(?:seg(?:unda)?|ter(?:[cç]a)?|qua(?:rta)?|qui(?:nta)?|sex(?:ta)?|s[áa]b(?:ado)?|dom(?:ingo)?)[.]?\s+\d{1,2}:\d{2}(?::\d{2})?\b/gi;

const CANNED_FRAGMENTS = [
  "lista no celular",
  "sair. uma loja.",
  "sair. uma loja",
  "voltar antes das 18:00",
  "voltar antes das 18:00.",
] as const;

const MIN_OTHER_TITLE_LEN = 12;
const MIN_CUE_LEN = 8;

export const SPECIALIST_ISOLATION_HINT =
  "ISOLAMENTO: start/end = HH:MM do DATE (ex. 20:30) ou ISO começando com DATE. Nunca prefixo de dia da semana. cue e rationale só da ação do gtdActionId. Não copie texto de outras ACTIONS.";

export function weekdayTokenIndex(token: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 | null {
  const folded = token
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  if (folded.startsWith("dom")) return 0;
  if (folded.startsWith("seg")) return 1;
  if (folded.startsWith("ter")) return 2;
  if (folded.startsWith("qua")) return 3;
  if (folded.startsWith("qui")) return 4;
  if (folded.startsWith("sex")) return 5;
  if (folded.startsWith("sab")) return 6;
  return null;
}

export function parseProposalInstant(
  date: string,
  value: string,
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6,
): CivilInstant | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.includes("T")) {
    if (!trimmed.startsWith(date) || Number.isNaN(Date.parse(trimmed))) {
      return null;
    }
    return { iso: trimmed };
  }

  let rest = trimmed;
  const weekMatch = WEEKDAY_PREFIX.exec(trimmed);
  if (weekMatch?.[1]) {
    const tokenWeekday = weekdayTokenIndex(weekMatch[1]);
    if (tokenWeekday === null || tokenWeekday !== weekday) {
      return null;
    }
    rest = trimmed.slice(weekMatch[0].length).replace(/^:\s*/, "");
  }

  const match = TIME_AT_START.exec(rest);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return civilAt(date, match[1], match[2], match[3] ?? "00");
}

export function casaFlexThreshold(weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6): string {
  return weekday === 6 ? "12:00:00" : "18:00:00";
}

export function casaActionEligibleToday(
  action: GtdAction | null,
  date: string,
): action is GtdAction {
  if (!action) {
    return false;
  }
  if (action.due === null) {
    return true;
  }
  return action.due.iso.startsWith(date);
}

export function selectCasaFallbackAction(
  actions: readonly GtdAction[],
  date: string,
): GtdAction | null {
  const eligible = actions.filter((action) =>
    casaActionEligibleToday(action, date),
  );
  const shopping = eligible.find((action) => {
    const haystack = `${action.contexts.join(" ")} ${action.title}`.toLowerCase();
    return (
      action.contexts.includes("compra") ||
      action.contexts.includes("rua") ||
      /comprar|compra|mercado|ingrediente/.test(haystack)
    );
  });
  return shopping ?? eligible[0] ?? null;
}

export function estimateCasaDurationMs(
  contexts: readonly ContextTag[],
  title: string,
): number {
  const haystack = `${contexts.join(" ")} ${title}`.toLowerCase();
  if (
    contexts.includes("compra") ||
    contexts.includes("rua") ||
    /comprar|compra|mercado|ingrediente/.test(haystack)
  ) {
    return 60 * 60 * 1000;
  }
  return 30 * 60 * 1000;
}

export function resolveCasaFlexRange(input: {
  readonly date: string;
  readonly weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly gaps: readonly TimeRange[];
  readonly draftStart: string;
  readonly draftEnd: string;
  readonly contexts: readonly ContextTag[];
  readonly title: string;
}): TimeRange | null {
  const threshold = casaFlexThreshold(input.weekday);
  const thresholdMs = Date.parse(`${input.date}T${threshold}-03:00`);
  const dayEndMs = Date.parse(`${input.date}T22:00:00-03:00`);

  const start = parseProposalInstant(
    input.date,
    input.draftStart,
    input.weekday,
  );
  const end = parseProposalInstant(input.date, input.draftEnd, input.weekday);
  if (start && end) {
    const startMs = Date.parse(start.iso);
    const endMs = Date.parse(end.iso);
    if (
      endMs > startMs &&
      startMs >= thresholdMs &&
      endMs <= dayEndMs &&
      sitsInGap({ start, end }, input.gaps)
    ) {
      return { start, end };
    }
  }

  return placeInFirstGap(
    input.gaps,
    thresholdMs,
    estimateCasaDurationMs(input.contexts, input.title),
  );
}

export function stripLegacySchedulePrefix(text: string): string {
  return text.replace(WEEKDAY_TIME_PREFIX, "").replace(/^[:.\-–]+\s*/, "").trim();
}

export function sanitizeProposalCopy(
  text: string,
  actionTitle: string,
  otherTitles: readonly string[],
  maxLen: number,
): string {
  let out = text.replaceAll("\n", " ").trim();
  const titleHasSchedule = WEEKDAY_TIME_PREFIX.test(actionTitle.trim());
  if (!titleHasSchedule) {
    out = stripLegacySchedulePrefix(out);
    out = out.replace(WEEKDAY_TIME_ANYWHERE, "");
  }

  const titleLower = actionTitle.toLowerCase();
  for (const fragment of CANNED_FRAGMENTS) {
    if (!titleLower.includes(fragment)) {
      out = out.replace(new RegExp(escapeRegex(fragment), "ig"), "");
    }
  }

  for (const other of otherTitles) {
    if (
      other.length >= MIN_OTHER_TITLE_LEN &&
      other !== actionTitle &&
      !actionTitle.includes(other) &&
      out.includes(other)
    ) {
      out = out.replaceAll(other, "");
    }
  }

  out = out.replace(/\s{2,}/g, " ").replace(/^[:.\-–]+\s*/, "").trim();
  if (out.length < MIN_CUE_LEN) {
    out = actionTitle.trim();
  }
  return out.slice(0, maxLen);
}

function sitsInGap(range: TimeRange, gaps: readonly TimeRange[]): boolean {
  const startMs = Date.parse(range.start.iso);
  const endMs = Date.parse(range.end.iso);
  return gaps.some((gap) => {
    return (
      startMs >= Date.parse(gap.start.iso) && endMs <= Date.parse(gap.end.iso)
    );
  });
}

function placeInFirstGap(
  gaps: readonly TimeRange[],
  thresholdMs: number,
  durationMs: number,
): TimeRange | null {
  const minMs = 25 * 60 * 1000;
  for (const gap of gaps) {
    const gapStart = Date.parse(gap.start.iso);
    const gapEnd = Date.parse(gap.end.iso);
    const startMs = Math.max(gapStart, thresholdMs);
    if (gapEnd - startMs < minMs) {
      continue;
    }
    const wantedEnd = startMs + durationMs;
    const endMs = Math.min(wantedEnd, gapEnd);
    if (endMs - startMs < minMs) {
      continue;
    }
    return msRange(startMs, endMs);
  }
  return null;
}

function civilAt(
  date: string,
  hour: string,
  minute: string,
  second: string,
): CivilInstant {
  return {
    iso: `${date}T${hour.padStart(2, "0")}:${minute}:${second.padStart(2, "0")}-03:00`,
  };
}

function msRange(startMs: number, endMs: number): TimeRange {
  return {
    start: { iso: toCivilIso(startMs) },
    end: { iso: toCivilIso(endMs) },
  };
}

function toCivilIso(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));

  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}-03:00`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
