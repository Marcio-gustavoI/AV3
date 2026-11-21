# Relatório Técnico — Evolução AV3 (`greencode`)

**Projeto:** `greencode` — API REST de Logística Reversa de Resíduos Eletrônicos  
**Autor:** Gustavo — FATEC DSM  
**Base:** Evolução do monólito AV2 (Node.js 22, TypeScript strict ESM, Fastify 5, Prisma 6, PostgreSQL 16)

---

## 1. Visão Geral da Evolução AV2 → AV3

A AV3 preserva integralmente as rotas internas, regras de negócio (`R1` a `R12`), triggers de imutabilidade e padrão arquitetural em camadas (`Controller → Service → Repository`) da AV2, adicionando três novos pilares:

1. **Pilar 1 — Camada Analítica (`src/modules/analitico/`, `src/jobs/cron.ts`):** indicadores de eficiência operacional, rentabilidade estimada por tipo/estado físico e projeção preditiva de vida útil via regressão linear simples, persistidos em `resultados_analiticos` e executáveis sob demanda ou via tarefa agendada (`node-cron`).
2. **Pilar 2 — API Pública com Chaves de API (`src/modules/parceiro/`, `src/modules/public/`, `src/plugins/api-key-auth.ts`):** superfície pública separada em `/api/v1/public/*`, autenticada exclusivamente por `X-Api-Key` (sem JWT), com controle granular de permissões (`LEITURA_RASTREABILIDADE`, `LEITURA_LOTES`, `ESCRITA_LOTES`) e rate limit dedicado por chave (`100 req/min`).
3. **Pilar 3 — Processamento Assíncrono (`src/modules/job/`, `src/lib/redis.ts`, `src/workers/relatorio.worker.ts`):** enfileiramento de relatórios pesados via **BullMQ + Redis 7** no padrão polling (`POST → jobId → GET /status → GET /resultado`), com suporte a download JSON/CSV e retry exponencial.

---

## 2. Justificativa das Escolhas Técnicas

### 2.1 Biblioteca de Estatística: `simple-statistics` vs `mathjs`

| Critério | `simple-statistics` (escolhida) | `mathjs` (rejeitada) |
|---|---|---|
| Foco | Estatística descritiva e regressão (`mean`, `median`, `standardDeviation`, `linearRegression`, `linearRegressionLine`) | Álgebra simbólica, matrizes, unidades físicas e parser de expressões |
| Tamanho / dependências | Zero dependências externas, pacote leve, tipagem direta | Bundle consideravelmente maior para recursos não utilizados |
| Precisão financeira | Complementada com `decimal.js` (já adotado na AV2) para valores monetários | Exige configuração explícita de `BigNumber` para evitar erro de ponto flutuante |

**Decisão:** `simple-statistics` foi adotada para cálculos estatísticos e regressão de mínimos quadrados, mantendo `decimal.js` para a multiplicação `valorAquisicao × COEF_DEPRECIACAO_<TIPO> × fatorEstadoFisico` na análise de rentabilidade.

### 2.2 Modelagem das Novas Tabelas Prisma

Foram adicionados 3 modelos em `prisma/schema.prisma` com migração versionada (`20261120000000_av3_analitico_parceiros_jobs`):

- **`ParceiroExterno` (`parceiros_externos`):**
  - **Segurança da chave (D-23):** a chave em texto puro (`greencode_<uuid>`) é retornada **uma única vez** no `POST /api/v1/parceiros`. O banco armazena apenas `api_key_hash` (`UNIQUE`, SHA-256) e `api_key_prefixo` (para identificação visual pelo ADMIN). Assim, mesmo um vazamento do banco não expõe chaves reutilizáveis.
  - **Escopo multi-organização:** coluna opcional `organizacao_id` (FK com `onDelete: Restrict`) restringe consultas e envios de lotes do parceiro à sua própria organização.
  - **Revogação auditável:** `DELETE /api/v1/parceiros/:id` realiza *soft delete* (`ativo = false`) preservando histórico e auditoria.
- **`ResultadoAnalitico` (`resultados_analiticos`):**
  - Armazena `tipo` (validado por `CHECK` no banco: `EFICIENCIA_OPERACIONAL`, `RENTABILIDADE`, `VIDA_UTIL`), `parametros` (`Json?`), `resultado` (`Json`) e `gerado_em` indexado para consultas temporais (`GET /api/v1/analitico/historico`).
- **`JobRelatorio` (`jobs_relatorios`):**
  - Rastreia o ciclo de vida completo (`PENDENTE → PROCESSANDO → CONCLUIDO | ERRO`), `progresso` (`0..100`), `tentativas`, `erro`, `parceiro_id?`, `usuario_id?`, `resultado` (`Json?`) e `concluido_em`, com `CHECK` constraints no PostgreSQL garantindo invariantes de estado.

### 2.3 Política de Retry e Tratamento de Falhas (BullMQ)

- **Configuração:** `attempts: 3` com backoff exponencial (`type: 'exponential', delay: 1000`), resultando em intervalos de **1s → 2s → 4s** entre re-tentativas em caso de falhas transitórias (ex.: indisponibilidade momentânea do PostgreSQL).
- **Persistência do erro:** a cada falha, o worker atualiza `JobRelatorio` com `status = 'ERRO'`, mensagem em `erro` e `tentativas++`, e relança a exceção para o BullMQ gerenciar o reagendamento. Se uma tentativa posterior obtiver sucesso, o registro transita para `CONCLUIDO` com `erro = null` e `progresso = 100`.
- **Encerramento limpo (Graceful Shutdown):** o `src/server.ts` interrompe primeiro a tarefa `node-cron`, fecha o `Worker` do BullMQ (aguardando jobs em curso finalizarem), fecha o Fastify (incluindo a `Queue`) e desconecta o Prisma antes de encerrar com código `0`.

### 2.4 Autenticação Isolada e Rate Limiting na API Pública

- O hook global de JWT (`src/plugins/auth.ts`) ignora explicitamente `/api/v1/public*`.
- O plugin encapsulado `registrarRotasPublicas` aplica `registrarAutenticacaoApiKey` (`src/plugins/api-key-auth.ts`) exclusivamente às rotas públicas, evitando qualquer mistura entre credenciais internas (JWT) e externas (`X-Api-Key`).
- O rate limit é aplicado **por chave de API** (`keyGenerator: () => apikey:<chave>`, padrão `100 req/min`), impedindo que um parceiro ruidoso degrade o serviço para outros parceiros.

---

## 3. Plano de Escala (Crescimento da Operação)

1. **Separação física de processos (Web vs Worker):**
   - Na AV3, o servidor HTTP e o `Worker` BullMQ sobem juntos em `src/server.ts` controlados por `WORKER_HABILITADO` e `CRON_HABILITADO`.
   - Para escalar horizontalmente sem duplicar agendamentos, basta rodar $N$ réplicas da API com `WORKER_HABILITADO=false` e `CRON_HABILITADO=false`, $M$ réplicas dedicadas de worker (ajustando `WORKER_CONCORRENCIA`), e **1 réplica singleton** (ou Kubernetes `CronJob`) executando o agendamento analítico.
2. **Cache de API Keys no Redis:**
   - Hoje o hook `api-key-auth.ts` valida o hash da chave no PostgreSQL (indexado por `UNIQUE`). Sob alto tráfego de parceiros, pode-se adicionar cache *read-through* no Redis (TTL curto de 60s) com invalidação imediata ao revogar/atualizar o parceiro no `ParceiroService`.
3. **Leitura analítica dedicada:**
   - As consultas de `AnaliticoRepository` utilizam `select` mínimo sem N+1. Em volumes na casa de milhões de movimentações, o próximo passo é direcionar `PrismaAnaliticoRepository` para uma *read replica* do PostgreSQL ou *materialized views* atualizadas pelo cron noturno.
4. **Exportação de relatórios muito grandes:**
   - Para relatórios extensos em CSV/JSON, em vez de gravar o payload integral na coluna `jobs_relatorios.resultado`, o worker pode gravar o arquivo em Object Storage (S3/MinIO) e armazenar apenas a URL assinada com expiração curta.
