import { TIME_ZONE } from "./schemas.js";

export function civilDateNow(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function civilNowIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}-03:00`;
}

export function civilDayBounds(date: string): { timeMin: string; timeMax: string } {
  return {
    timeMin: `${date}T00:00:00-03:00`,
    timeMax: `${addCivilDays(date, 1)}T00:00:00-03:00`,
  };
}

export function addCivilDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return next.toISOString().slice(0, 10);
}

export function civilDateOfIso(iso: string): string {
  return toCivilIso(iso).slice(0, 10);
}

export function addMinutesIso(iso: string, minutes: number): string {
  return civilNowIso(new Date(Date.parse(iso) + minutes * 60_000));
}

/**
 * Normaliza data/hora do Todoist para ISO civil em America/Sao_Paulo.
 * Sem offset na origem, assume o fuso do Life OS (não o da máquina).
 */
export function toCivilIso(input: string): string {
  const hasOffset = /[zZ]|[+-]\d{2}:\d{2}$/.test(input);
  if (!hasOffset && input.includes("T")) {
    const withSeconds = input.length === 16 ? `${input}:00` : input;
    return `${withSeconds.slice(0, 19)}-03:00`;
  }
  return civilNowIso(new Date(input));
}

/**
 * Instant em UTC (`...Z`).
 */
export function toUtcIso(iso: string): string {
  return new Date(iso).toISOString();
}

/**
 * Relógio de parede em America/Sao_Paulo, sem offset.
 * O Notion aplica `time_zone` em cima do texto de `start`; enviar `...Z`
 * desloca a hora e o match Nome+Quando deixa de achar a linha.
 */
export function toNotionWallClock(iso: string): string {
  return toCivilIso(iso).slice(0, 19);
}

export function sameInstant(left: string | null, right: string): boolean {
  if (!left) {
    return false;
  }
  const leftMs = instantMs(left);
  const rightMs = instantMs(right);
  return leftMs !== null && leftMs === rightMs;
}

/**
 * Instant em ms. Sem offset, assume America/Sao_Paulo — não o fuso da máquina.
 */
export function instantMs(iso: string): number | null {
  const hasOffset = /[zZ]|[+-]\d{2}:\d{2}$/.test(iso);
  const normalized =
    !hasOffset && iso.includes("T") ? toCivilIso(iso) : iso;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * dateTime do Google Calendar + timeZone do evento → ISO civil de São Paulo.
 * Sem offset, UTC no campo timeZone não pode ser lido como relógio local.
 */
export function civilIsoFromGoogleDateTime(
  dateTime: string,
  timeZone: string | null | undefined,
): string {
  const hasOffset = /[zZ]|[+-]\d{2}:\d{2}$/.test(dateTime);
  if (hasOffset) {
    return toCivilIso(dateTime);
  }
  const zone = timeZone?.trim() ?? "";
  if (zone === "UTC" || zone === "Etc/UTC" || zone === "GMT") {
    const withSeconds = dateTime.length === 16 ? `${dateTime}:00` : dateTime;
    return toCivilIso(`${withSeconds.slice(0, 19)}Z`);
  }
  return toCivilIso(dateTime);
}
