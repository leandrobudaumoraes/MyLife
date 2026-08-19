# Life OS

Esqueleto Node.js / TypeScript para orquestrar **Todoist**, **Notion**, **Google Calendar** e um **LLM** (LangChain + LangGraph).

Não há regras de Calendar nesta corrida. O contrato está em [`docs/specs`](docs/specs): a primeira nota é o [fluxo Todoist](docs/specs/01-todoist-fluxo.md).

---

## Como rodar

Requisitos: Node.js ≥ 20, arquivo `.env` na raiz (veja [`.env.example`](.env.example)). As chaves e OAuth são as mesmas de antes.

```bash
npm install
npx tsx src/test-run.ts
```

Se o lock do dia já fechou: `LIFE_OS_FORCE=1 npx tsx src/test-run.ts`.

Ou o wrapper de cron:

```bash
bash src/run-life.sh
```

A corrida **materializa o GTD** (projetos e etiquetas, inclusive `Project`) e processa a Inbox: `Next` / `Maybe` / `Archive` / `Project`. Lock em `/tmp/life-os-daily-{date}.lock` impede segunda corrida no mesmo dia (`LIFE_OS_FORCE=1` reabre).

| Script | Situação |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | emite `dist/` |
| `npm test` | testes de infraestrutura |
| `npm run dev` / `npm start` | `src/index.ts` / `dist/index.js` |

---

## Layout

```
src/
  index.ts                         # mesma entrada (npm start / dev)
  test-run.ts                      # mesma entrada (cron)
  bootstrap.ts                     # smoke check + lock
  run-life.sh                      # wrapper bash → test-run + logs/cron.log
  core/
    domain/
      schemas.ts                   # DTOs Zod das integrações
      result.ts                    # Result<T, IntegrationError>
      clock.ts                     # fuso America/Sao_Paulo
      orchestrator/
        LifeOs.ts                  # fachada (smoke check)
        LifeOsGraph.ts             # StateGraph START → reason → END
    ports/
      TodoistPort.ts
      NotionPort.ts
      CalendarPort.ts
      LlmPort.ts
      tokens.ts
  adapters/apis/
    TodoistAdapter.ts
    NotionAdapter.ts
    CalendarAdapter.ts
    OpenAiAdapter.ts
  infrastructure/
    daily-lock.ts
    di/inversify.config.ts
```

`node-cron` está nas dependências; pasta `src/jobs` ainda não existe.
