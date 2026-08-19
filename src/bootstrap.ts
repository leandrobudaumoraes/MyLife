import "dotenv/config";
import "reflect-metadata";

import { LifeOs } from "./core/domain/orchestrator/LifeOs.js";
import { civilDateNow } from "./core/domain/clock.js";
import { container } from "./infrastructure/di/inversify.config.js";
import {
  acquireDailyLock,
  lifeOsEnvFlag,
  releaseDailyLock,
} from "./infrastructure/daily-lock.js";

export async function runSmokeCheck(): Promise<void> {
  const date = civilDateNow();
  const lock = acquireDailyLock({
    date,
    force: lifeOsEnvFlag("LIFE_OS_FORCE"),
  });

  if (!lock.acquired) {
    console.log(`lock: ${lock.reason} (${date})`);
    return;
  }

  const lifeOs = container.get(LifeOs);

  try {
    const result = await lifeOs.smokeCheck();
    console.dir(result, { depth: null });
    releaseDailyLock(lock.handle, result.ok ? "done" : "failed");
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (cause: unknown) {
    releaseDailyLock(lock.handle, "failed");
    throw cause;
  }
}
