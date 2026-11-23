# Relatório Técnico — Evolução AV3 (`greencode`)

**Projeto:** `greencode` — API REST de Logística Reversa de Resíduos Eletrônicos  
**Autor:** Gustavo — FATEC DSM  
**Base:** Evolução do monólito AV2 (Node.js 22, TypeScript strict ESM, Fastify 5, Prisma 6, PostgreSQL 16)

---

## 1. Visão Geral da Evolução AV2 → AV3

A AV3 preserva integralmente as rotas internas, regras de negócio (`R1` a `R12`), triggers de imutabilidade e padrão arquitetural em camadas (`Controller → Service → Repository`) da AV2, adicionando três novos pilares:

1. **Pilar 1 — Camada Analítica (`src/modules/analitico/`, `src/jobs/cron.ts`):** indicadores de eficiência operacional, rentabilidade estimada por tipo/estado físico e projeção preditiva de vida útil via regressão linear simples, persistidos em `resultados_analiticos` e executáveis sob demanda ou via tarefa agendada (`node-cron`).
2. **Pilar 2 — API Pública com Chaves de API (`src/modules/parceiro/`, `src/modules/public/`, `src/plugins/api-key-auth.ts`):** superfície pública separada em `/api/v1/public/*`, autenticada exclusivamente por `X-Api-Key` (sem JWT), com controle granular de permissões (`LEITURA_RASTREABILIDADE`, `LEITURA_LOTES`, `ESCRITA_LOTES`), isolamento por organização e rate limit dedicado por chave (`100 req/min`).
3. **Pilar 3 — Processamento Assíncrono (`src/modules/job/`, `src/lib/redis.ts`, `src/workers/relatorio.worker.ts`):** enfileiramento de relatórios pesados via **BullMQ + Redis 7** no padrão polling (`POST → jobId → GET /status → GET /resultado`), com progresso granular (10% → 40% → 80% → 100%), exportação JSON/CSV e retry exponencial.

---

## 2. Justificativa das Escolhas Técnicas

### 2.1 Biblioteca de Estatística: `simple-statistics` vs `mathjs`

A biblioteca `simple-statistics` foi escolhida por ser madura, amplamente testada em produção, possuir **zero dependências transitivas** e oferecer suporte nativo a módulos ESM puros (`"type": "module"`), alinhando-se diretamente ao setup Node.js 22 + TypeScript strict do projeto. Sua API enxuta entrega exatamente as primitivas necessárias para os três tipos de análise do domínio: `mean()`, `median()` e `standardDeviation()` para a eficiência operacional de triagem, além de `linearRegression()` e `linearRegressionLine()` (mínimos quadrados ordinários) para projetar quando cada tipo de equipamento atingirá o estado `SUCATA`.

A alternativa avaliada — `mathjs` — foi rejeitada por representar *overkill* arquitetural para o escopo da AV3. Ela embute um motor completo de álgebra simbólica, parser de expressões, matrizes e unidades físicas que aumentariam significativamente o tamanho do pacote e a superfície de manutenção sem ganho real para estatística descritiva simples. Para os cálculos monetários da análise de rentabilidade (`valorAquisicao × COEF_DEPRECIACAO_<TIPO> × fatorEstadoFisico`), manteve-se a biblioteca `decimal.js` já consolidada na AV2, evitando imprecisões de ponto flutuante IEEE 754.

| Critério | `simple-statistics` (escolhida) | `mathjs` (rejeitada) |
|---|---|---|
| Foco | Estatística descritiva e regressão (`mean`, `median`, `standardDeviation`, `linearRegression`) | Álgebra simbólica, matrizes, unidades físicas e parser de expressões |
| Dependências / ESM | Zero dependências externas, ESM puro, pacote leve | Bundle extenso para recursos não utilizados |
| Precisão financeira | Combinada com `decimal.js` (padrão da AV2) | Exige configuração explícita de `BigNumber` |

---

### 2.2 Modelagem das Novas Tabelas Prisma

Foram adicionados três novos modelos em `prisma/schema.prisma`, versionados na migração `20261120000000_av3_analitico_parceiros_jobs`:

**1. `ResultadoAnalitico` (`resultados_analiticos`):** o campo `resultado` foi modelado como `Json` (`JSONB` no PostgreSQL) para acomodar com flexibilidade as três estruturas distintas de saída (`EFICIENCIA_OPERACIONAL`, `RENTABILIDADE` e `VIDA_UTIL`) sem exigir a criação e manutenção de três tabelas separadas ou migrações a cada novo indicador adicionado. A coluna `tipo` é protegida por `CHECK` constraint no banco, e a coluna `gerado_em` possui índice B-Tree dedicado para garantir consultas históricas eficientes (`ORDER BY gerado_em DESC LIMIT 50`) mesmo com o crescimento contínuo do acervo analítico.

**2. `ParceiroExterno` (`parceiros_externos`):** seguindo o princípio de menor privilégio, a chave de API (`greencode_<uuid>`) nunca é persistida em texto claro; ela é exibida uma única vez na resposta de criação (`POST /api/v1/parceiros`) e armazenada apenas como `api_key_hash` (`UNIQUE`, SHA-256). Dessa forma, mesmo em um eventual comprometimento ou vazamento de backup do banco de dados, as chaves permanecem protegidas contra uso indevido. Em complemento, o campo `api_key_prefixo` armazena apenas os primeiros caracteres da chave para identificação visual segura pelo administrador, enquanto `organizacao_id` (FK com `onDelete: Restrict`) garante isolamento de escopo entre parceiros e `ativo = false` permite revogação auditável sem perda de histórico.

**3. `JobRelatorio` (`jobs_relatorios`):** o campo `status` foi modelado como `String` com `CHECK` constraint no PostgreSQL (`PENDENTE`, `PROCESSANDO`, `CONCLUIDO`, `ERRO`) em vez de um `enum` nativo do Prisma/PostgreSQL. Essa decisão evita migrações destrutivas ou bloqueantes (`ALTER TYPE`) caso novos estados sejam necessários no futuro (como `CANCELADO` ou `EXPIRADO`), preservando integridade no banco com menor custo evolutivo. Adicionalmente, o campo `progresso` (inteiro de `0` a `100`, validado por `CHECK`) fornece feedback granular ao cliente durante o polling (`10%` ao iniciar, `40%` após coleta/preparação, `80%` após cálculos estatísticos e `100%` na conclusão).

---

### 2.3 Política de Retry e Tratamento de Falhas do Worker BullMQ

A fila `relatorio` (BullMQ sobre Redis 7) foi configurada com política de **3 tentativas** e **backoff exponencial** iniciando em 1 segundo (`1s → 2s → 4s`). Essa estratégia foi calibrada para absorver falhas transitórias de infraestrutura — como breves reconexões do PostgreSQL, picos momentâneos de latência no Redis ou contenção temporária de conexões — que normalmente se resolvem em poucos segundos sem exigir intervenção manual nem sobrecarregar o banco com reenvios imediatos.

Por outro lado, limitar o retry a 3 tentativas evita ciclos infinitos de processamento quando ocorre uma falha estrutural (por exemplo, dados corrompidos, erro de regra de negócio ou indisponibilidade prolongada que demanda ação humana). Quando todas as tentativas falham, o job nunca é descartado silenciosamente: o worker atualiza `JobRelatorio` para `status = 'ERRO'`, incrementa o contador `tentativas` e persiste a mensagem de erro na coluna `erro` para diagnóstico posterior pela equipe de operação e consulta via `GET /jobs/:id/status`. No encerramento do processo, `src/server.ts` invoca `fecharWorker()` antes de `app.close()`, assegurando que jobs em andamento sejam finalizados sem corrupção de estado.

---

### 2.4 Autenticação Isolada e Rate Limiting na API Pública

O hook global de autenticação JWT (`src/plugins/auth.ts`) ignora explicitamente o prefixo `/api/v1/public`, enquanto o plugin encapsulado da API Pública registra `registrarAutenticacaoApiKey` (`src/plugins/api-key-auth.ts`). Essa separação impede qualquer confusão entre sessões internas de usuários e integrações máquina-a-máquina de parceiros externos.

Além da verificação de permissões granulares (`LEITURA_RASTREABILIDADE`, `LEITURA_LOTES`, `ESCRITA_LOTES`) e do isolamento estrito por `organizacaoId` (parceiros sem organização vinculada recebem `403`), o rate limit é aplicado por chave de API (`100 req/min` usando `x-api-key` como `keyGenerator`), impedindo que um parceiro específico esgote a cota de outros integradores que compartilhem o mesmo NAT ou proxy reverso.

---

## 3. Plano de Escala para Centenas e Milhares de Parceiros

### 3.1 Curto Prazo (dezenas a centenas de parceiros)

No curto prazo, o principal gargalo em cenários de alto volume de chamadas públicas é o lookup repetitivo de `ParceiroExterno` no PostgreSQL a cada requisição autenticada por `X-Api-Key`. A primeira otimização planejada é introduzir um **cache read-through no Redis** indexado por `api_key_hash` com TTL curto (ex.: 60 segundos), reduzindo drasticamente a pressão de leitura sobre o banco relacional e invalidando a entrada imediatamente sempre que o administrador atualizar permissões ou revogar o parceiro via `ParceiroService`.

Em paralelo, a separação lógica já suportada pelas flags `WORKER_HABILITADO` e `CRON_HABILITADO` permite executar réplicas HTTP puras (`WORKER_HABILITADO=false`, `CRON_HABILITADO=false`) atrás de um load balancer, mantendo os workers e o agendamento cron isolados do tráfego síncrono dos parceiros.

### 3.2 Médio Prazo (centenas a poucos milhares de parceiros)

Com o aumento simultâneo da fila de relatórios pesados e do volume de movimentações históricas, o plano prevê elevar `WORKER_CONCORRENCIA` e escalar horizontalmente o número de processos consumidores do BullMQ. Como os jobs analíticos são majoritariamente intensivos em leitura e agregação, recomenda-se adicionar **réplicas de leitura (Read Replicas) do PostgreSQL** dedicadas ao `PrismaAnaliticoRepository`, isolando completamente as queries analíticas das transações OLTP de recebimento de lotes e movimentações.

Adicionalmente, relatórios volumosos em JSON ou CSV podem ser gravados pelo worker em Object Storage compatível com S3 (MinIO/AWS S3), armazenando em `jobs_relatorios.resultado` apenas os metadados e uma URL pré-assinada com expiração curta, evitando inflar o banco relacional com blobs extensos.

### 3.3 Longo Prazo (milhares de parceiros e alta disponibilidade)

Em escala corporativa de milhares de parceiros simultâneos, a arquitetura modular já desacoplada por repositórios permite **extrair o módulo analítico e os workers para um microserviço dedicado** (com ciclo de deploy e dimensionamento de CPU/memória independentes da API transacional), alimentado por eventos ou réplica analítica.

Para sustentar alta disponibilidade e throughput elevado de enfileiramento sem ponto único de falha, a instância única de Redis evoluiria para **Redis Cluster** (ou Redis Sentinel com particionamento por fila), combinado a políticas de *backpressure* por plano de parceiro e observabilidade centralizada das métricas de fila (profundidade, latência P95 e taxa de jobs em `ERRO`).
