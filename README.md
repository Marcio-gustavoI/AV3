# greencode API

Node.js 22 · TypeScript · Fastify 5 · Prisma 6 · PostgreSQL · Redis · BullMQ

API REST para logística reversa e rastreabilidade de resíduos eletrônicos, desenvolvida em três etapas para a disciplina de Desenvolvimento de Software Multiplataforma — FATEC.

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Arquitetura](#2-arquitetura)
3. [Pré-requisitos e instalação](#3-pré-requisitos-e-instalação)
4. [Variáveis de ambiente](#4-variáveis-de-ambiente)
5. [Usuários do seed e papéis](#5-usuários-do-seed-e-papéis)
6. [Endpoints — API Interna (/api/v1)](#6-endpoints--api-interna-apiv1)
7. [Endpoints — API Pública (/api/v1/public)](#7-endpoints--api-pública-apiv1public)
8. [Regras de negócio](#8-regras-de-negócio)
9. [Processamento assíncrono (BullMQ + Redis)](#9-processamento-assíncrono-bullmq--redis)
10. [Camada analítica](#10-camada-analítica)
11. [Testes](#11-testes)
12. [Estrutura de pastas](#12-estrutura-de-pastas)
13. [Atividade 3 em resumo](#13-atividade-3-em-resumo)

---

## 1. Visão geral

O projeto **greencode** gerencia o ciclo completo de logística reversa de resíduos eletrônicos (e-waste) — do recebimento de lotes de organizações clientes até triagem, desmonte, destinação, auditoria imutável e análise estatística — evoluído em três entregas:

- **AV1:** aplicação CLI com persistência em arquivos criptografados (AES-256) e journal imutável.
- **AV2:** migração para API REST monolítica com Fastify 5, TypeBox, Prisma 6, PostgreSQL 16, JWT, RBAC em duas camadas, triggers de imutabilidade no banco e documentação OpenAPI/Swagger.
- **AV3:** evolução para plataforma analítica e integrável — camada de análises (eficiência operacional, rentabilidade por tipo e vida útil preditiva), API pública com chaves de API (`X-Api-Key`), rate limit por parceiro, agendamento automático (`node-cron`) e processamento assíncrono com **BullMQ + Redis**.

**Compatibilidade:** Windows 10 ou superior, Ubuntu 24.04.03 ou superior e distribuições derivadas do Ubuntu. O projeto não possui dependências nativas em C++ (utiliza `bcryptjs` em vez de `bcrypt`), garantindo instalação portátil entre sistemas operacionais.

---

## 2. Arquitetura

O sistema é um **monólito modular em camadas** no padrão `Controller → Service → Repository`:

- **Controller (`*.controller.ts`):** declara rotas Fastify, schemas TypeBox (validação em runtime + geração automática de OpenAPI) e delega a execução ao service correspondente.
- **Service (`*.service.ts`):** concentra as regras de negócio, autorizações por papel/permissão e transações atômicas; é totalmente independente de Fastify e Prisma.
- **Repository (`*.repository.ts`):** encapsula consultas Prisma (com `select`/`include` evitando N+1) e fornece implementações em memória para testes unitários.
- **Domain (`src/domain/`):** enums, erros tipados (`ErroDominio`), relógio injetável (`Relogio`), validadores (`ValidadorCnpj`, `ValidadorLote`, `ValidadorMovimentacao`), regras polimórficas de transição (`RegraTransicao`) e fábricas (`LoteFactory`, `MovimentacaoFactory`).

A composição das dependências é feita por **injeção de dependências manual** em `src/app.ts` (`buildApp()`), permitindo trocar relógio, origens CORS e publicador de fila nos testes sem mocks pesados.

Na **AV3**, foram adicionados:

- **Módulos:** `analitico`, `parceiro`, `job` e `public` (sob o prefixo `/api/v1/public`).
- **Worker BullMQ (`src/workers/relatorio.worker.ts`):** consome a fila `relatorio`, atualiza o progresso do job no PostgreSQL e exporta `fecharWorker()` para o graceful shutdown.
- **Agendador (`src/jobs/cron.ts`):** usa `node-cron` para executar automaticamente as três análises todos os dias às `02:00` (`CRON_ANALITICO=0 2 * * *`).

---

## 3. Pré-requisitos e instalação

### Ubuntu 24.04+

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs docker.io docker-compose-v2
sudo usermod -aG docker $USER

cd greencode
cp .env.example .env
docker compose up -d
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

### Windows 10/11 (PowerShell)

```powershell
winget install OpenJS.NodeJS.LTS
winget install Docker.DockerDesktop   # reinicie e abra o Docker Desktop

cd greencode
Copy-Item .env.example .env
docker compose up -d
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Documentação interativa (Swagger / OpenAPI) disponível em: `http://localhost:3000/docs`

### Scripts disponíveis

| Script | Descrição |
|---|---|
| `npm run dev` | Sobe o servidor em modo desenvolvimento com hot-reload (`tsx watch src/server.ts`) |
| `npm run build` | Compila o projeto TypeScript para `dist/` (`tsc --project tsconfig.json`) |
| `npm start` | Executa a versão compilada (`node dist/server.js`) |
| `npm run typecheck` | Verifica tipos TypeScript em `src/` e `tests/` sem emitir arquivos |
| `npm run lint` | Executa análise estática com ESLint |
| `npm test` | Executa a suíte de testes com Vitest |
| `npm run test:coverage` | Executa os testes e gera relatório de cobertura v8 |
| `npm run db:migrate` | Aplica migrações pendentes no banco principal (`prisma migrate deploy`) |
| `npm run db:seed` | Popula o banco de desenvolvimento de forma idempotente (`tsx prisma/seed.ts`) |
| `npm run db:studio` | Abre o Prisma Studio para inspeção visual do banco |
| `npm run criar-admin` | Provisiona um usuário `ADMIN` diretamente no banco (`scripts/criar-admin.ts`) |
| `npm run verificar` | Executa `typecheck`, `lint` e `test` em sequência |

---

## 4. Variáveis de ambiente

Copie `.env.example` para `.env`. Todas as variáveis são validadas na inicialização em `src/config/env.ts`.

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `PORT` | Não | `3000` | Porta HTTP do servidor |
| `HOST` | Não | `0.0.0.0` | Endereço de bind do servidor |
| `NODE_ENV` | Não | `development` | Ambiente de execução (`development`, `test`, `production`) |
| `DATABASE_URL` | Sim | — | URL de conexão do PostgreSQL principal (porta `5432`) |
| `DATABASE_URL_TEST` | Em testes | — | URL do PostgreSQL de testes (porta `5433`, deve conter `_test`) |
| `JWT_SECRET` | Sim | — | Segredo para assinatura JWT (mínimo 32 caracteres) |
| `JWT_EXPIRA_EM` | Não | `30m` | Tempo de expiração do token JWT |
| `BCRYPT_ROUNDS` | Não | `12` | Custo (salt rounds) do hash `bcryptjs` (mínimo 10) |
| `CORS_ORIGENS` | Não | `""` | Origens CORS permitidas separadas por vírgula (vazio bloqueia cross-origin) |
| `TZ_NEGOCIO` | Não | `America/Sao_Paulo` | Fuso horário de negócio para validação de datas (R2) e cron |
| `LOG_MAX_SIZE` | Não | `10m` | Tamanho máximo de cada arquivo de log antes da rotação (`pino-roll`) |
| `LOG_LEVEL` | Não | `info` | Nível do logger Pino (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `AUDITORIA_RETENCAO_DIAS` | Não | `180` | Retenção mínima em dias para limpeza de auditoria (mínimo 180) |
| `SHUTDOWN_TIMEOUT_MS` | Não | `10000` | Tempo máximo (ms) aguardado no graceful shutdown |
| `REDIS_HOST` | Não | `localhost` | Host do servidor Redis (fila BullMQ — AV3) |
| `REDIS_PORT` | Não | `6379` | Porta do servidor Redis (AV3) |
| `REDIS_PASSWORD` | Não | `""` | Senha do Redis, quando configurada (AV3) |
| `WORKER_HABILITADO` | Não | `true` (`false` em `test`) | Ativa o consumidor BullMQ no processo do servidor (AV3) |
| `WORKER_CONCORRENCIA` | Não | `2` | Quantidade de jobs processados em paralelo pelo worker (AV3) |
| `CRON_ANALITICO` | Não | `0 2 * * *` | Expressão `node-cron` para execução recorrente das análises (AV3) |
| `CRON_HABILITADO` | Não | `true` (`false` em `test`) | Ativa o agendamento cron no processo do servidor (AV3) |
| `API_KEY_PREFIX` | Não | `greencode_` | Prefixo aplicado às chaves geradas para parceiros externos (AV3) |
| `API_KEY_RATE_LIMIT_MAX` | Não | `100` | Limite de requisições por minuto por `X-Api-Key` na API pública (AV3) |

---

## 5. Usuários do seed e papéis

⚠️ **Senhas de desenvolvimento. Não use em produção.** O script `prisma/seed.ts` recusa execução caso `NODE_ENV=production`.

| Usuário | Senha | Papel |
|---|---|---|
| `admin@greencode.com.br` | `AdminSeed123` | `ADMIN` |
| `operador@greencode.com.br` | `OperadorSeed123` | `OPERADOR_CADASTRO` |
| `gestor@greencode.com.br` | `GestorSeed123` | `GESTOR_ALMOXARIFADO` |
| `auditor@greencode.com.br` | `AuditorSeed123` | `AUDITOR` |

### Matriz de permissões

- **`ADMIN`:** acesso total a todos os recursos, incluindo gestão de usuários (`/usuarios`), parâmetros globais (`/parametros`), parceiros externos (`/parceiros`), relatórios, auditoria, camada analítica e jobs.
- **`OPERADOR_CADASTRO`:** leitura e escrita em organizações (`/organizacoes`) e contratos (`/organizacoes/:id/contrato`); leitura de lotes, equipamentos, camada analítica e jobs; sem acesso a escrita logística, relatórios financeiros ou auditoria.
- **`GESTOR_ALMOXARIFADO`:** leitura e escrita em lotes (`/lotes`), equipamentos (`/equipamentos`), triagem (`/equipamentos/:id/triagem`) e movimentações (`/equipamentos/:id/movimentacoes`); leitura de organizações, contratos, camada analítica e jobs; sem acesso a `/relatorios` ou `/auditoria`.
- **`AUDITOR`:** somente leitura em todos os recursos operacionais, acesso completo a relatórios (`/relatorios/*`), auditoria (`/auditoria`), camada analítica e jobs; bloqueado com `403` em qualquer tentativa de escrita.

---

## 6. Endpoints — API Interna (`/api/v1`)

**Autenticação:** `Authorization: Bearer <token>` (exceto `GET /saude` e `POST /api/v1/auth/login`).

### Sistema e Autenticação

| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| `GET` | `/saude` | Verifica saúde do servidor | Público |
| `POST` | `/api/v1/auth/login` | Autentica usuário e emite JWT (rate limit: 5 req/min por IP) | Público |
| `POST` | `/api/v1/auth/renovar` | Renova token JWT de usuário ativo | Todos |
| `GET` | `/api/v1/auth/me` | Retorna perfil e permissões do usuário autenticado | Todos |

### Usuários e Parâmetros

| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| `POST` | `/api/v1/usuarios` | Cria conta de usuário | `ADMIN` |
| `GET` | `/api/v1/usuarios` | Lista usuários com paginação | `ADMIN` |
| `GET` | `/api/v1/usuarios/:id` | Busca usuário por ID | `ADMIN` |
| `PATCH` | `/api/v1/usuarios/:id` | Atualiza usuário (com controle de versão) | `ADMIN` |
| `GET` | `/api/v1/parametros` | Lista parâmetros globais | `ADMIN` |
| `PUT` | `/api/v1/parametros` | Atualiza parâmetros em lote | `ADMIN` |
| `PUT` | `/api/v1/parametros/:chave` | Cria ou atualiza um parâmetro específico | `ADMIN` |

### Organizações e Contratos

| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| `POST` | `/api/v1/organizacoes` | Cadastra organização cliente (valida CNPJ) | `ADMIN`, `OPERADOR_CADASTRO` |
| `GET` | `/api/v1/organizacoes` | Lista organizações paginadas | Todos |
| `GET` | `/api/v1/organizacoes/:id` | Detalhe da organização e seu contrato | Todos |
| `PATCH` | `/api/v1/organizacoes/:id` | Atualiza organização (versionamento otimista) | `ADMIN`, `OPERADOR_CADASTRO` |
| `POST` | `/api/v1/organizacoes/:id/contrato` | Cria contrato vinculado à organização | `ADMIN`, `OPERADOR_CADASTRO` |
| `GET` | `/api/v1/organizacoes/:id/contrato` | Consulta contrato da organização | Todos |
| `PATCH` | `/api/v1/organizacoes/:id/contrato` | Atualiza contrato (versionamento otimista) | `ADMIN`, `OPERADOR_CADASTRO` |

### Lotes, Equipamentos e Movimentações

| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| `POST` | `/api/v1/lotes` | Registra lote e equipamentos em transação atômica | `ADMIN`, `GESTOR_ALMOXARIFADO` |
| `GET` | `/api/v1/lotes` | Lista lotes com paginação e filtro por organização | Todos |
| `GET` | `/api/v1/lotes/:id` | Detalhe do lote com organização e equipamentos | Todos |
| `POST` | `/api/v1/equipamentos` | Adiciona equipamento a um lote existente | `ADMIN`, `GESTOR_ALMOXARIFADO` |
| `GET` | `/api/v1/equipamentos` | Lista equipamentos com filtros e paginação | Todos |
| `GET` | `/api/v1/equipamentos/:id` | Detalhe de um equipamento | Todos |
| `GET` | `/api/v1/equipamentos/:id/rastreabilidade` | Histórico cronológico completo do equipamento | Todos |
| `POST` | `/api/v1/equipamentos/:id/triagem` | Realiza triagem técnica (`EM_TRIAGEM` → `TRIADO`) | `ADMIN`, `GESTOR_ALMOXARIFADO` |
| `POST` | `/api/v1/equipamentos/:id/movimentacoes` | Registra transição de status/estado físico | `ADMIN`, `GESTOR_ALMOXARIFADO` |

### Relatórios e Auditoria

| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| `GET` | `/api/v1/relatorios/resumo` | Resumo operacional por status, estado e organização | `ADMIN`, `AUDITOR` |
| `GET` | `/api/v1/relatorios/financeiro` | Cálculo de depreciação, valor residual e imposto (`Decimal`) | `ADMIN`, `AUDITOR` |
| `GET` | `/api/v1/auditoria` | Consulta paginada ao log imutável de auditoria | `ADMIN`, `AUDITOR` |

### Camada Analítica, Parceiros e Jobs (AV3)

| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| `GET` | `/api/v1/analitico/eficiencia` | Calcula e persiste eficiência operacional de triagem | Todos |
| `GET` | `/api/v1/analitico/rentabilidade` | Calcula e persiste rentabilidade por tipo e estado físico | Todos |
| `GET` | `/api/v1/analitico/vida-util` | Projeta vida útil remanescente via regressão linear | Todos |
| `GET` | `/api/v1/analitico/historico` | Lista últimos resultados analíticos persistidos | Todos |
| `POST` | `/api/v1/parceiros` | Cria parceiro externo e retorna `apiKey` (única vez) | `ADMIN` |
| `GET` | `/api/v1/parceiros` | Lista parceiros externos cadastrados | `ADMIN` |
| `GET` | `/api/v1/parceiros/:id` | Detalhe de um parceiro externo | `ADMIN` |
| `PATCH` | `/api/v1/parceiros/:id` | Atualiza nome, permissões, organização ou status | `ADMIN` |
| `DELETE` | `/api/v1/parceiros/:id` | Revoga chave de API (`ativo = false`) | `ADMIN` |
| `POST` | `/api/v1/jobs/relatorio` | Enfileira relatório assíncrono no BullMQ (`202`) | Todos |
| `GET` | `/api/v1/jobs/:id/status` | Consulta status, progresso e tentativas do job | Todos |
| `GET` | `/api/v1/jobs/:id/resultado` | Retorna resultado (`?formato=json` ou `?formato=csv`) ou `202` | Todos |

### Formato de erro padrão

```json
{
  "erro": "CODIGO",
  "mensagem": "Descrição clara do erro.",
  "severidade": "AVISO",
  "detalhes": []
}
```

---

## 7. Endpoints — API Pública (`/api/v1/public`)

- **Autenticação:** header `X-Api-Key: greencode_<uuid>` (sem JWT).
- **Rate limit:** `100` requisições por minuto por chave (`API_KEY_RATE_LIMIT_MAX`).
- **Isolamento por organização:** consultas e submissões de lotes/equipamentos exigem organização vinculada ao parceiro; parceiros sem `organizacaoId` recebem `403` (`"Parceiro sem organização vinculada"`).

| Método | Rota | Permissão necessária | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/public/rastreabilidade/:codigoBarras` | `LEITURA_RASTREABILIDADE` | Status atual e última movimentação do equipamento |
| `GET` | `/api/v1/public/lotes` | `LEITURA_LOTES` | Lista lotes da organização parceira (`?page=1&limit=20`) |
| `POST` | `/api/v1/public/lotes` | `ESCRITA_LOTES` | Submete novo lote com equipamentos para a organização parceira |
| `GET` | `/api/v1/public/relatorios/eficiencia` | `LEITURA_RASTREABILIDADE` | Enfileira relatório assíncrono de eficiência (`202`) |
| `POST` | `/api/v1/public/jobs/relatorio` | `LEITURA_RASTREABILIDADE` | Enfileira job (`EFICIENCIA`, `RENTABILIDADE` ou `VIDA_UTIL`) |
| `GET` | `/api/v1/public/jobs/:id/status` | `LEITURA_RASTREABILIDADE` | Consulta status e progresso do job |
| `GET` | `/api/v1/public/jobs/:id/resultado?formato=json\|csv` | `LEITURA_RASTREABILIDADE` | Baixa resultado concluído (JSON/CSV) ou `202` se em processamento |

### Exemplo de uso (`curl`)

```bash
KEY="greencode_sua-chave-aqui"
curl -H "X-Api-Key: $KEY" http://localhost:3000/api/v1/public/rastreabilidade/GC-000001
```

No PowerShell (Windows), use `curl.exe` em vez de `curl` (que é alias de `Invoke-WebRequest`):

```powershell
$KEY = "greencode_sua-chave-aqui"
curl.exe -H "X-Api-Key: $KEY" http://localhost:3000/api/v1/public/rastreabilidade/GC-000001
```

---

## 8. Regras de negócio

- **R1 — CNPJ válido e único:** validação completa dos dígitos verificadores (suportando formato numérico e alfanumérico), rejeição de sequências repetidas (`422`) e unicidade no banco (`409`).
- **R2 — Janela de data do lote:** `dataEntrada` não pode ser futura nem anterior a 90 dias no fuso `TZ_NEGOCIO` (`422`), com rede de segurança `CHECK` no PostgreSQL.
- **R3 — Desmonte exige triagem completa:** transição para `EM_DESMONTE` (e etapas seguintes) é bloqueada enquanto `triagemCompleta` for `false` (`422`), reforçada por `CHECK` no banco.
- **R4 — Justificativa em degradação severa:** queda de 2 ou mais níveis no `EstadoFisico` (escala `SUCATA=0` até `EXCELENTE=4`) exige `justificativa` com no mínimo 10 caracteres (`422`).
- **R5 — Fluxo sequencial de status:** transições seguem estritamente a ordem `RECEBIDO → EM_TRIAGEM → TRIADO → EM_DESMONTE → DESMONTADO → DESTINADO`, sem pular etapas ou retroceder (`422`).
- **R6 — Código de barras único e imutável:** formato `GC-000001` gerado via `SEQUENCE` no PostgreSQL, índice `UNIQUE` (`409`) e trigger `trg_equipamentos_codigo_barras_imutavel` bloqueando qualquer `UPDATE`.
- **R7 — Atomicidade de escrita:** criação de lote com equipamentos, triagem e movimentações gravam estado + histórico + auditoria em uma única `$transaction` interativa.
- **R8 — Cálculo financeiro exato:** relatórios financeiros e rentabilidade usam `Decimal` (`decimal.js`) com parâmetros globais (`ALIQUOTA_IMPOSTO` e `COEF_DEPRECIACAO_<TIPO>`), sem aritmética de ponto flutuante.
- **R9 — Triagem técnica estruturada:** exige equipamento em `EM_TRIAGEM`, define `classificacaoDestino` (`REUTILIZACAO`, `RECICLAGEM` ou `DESCARTE_SEGURO`), marca `triagemCompleta = true` e avança o status para `TRIADO` registrando movimentação.
- **R10 — Sem movimentação vazia:** toda movimentação deve alterar efetivamente `status` ou `estadoFisico` (validado no domínio e pelo trigger `trg_movimentacao_sem_mudanca`), sendo imutável após gravação (`trg_movimentacao_imutavel`).
- **R11 — Integridade referencial:** lotes exigem `organizacaoId` ou `orgCodigo` existente (`404`), e relacionamentos usam `onDelete: Restrict`.
- **R12 — Conta inativa e autoproteção:** usuários desativados (`ativo = false`) não podem fazer login nem renovar token (`401`), e um `ADMIN` não pode desativar a própria conta.

---

## 9. Processamento assíncrono (BullMQ + Redis)

Relatórios analíticos pesados podem ser processados fora do ciclo síncrono HTTP no padrão **polling**:

```text
POST /api/v1/jobs/relatorio (ou /api/v1/public/jobs/relatorio)
  → 202 { jobId, status: "PENDENTE" }
  → GET /jobs/:id/status (polling do progresso e status)
  → GET /jobs/:id/resultado?formato=json|csv (200 quando CONCLUIDO; 202 enquanto processa)
```

Principais características implementadas:

- **Retry exponencial:** `3` tentativas automáticas com intervalo `1s → 2s → 4s` para falhas transitórias; em erro definitivo, o registro permanece em `status = "ERRO"` com a mensagem preservada para diagnóstico.
- **Progresso granular:** o worker atualiza `progresso` em `0 → 10` (`PROCESSANDO`) `→ 40` (preparação/coleta) `→ 80` (cálculos concluídos) `→ 100` (`CONCLUIDO`).
- **Concorrência configurável:** controlada por `WORKER_CONCORRENCIA` (padrão `2`).
- **Graceful shutdown:** `src/server.ts` para o cron e executa `fecharWorker()` antes de `app.close()` e `prisma.$disconnect()`.
- **Redis no Docker Compose:** serviço `redis:7-alpine` exposto na porta `6379` com volume persistente `greencode_redis_data` e healthcheck via `redis-cli ping`.

---

## 10. Camada analítica

Implementada em `src/modules/analitico/` usando `simple-statistics` e `decimal.js`:

- **Eficiência operacional (`GET /api/v1/analitico/eficiencia`):** calcula o tempo (em horas) entre `Lote.dataEntrada` e a conclusão da triagem (`Movimentacao` com `statusNovo = TRIADO`), retornando `mediaHoras`, `medianaHoras`, `desvioPadrao`, `totalLotes`, agrupamento `porOperador` e série `porMes`.
- **Rentabilidade por tipo (`GET /api/v1/analitico/rentabilidade`):** avalia equipamentos `DESTINADO` com `classificacaoDestino = REUTILIZACAO`, aplicando `valorAquisicao × COEF_DEPRECIACAO_<TIPO> × fatorEstadoFisico` (`EXCELENTE=1.0`, `BOM=0.8`, `REGULAR=0.5`, `RUIM=0.2`, `SUCATA=0.0`) agrupado por `TipoEquipamento × EstadoFisico`.
- **Vida útil preditiva (`GET /api/v1/analitico/vida-util`):** para cada `TipoEquipamento` com ao menos `5` amostras, ajusta uma regressão linear simples (`y = m·x + b`, onde `x` = dias desde `criadoEm` e `y` = índice do `EstadoFisico` de `0` a `4`) e projeta `diasMediosAteInservivel = -b / m` e `dataPrevistaInservivel` quando `m < 0`.

Todos os cálculos são persistidos na tabela `resultados_analiticos` (consultável via `GET /api/v1/analitico/historico`) e executados automaticamente todo dia às `02:00` pelo agendador `node-cron` (`CRON_ANALITICO`).

---

## 11. Testes

Execução dos testes unitários (não exige banco nem Redis):

```bash
npx vitest run tests/unit tests/analitico tests/parceiro tests/job tests/public
```

Execução da suíte completa (unitários + integração com PostgreSQL de teste na porta `5433`):

```bash
docker compose up -d
npx prisma migrate deploy
npm run test:db:preparar
npm test
npm run test:coverage
```

Cobertura verificada nos novos services da AV3 (`analitico`, `parceiro`, `job`, `public`): **> 95% de linhas e 100% de funções**.

---

## 12. Estrutura de pastas

```text
greencode/
├── docs/                                # Especificação, arquitetura, segurança, decisões e relatório AV3
│   ├── ARQUITETURA.md
│   ├── DECISOES.md
│   ├── ESPECIFICACAO.md
│   ├── PENDENCIAS.md
│   ├── RASTREABILIDADE.md
│   ├── RELATORIO_TECNICO_AV3.md         # Justificativas técnicas e plano de escala da AV3
│   └── SEGURANCA.md
├── prisma/
│   ├── migrations/                      # Migrações SQL versionadas (AV2 + AV3)
│   ├── schema.prisma                    # Modelos relacionais (AV2 + ParceiroExterno, ResultadoAnalitico, JobRelatorio)
│   └── seed.ts                          # Massa de desenvolvimento idempotente
├── scripts/                             # Utilitários CLI (criar-admin, jornada, limpar-auditoria, preparar-banco-teste)
├── src/
│   ├── app.ts                           # Composição Fastify, plugins e injeção de dependências manual
│   ├── server.ts                        # Bootstrap HTTP, worker BullMQ, cron e graceful shutdown
│   ├── config/
│   │   └── env.ts                       # Validação de variáveis de ambiente
│   ├── domain/                          # Enums, erros tipados, relógio, factories, regras e validadores
│   ├── jobs/
│   │   └── cron.ts                      # Agendamento node-cron das análises (02:00 diário)
│   ├── lib/                             # Logger Pino, paginação, Prisma client, Redis/BullMQ e exportação CSV
│   ├── modules/
│   │   ├── analitico/                   # AV3: eficiência, rentabilidade, vida útil e histórico
│   │   ├── auditoria/                   # Consulta ao log imutável de auditoria
│   │   ├── auth/                        # Login JWT, renovação e /me
│   │   ├── contrato/                    # Contratos vinculados às organizações
│   │   ├── equipamento/                 # Cadastro, triagem e rastreabilidade
│   │   ├── job/                         # AV3: submissão, polling de status e download JSON/CSV
│   │   ├── lote/                        # Recebimento atômico de lotes e etiquetas
│   │   ├── movimentacao/                # Transições de status e estado físico
│   │   ├── organizacao/                 # Organizações clientes (CNPJ)
│   │   ├── parametro/                   # Parâmetros globais (impostos e depreciação)
│   │   ├── parceiro/                    # AV3: gestão ADMIN de parceiros e chaves X-Api-Key
│   │   ├── public/                      # AV3: API Pública (/api/v1/public/*)
│   │   ├── relatorio/                   # Relatórios operacionais e financeiros
│   │   └── usuario/                     # Gestão ADMIN de usuários
│   ├── plugins/
│   │   ├── api-key-auth.ts              # AV3: autenticação X-Api-Key e rate limit por chave
│   │   ├── auth.ts                      # Autenticação JWT e RBAC
│   │   ├── error-handler.ts             # Tratamento padronizado de erros HTTP
│   │   └── swagger.ts                   # OpenAPI 3.0 e Swagger UI (/docs)
│   └── workers/
│       └── relatorio.worker.ts          # AV3: consumidor BullMQ da fila de relatórios
├── tests/
│   ├── analitico/                       # Testes unitários do AnaliticoService (AV3)
│   ├── helpers/                         # Auxiliares de limpeza e auth do banco de teste
│   ├── integration/                     # Testes de integração HTTP + PostgreSQL (AV2 + AV3)
│   ├── job/                             # Testes unitários do JobService e worker (AV3)
│   ├── parceiro/                        # Testes unitários do ParceiroService (AV3)
│   ├── public/                          # Testes unitários do PublicService (AV3)
│   └── unit/                            # Testes unitários de domínio e services (AV2)
├── docker-compose.yml                   # PostgreSQL (dev:5432, test:5433) + Redis 7 (6379)
├── .env.example                         # Modelo de variáveis de ambiente
└── package.json                         # Dependências e scripts npm
```

---

## 13. Atividade 3 em resumo

Parceiros externos consomem `/api/v1/public` autenticados com `X-Api-Key` (com rate limit por chave e isolamento por organização), a equipe interna opera `/api/v1` com JWT, relatórios pesados viram jobs em uma fila BullMQ + Redis com polling de progresso e exportação JSON/CSV, e a camada analítica recorrente roda automaticamente via `node-cron` às `02:00`.

Veja [`docs/RELATORIO_TECNICO_AV3.md`](docs/RELATORIO_TECNICO_AV3.md) para as decisões arquiteturais completas, política de retry e plano de escala.
