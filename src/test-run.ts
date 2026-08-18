import "dotenv/config";
import "reflect-metadata";

import { MasterAgent } from "./core/domain/orchestrator/MasterAgent.js";
import { container } from "./infrastructure/di/inversify.config.js";

const master = container.get(MasterAgent);
const result = await master.executeDailyTriage({ dryRun: false });

console.dir(result, { depth: null });
