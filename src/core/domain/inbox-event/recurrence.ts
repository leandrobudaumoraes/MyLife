import {
  EventRecurrenceSchema,
  type EventRecurrence,
  type WeekdayCode,
} from "../schemas.js";

const WEEKDAYS: Record<string, WeekdayCode> = {
  sunday: "SU",
  domingo: "SU",
  monday: "MO",
  segunda: "MO",
  tuesday: "TU",
  terca: "TU",
  terça: "TU",
  wednesday: "WE",
  quarta: "WE",
  thursday: "TH",
  quinta: "TH",
  friday: "FR",
  sexta: "FR",
  saturday: "SA",
  sabado: "SA",
  sábado: "SA",
};

export function parseRecurrence(dueString: string): EventRecurrence | null {
  const text = dueString.trim().toLowerCase();
  if (text.length === 0) {
    return null;
  }

  const monthDay = text.match(
    /todo dia (\d{1,2})\b|every month on the (\d{1,2})|every (\d{1,2})(?:st|nd|rd|th)/i,
  );
  if (monthDay) {
    const day = Number(monthDay[1] ?? monthDay[2] ?? monthDay[3]);
    if (day >= 1 && day <= 31) {
      return recurrence({ freq: "MONTHLY", byMonthDay: day });
    }
  }

  if (/todo mês|todo mes|every month/.test(text)) {
    return recurrence({ freq: "MONTHLY" });
  }

  const weekday = weekdayOf(text);
  if (weekday) {
    return recurrence({ freq: "WEEKLY", byDay: [weekday] });
  }

  const everyNDays = text.match(/a cada (\d+) dias?|every (\d+) days?/);
  if (everyNDays) {
    const n = Number(everyNDays[1] ?? everyNDays[2]);
    if (n >= 1) {
      return recurrence({ freq: "DAILY", interval: n });
    }
  }

  if (/todos os dias|todo dia|every day|daily/.test(text)) {
    return recurrence({ freq: "DAILY" });
  }

  if (/todas as semanas|every week|weekly/.test(text)) {
    return recurrence({ freq: "WEEKLY" });
  }

  return null;
}

export function recurrenceLabelOf(
  dueString: string | null,
  parsed: EventRecurrence | null,
): string | null {
  if (!parsed) {
    return null;
  }
  if (dueString && dueString.trim().length > 0) {
    return dueString.trim();
  }
  if (parsed.freq === "MONTHLY" && parsed.byMonthDay) {
    return `todo dia ${parsed.byMonthDay}`;
  }
  if (parsed.freq === "WEEKLY" && parsed.byDay[0]) {
    return `toda ${weekdayPt(parsed.byDay[0])}`;
  }
  if (parsed.freq === "DAILY" && parsed.interval > 1) {
    return `a cada ${parsed.interval} dias`;
  }
  if (parsed.freq === "DAILY") {
    return "todos os dias";
  }
  return parsed.freq.toLowerCase();
}

function recurrence(partial: {
  freq: EventRecurrence["freq"];
  interval?: number;
  byDay?: WeekdayCode[];
  byMonthDay?: number;
}): EventRecurrence {
  return EventRecurrenceSchema.parse({
    freq: partial.freq,
    interval: partial.interval ?? 1,
    byDay: partial.byDay ?? [],
    byMonthDay: partial.byMonthDay ?? null,
    until: null,
  });
}

function weekdayOf(text: string): WeekdayCode | null {
  const folded = text.normalize("NFD").replace(/\p{M}/gu, "");
  for (const [name, code] of Object.entries(WEEKDAYS)) {
    const needle = name.normalize("NFD").replace(/\p{M}/gu, "");
    if (folded.includes(needle)) {
      return code;
    }
  }
  return null;
}

function weekdayPt(code: WeekdayCode): string {
  switch (code) {
    case "MO":
      return "segunda";
    case "TU":
      return "terça";
    case "WE":
      return "quarta";
    case "TH":
      return "quinta";
    case "FR":
      return "sexta";
    case "SA":
      return "sábado";
    case "SU":
      return "domingo";
  }
}
