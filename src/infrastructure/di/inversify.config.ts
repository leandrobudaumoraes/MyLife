import "reflect-metadata";

import { Container } from "inversify";

import { MasterAgent } from "../../core/domain/orchestrator/MasterAgent.js";
import { InMemoryProtectedSeriesCatalog } from "../../core/domain/protected-series.js";
import {
  IntegrationConfigSchema,
  type IntegrationConfig,
} from "../../core/domain/schemas.js";
import type { ProtectedSeriesCatalog } from "../../core/domain/catalog.js";
import type { CalendarPort } from "../../core/ports/CalendarPort.js";
import type { NotionPort } from "../../core/ports/NotionPort.js";
import type { TodoistPort } from "../../core/ports/TodoistPort.js";
import { TOKENS } from "../../core/ports/tokens.js";
import { CalendarAdapter } from "../../adapters/apis/CalendarAdapter.js";
import { NotionAdapter } from "../../adapters/apis/NotionAdapter.js";
import { TodoistAdapter } from "../../adapters/apis/TodoistAdapter.js";

export function loadIntegrationConfig(
  env: NodeJS.ProcessEnv = process.env,
): IntegrationConfig {
  return IntegrationConfigSchema.parse({
    todoistToken: env.TODOIST_API_TOKEN ?? "mock-todoist-token",
    notionApiKey: env.NOTION_API_KEY ?? "mock-notion-token",
    googleCalendarId: env.GOOGLE_CALENDAR_ID ?? "primary",
    googleCalendarInstitutoId:
      env.GOOGLE_CALENDAR_INSTITUTO_ID ?? "instituto-mock",
  });
}

export function createContainer(
  config: IntegrationConfig = loadIntegrationConfig(),
): Container {
  const container = new Container({ defaultScope: "Singleton" });

  container.bind<IntegrationConfig>(TOKENS.Config).toConstantValue(config);

  container
    .bind<ProtectedSeriesCatalog>(TOKENS.ProtectedSeries)
    .toConstantValue(new InMemoryProtectedSeriesCatalog());

  container.bind<TodoistPort>(TOKENS.Todoist).to(TodoistAdapter);
  container.bind<NotionPort>(TOKENS.Notion).to(NotionAdapter);
  container
    .bind<CalendarPort>(TOKENS.GoogleCalendar)
    .to(CalendarAdapter);
  container.bind(MasterAgent).toSelf();

  return container;
}

export const container = createContainer();
