import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  acquireDailyLock,
  dailyLockPath,
  releaseDailyLock,
} from "./daily-lock.js";

test("segunda corrida no mesmo DATE é no-op; FORCE libera", () => {
  const lockDir = mkdtempSync(join(tmpdir(), "life-os-lock-"));
  const date = "2026-08-18";

  const first = acquireDailyLock({ date, lockDir });
  assert.equal(first.acquired, true);
  if (!first.acquired) {
    return;
  }
  releaseDailyLock(first.handle, "done");

  const second = acquireDailyLock({ date, lockDir });
  assert.deepEqual(second, { acquired: false, reason: "already_done" });

  const forced = acquireDailyLock({ date, lockDir, force: true });
  assert.equal(forced.acquired, true);

  const payload: unknown = JSON.parse(
    readFileSync(dailyLockPath(date, lockDir), "utf8"),
  );
  assert.equal(
    typeof payload === "object" &&
      payload !== null &&
      "status" in payload &&
      payload.status === "running",
    true,
  );
});

test("falha anterior libera retry no mesmo DATE", () => {
  const lockDir = mkdtempSync(join(tmpdir(), "life-os-lock-"));
  const date = "2026-08-19";
  const first = acquireDailyLock({ date, lockDir });
  assert.equal(first.acquired, true);
  if (!first.acquired) {
    return;
  }
  releaseDailyLock(first.handle, "failed");

  const retry = acquireDailyLock({ date, lockDir });
  assert.equal(retry.acquired, true);
});
