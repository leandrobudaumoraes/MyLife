📖 Status do Projeto: Life OS (Multi-Agent System)
1. Visão Geral do Sistema
O Life OS é um orquestrador autônomo baseado em uma arquitetura de Sistema Multi-Agentes (MAS). Desenvolvido em Node.js com TypeScript, ele atua como o cérebro da rotina diária, conectando a execução de tarefas (Todoist), o planejamento sistêmico (Notion/PARA) e a alocação de tempo (Google Calendar) através da metodologia de Timeblocking e princípios GTD e Kanban.

2. Decisões Arquiteturais e Restrições
Paradigma: Arquitetura Hexagonal (Ports and Adapters) com Injeção de Dependência via InversifyJS. O núcleo (Core) é estritamente isolado de dependências externas.

Validação de Dados: Zod para garantia de contratos nos DTOs em tempo de execução.

Blindagem Corporativa (Timebox): O horário comercial das 09:00 às 18:00 é tratado como uma restrição de relógio (Timebox) inflexível dedicada às responsabilidades de engenharia (PagBank). Nenhum agente da IA tem permissão para sobrescrever ou alocar tarefas pessoais neste intervalo de tempo.

Idempotência e Segurança: Implementação de regras de write fence e lifeOsKey para evitar condições de corrida, duplicação de eventos ou perdas de dados no calendário.

3. Escopo de Domínios (As 5 Frentes)
O sistema divide a carga cognitiva do usuário em 5 pilares, futuramente gerenciados por Agentes Especialistas:

Mim (Saúde e Vitalidade): Gestão de treinos (M3Gym), práticas físicas (Pilates) e planejamento de alimentação de baixo índice glicêmico.

Casa (Infraestrutura): Controle de finanças, manutenções, logística do carro e rotina residencial na cidade de São Paulo.

Instituto (Gestão): Desenvolvimento e organização institucional.

Loja Lua Branca (E-commerce e Operações): Planejamento reverso e suporte tático para o e-commerce da Caroline e eventos-chave, como a organização temática para 26 de setembro.

Família: Suporte logístico global, incluindo as rotinas do filho e alinhamento de agendas familiares.

4. O que já foi implementado (Milestones Concluídos)
Fase 1: Fundação SDD (Spec-Driven Development)
[x] Inicialização do ambiente Node.js (v20+) em ESM com TypeScript.

[x] Configuração do tsconfig.json (strict mode, decorators ativados) e package.json.

[x] Criação do arquivo de contexto global .cursorrules ditando princípios SOLID, DI e SDD.

[x] Geração dos contratos (Specs 00 a 03) na pasta /docs/specs.

Fase 2: Core e Portas (O Hexágono)
[x] Domínio: Criação dos Schemas em Zod (src/core/domain/schemas.ts).

[x] Portas (Interfaces): TodoistPort, NotionPort e CalendarPort definidas rigorosamente no núcleo do sistema.

[x] Adapters (Mocks com SDKs): Implementação do TodoistAdapter, NotionAdapter e CalendarAdapter retornando dados mockados válidos.

[x] Injeção de Dependência: Container Inversify configurado (inversify.config.ts), resolvendo os tokens de dependência e ligando Portas aos Adapters.

Fase 3: Orquestrador Mestre e Testes
[x] MasterAgent: Criada a classe do Agente Mestre (src/core/domain/orchestrator/MasterAgent.ts) com injeção das três portas principais.

[x] Lógica Sequencial (Pré-LangGraph): Implementado o método executeDailyTriage(), que coleta tarefas e projetos simulados, e gera blocos de agenda.

[x] Motor de Teste: O script src/test-run.ts está operante. Ele sobe o contêiner, processa os dados mockados e já aplica a regra de bloqueio (guardrail) impedindo agendamentos que conflitam com a restrição de relógio das 09:00 às 18:00.

5. Próximos Passos (Backlog Imediato)
Configuração de Variáveis de Ambiente: Criar o arquivo .env para carregar as chaves de API reais e do provedor de LLM.

Motor de Raciocínio (LangGraph): Refatorar o MasterAgent para instanciar a máquina de estados (LifeOsGraph), delegando a análise das tarefas aos Agentes Especialistas (Nós) que farão o roteamento semântico da Inbox.

Substituição dos Mocks: Trocar os retornos mockados dos Adapters pelas chamadas diretas às APIs usando os SDKs oficiais instalados.