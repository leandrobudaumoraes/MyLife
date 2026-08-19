import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type DailyLockReason = "in_progress" | "already_done";

export type DailyLockHandle = {
  readonly date: string;
  readonly path: string;
};

export type DailyLockAcquire =
  | { readonly acquired: true; readonly handle: DailyLockHandle }
  | { readonly acquired: false; readonly reason: DailyLockReason };

type LockStatus = "running" | "done" | "failed";

interface LockFile {
  readonly status: LockStatus;
  readonly pid: number;
  readonly at: string;
}

export function lifeOsEnvFlag(name: string): boolean {
  return /^(1|true|yes)$/i.test(process.env[name]?.trim() ?? "");
}

export function dailyLockPath(date: string, lockDir = tmpdir()): string {
  return join(lockDir, `life-os-daily-${date}.lock`);
}

/**
 * Uma corrida por DATE. Segunda invocação no-op, salvo `LIFE_OS_FORCE`.
 * Falha anterior ou PID morto libera retry.
 */
export function acquireDailyLock(input: {
  readonly date: string;
  readonly force?: boolean;
  readonly lockDir?: string;
}): DailyLockAcquire {
  const dir = input.lockDir ?? tmpdir();
  mkdirSync(dir, { recursive: true });
  const path = dailyLockPath(input.date, dir);
  const force = input.force === true;

  if (existsSync(path)) {
    const existing = readLock(path);
    if (existing) {
      if (existing.status === "running" && pidAlive(existing.pid)) {
        return { acquired: false, reason: "in_progress" };
      }
      if (existing.status === "done" && !force) {
        return { acquired: false, reason: "already_done" };
      }
    }
    try {
      unlinkSync(path);
    } catch {
      return { acquired: false, reason: "in_progress" };
    }
  }

  try {
    const fd = openSync(path, "wx");
    closeSync(fd);
  } catch {
    return { acquired: false, reason: "in_progress" };
  }

  writeLock(path, "running");
  return { acquired: true, handle: { date: input.date, path } };
}

export function releaseDailyLock(
  handle: DailyLockHandle,
  status: Exclude<LockStatus, "running">,
): void {
  writeLock(handle.path, status);
}

function writeLock(path: string, status: LockStatus): void {
  const payload: LockFile = {
    status,
    pid: process.pid,
    at: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(payload)}\n`, "utf8");
}

function readLock(path: string): LockFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("status" in parsed) ||
      !("pid" in parsed)
    ) {
      return null;
    }
    const status = parsed.status;
    const pid = parsed.pid;
    if (
      (status !== "running" && status !== "done" && status !== "failed") ||
      typeof pid !== "number"
    ) {
      return null;
    }
    const at = "at" in parsed && typeof parsed.at === "string" ? parsed.at : "";
    return { status, pid, at };
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
