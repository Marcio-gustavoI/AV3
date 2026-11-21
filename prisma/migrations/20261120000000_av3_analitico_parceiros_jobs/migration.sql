-- Migração AV3: Camada Analítica, API Pública (Parceiros Externos) e Processamento Assíncrono (Jobs)

-- 1. Tabela parceiros_externos
CREATE TABLE "parceiros_externos" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "api_key_prefixo" TEXT NOT NULL,
    "permissoes" TEXT[],
    "organizacao_id" UUID,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parceiros_externos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parceiros_externos_api_key_hash_key" ON "parceiros_externos"("api_key_hash");
CREATE INDEX "parceiros_externos_organizacao_id_idx" ON "parceiros_externos"("organizacao_id");

ALTER TABLE "parceiros_externos"
    ADD CONSTRAINT "parceiros_externos_organizacao_id_fkey"
    FOREIGN KEY ("organizacao_id") REFERENCES "organizacoes"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Tabela resultados_analiticos
CREATE TABLE "resultados_analiticos" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "parametros" JSONB,
    "resultado" JSONB NOT NULL,
    "gerado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resultados_analiticos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resultados_analiticos_tipo_check" CHECK ("tipo" IN ('EFICIENCIA_OPERACIONAL', 'RENTABILIDADE', 'VIDA_UTIL'))
);

CREATE INDEX "resultados_analiticos_tipo_idx" ON "resultados_analiticos"("tipo");
CREATE INDEX "resultados_analiticos_gerado_em_idx" ON "resultados_analiticos"("gerado_em");

-- 3. Tabela jobs_relatorios
CREATE TABLE "jobs_relatorios" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "progresso" INTEGER NOT NULL DEFAULT 0,
    "parceiro_id" UUID,
    "usuario_id" UUID,
    "parametros" JSONB,
    "resultado" JSONB,
    "erro" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluido_em" TIMESTAMP(3),

    CONSTRAINT "jobs_relatorios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "jobs_relatorios_tipo_check" CHECK ("tipo" IN ('EFICIENCIA', 'RENTABILIDADE', 'VIDA_UTIL')),
    CONSTRAINT "jobs_relatorios_status_check" CHECK ("status" IN ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'ERRO')),
    CONSTRAINT "jobs_relatorios_progresso_check" CHECK ("progresso" >= 0 AND "progresso" <= 100),
    CONSTRAINT "jobs_relatorios_tentativas_check" CHECK ("tentativas" >= 0)
);

CREATE INDEX "jobs_relatorios_status_idx" ON "jobs_relatorios"("status");
CREATE INDEX "jobs_relatorios_criado_em_idx" ON "jobs_relatorios"("criado_em");
CREATE INDEX "jobs_relatorios_parceiro_id_idx" ON "jobs_relatorios"("parceiro_id");

ALTER TABLE "jobs_relatorios"
    ADD CONSTRAINT "jobs_relatorios_parceiro_id_fkey"
    FOREIGN KEY ("parceiro_id") REFERENCES "parceiros_externos"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jobs_relatorios"
    ADD CONSTRAINT "jobs_relatorios_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
