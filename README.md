# Life OS

Esqueleto Node.js / TypeScript para orquestrar **Todoist**, **Notion**, **Google Calendar** e um **LLM** (LangChain + LangGraph).

Não há regras de negócio neste repositório. O que existe é a infraestrutura: portas, adaptadores com SDKs oficiais, Inversify e um grafo LangGraph de um nó.

---

## Como rodar

Requisitos: Node.js ≥ 20, arquivo `.env` na raiz (veja [`.env.example`](.env.example)). As chaves e OAuth são as mesmas de antes.

```bash
npm install
npx tsx src/test-run.ts
```

Ou o wrapper de cron:

```bash
bash src/run-life.sh
```

A corrida faz um **smoke check** só-leitura: lista projetos Todoist, páginas do banco Notion, eventos do dia no Calendar, ping no LLM e um invoke no grafo. Lock em `/tmp/life-os-daily-{date}.lock` impede segunda corrida no mesmo dia (`LIFE_OS_FORCE=1` reabre).

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
