# MyLife — Life OS

Sistema multi-agentes (Node.js / TypeScript) que orquestra **Todoist**, **Notion** e **Google Calendar** com GTD, PARA e Kanban.

Implementação ainda não começou. Contratos: [`docs/specs`](docs/specs).

| Spec | Conteúdo |
|---|---|
| [00 — Arquitetura](docs/specs/00-architecture-overview.md) | Visão, camadas, fluxo Todoist ↔ Agente ↔ Notion ↔ GCal |
| [01 — Integrações](docs/specs/01-api-integrations.md) | Portas isoladas das três APIs |
| [02 — Agente Mestre](docs/specs/02-master-agent-orchestrator.md) | CRON, merge, timeblocking |
| [03 — Especialistas](docs/specs/03-specialist-agents.md) | Cinco frentes, prompts e regras |
