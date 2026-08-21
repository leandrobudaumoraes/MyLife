import type { CalendarReminder, TodoistReminder } from "../schemas.js";
import { TODOIST_P1_PRIORITY } from "./labels.js";

const MAX_CALENDAR_REMINDERS = 5;
const MAX_MINUTES_BEFORE = 4 * 7 * 24 * 60;

export function isForceCreatePriority(priority: number): boolean {
  return priority === TODOIST_P1_PRIORITY;
}

export function remindersForPriority(
  priority: number,
): CalendarReminder[] {
  switch (priority) {
    case 4:
      return [
        { method: "popup", minutes: 24 * 60 },
        { method: "popup", minutes: 60 },
      ];
    case 3:
      return [{ method: "popup", minutes: 60 }];
    case 2:
      return [{ method: "popup", minutes: 30 }];
    default:
      return [{ method: "popup", minutes: 10 }];
  }
}

export function calendarRemindersFor(
  priority: number,
  taskReminders: readonly TodoistReminder[],
  eventStartIso: string,
): CalendarReminder[] {
  const mirrored = uniqueReminders(
    taskReminders.flatMap((reminder) => {
      const mapped = mirrorReminder(reminder, eventStartIso);
      return mapped ? [mapped] : [];
    }),
  );
  if (mirrored.length > 0) {
    return mirrored;
  }
  return remindersForPriority(priority);
}

function mirrorReminder(
  reminder: TodoistReminder,
  eventStartIso: string,
): CalendarReminder | null {
  const minutes =
    reminder.type === "relative"
      ? reminder.minuteOffset
      : minutesBeforeStart(reminder.dueDatetime, eventStartIso);
  if (
    minutes === null ||
    !Number.isFinite(minutes) ||
    minutes < 0 ||
    minutes > MAX_MINUTES_BEFORE
  ) {
    return null;
  }
  return {
    method: reminder.service === "email" ? "email" : "popup",
    minutes,
  };
}

function minutesBeforeStart(
  dueDatetime: string | null,
  eventStartIso: string,
): number | null {
  if (!dueDatetime) {
    return null;
  }
  const reminderAt = Date.parse(dueDatetime);
  const eventAt = Date.parse(eventStartIso);
  if (Number.isNaN(reminderAt) || Number.isNaN(eventAt)) {
    return null;
  }
  return Math.round((eventAt - reminderAt) / 60_000);
}

function uniqueReminders(
  reminders: readonly CalendarReminder[],
): CalendarReminder[] {
  const seen = new Set<string>();
  const unique: CalendarReminder[] = [];
  for (const reminder of reminders) {
    const key = `${reminder.method}:${reminder.minutes}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(reminder);
    if (unique.length === MAX_CALENDAR_REMINDERS) {
      break;
    }
  }
  return unique;
}
