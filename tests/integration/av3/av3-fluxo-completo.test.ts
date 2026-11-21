import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../src/app.js';
import {
  ClassificacaoDestino,
  EstadoFisico,
  Papel,
  StatusEquipamento,
  TipoEquipamento,
} from '../../../src/domain/index.js';
import { prisma } from '../../../src/lib/prisma.js';
import { PrismaAnaliticoRepository } from '../../../src/modules/analitico/analitico.repository.js';
import { AnaliticoService } from '../../../src/modules/analitico/analitico.service.js';
import { PrismaJobRepository } from '../../../src/modules/job/job.repository.js';
import type { PayloadFilaRelatorio } from '../../../src/modules/job/job.service.js';
import { PrismaParametroRepository } from '../../../src/modules/parametro/parametro.repository.js';
import { PermissaoParceiro } from '../../../src/modules/parceiro/parceiro.repository.js';
import { processarJobRelatorio } from '../../../src/workers/relatorio.worker.js';
import {
  ID_USUARIO_TESTE_PADRAO,
  garantirUsuarioTesteNoBanco,
  gerarCabecalhoAuth,
  limparBanco,
} from '../../helpers/banco.js';

describe('Integração AV3: Analítico, Parceiros (X-Api-Key), API Pública e Jobs Assíncronos', () => {
  let app: FastifyInstance;
  const filaPublicada: PayloadFilaRelatorio[] = [];

  beforeAll(async () => {
    app = await buildApp({
      publicadorFila: {
        publicar: async (payload) => {
          filaPublicada.push(payload);
        },
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    filaPublicada.length = 0;
    await limparBanco();
    await garantirUsuarioTesteNoBanco(ID_USUARIO_TESTE_PADRAO, Papel.ADMIN, 'admin-av3@greencode.local');
  });

  it('expõe rotas AV3 e securityScheme apiKeyAuth no /docs/json', async () => {
    const resp = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(resp.statusCode).toBe(200);
    const spec = resp.json<{
      components: { securitySchemes: Record<string, unknown> };
      paths: Record<string, unknown>;
    }>();

    expect(spec.components.securitySchemes).toHaveProperty('apiKeyAuth');
    expect(spec.paths).toHaveProperty('/api/v1/analitico/eficiencia');
    expect(spec.paths).toHaveProperty('/api/v1/analitico/rentabilidade');
    expect(spec.paths).toHaveProperty('/api/v1/analitico/vida-util');
    expect(spec.paths).toHaveProperty('/api/v1/analitico/historico');
    expect(spec.paths).toHaveProperty('/api/v1/parceiros');
    expect(spec.paths).toHaveProperty('/api/v1/jobs/relatorio');
    expect(spec.paths).toHaveProperty('/api/v1/public/rastreabilidade/{codigoBarras}');
    expect(spec.paths).toHaveProperty('/api/v1/public/lotes');
    expect(spec.paths).toHaveProperty('/api/v1/public/relatorios/eficiencia');
    expect(spec.paths).toHaveProperty('/api/v1/public/jobs/{id}/status');
    expect(spec.paths).toHaveProperty('/api/v1/public/jobs/{id}/resultado');
  });

  it('cria parceiro, consome API Pública via X-Api-Key, bloqueia sem chave/permissão e revoga chave', async () => {
    const headersAdmin = gerarCabecalhoAuth(app, Papel.ADMIN, ID_USUARIO_TESTE_PADRAO);

    // 1. Cria organização e lote com equipamento no banco
    const orgResp = await app.inject({
      method: 'POST',
      url: '/api/v1/organizacoes',
      headers: headersAdmin,
      payload: { codigo: 'AV3ORG', cnpj: '11222333000181', nome: 'Organização AV3' },
    });
    expect(orgResp.statusCode).toBe(201);
    const org = orgResp.json<{ id: string }>();

    const hoje = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const loteResp = await app.inject({
      method: 'POST',
      url: '/api/v1/lotes',
      headers: headersAdmin,
      payload: {
        organizacaoId: org.id,
        notaFiscal: 'NF-AV3-001',
        transportadora: 'EcoTrans',
        dataEntrada: hoje,
        equipamentos: [
          {
            tipo: TipoEquipamento.NOTEBOOK,
            descricao: 'Notebook Corporativo',
            estadoFisico: EstadoFisico.BOM,
            valorAquisicao: 4000,
          },
        ],
      },
    });
    expect(loteResp.statusCode).toBe(201);
    const lote = loteResp.json<{
      id: string;
      equipamentos: Array<{ id: string; codigoBarrasInterno: string }>;
    }>();
    const codigoBarras = lote.equipamentos[0]!.codigoBarrasInterno;

    // 2. Sem X-Api-Key -> 401
    const semChave = await app.inject({
      method: 'GET',
      url: `/api/v1/public/rastreabilidade/${codigoBarras}`,
    });
    expect(semChave.statusCode).toBe(401);

    // 3. ADMIN cria parceiro vinculado à organização
    const criarParceiro = await app.inject({
      method: 'POST',
      url: '/api/v1/parceiros',
      headers: headersAdmin,
      payload: {
        nome: 'Parceiro Integrador AV3',
        permissoes: [PermissaoParceiro.LEITURA_RASTREABILIDADE, PermissaoParceiro.LEITURA_LOTES],
        organizacaoId: org.id,
      },
    });
    expect(criarParceiro.statusCode).toBe(201);
    const parceiro = criarParceiro.json<{ id: string; apiKey: string }>();
    expect(parceiro.apiKey.startsWith('greencode_')).toBe(true);

    // 4. Consulta rastreabilidade via API Pública -> 200
    const rast = await app.inject({
      method: 'GET',
      url: `/api/v1/public/rastreabilidade/${codigoBarras}`,
      headers: { 'x-api-key': parceiro.apiKey },
    });
    expect(rast.statusCode).toBe(200);
    expect(rast.json<{ codigoBarras: string; status: string }>()).toMatchObject({
      codigoBarras,
      status: StatusEquipamento.RECEBIDO,
    });

    // 5. Tentativa de escrita sem permissão ESCRITA_LOTES -> 403
    const semEscrita = await app.inject({
      method: 'POST',
      url: '/api/v1/public/lotes',
      headers: { 'x-api-key': parceiro.apiKey },
      payload: {
        organizacaoId: org.id,
        notaFiscal: 'NF-NEGADA',
        transportadora: 'EcoTrans',
        dataEntrada: hoje,
        equipamentos: [],
      },
    });
    expect(semEscrita.statusCode).toBe(403);

    // 6. Revoga parceiro -> chave passa a retornar 401
    const revogar = await app.inject({
      method: 'DELETE',
      url: `/api/v1/parceiros/${parceiro.id}`,
      headers: headersAdmin,
    });
    expect(revogar.statusCode).toBe(200);
    expect(revogar.json<{ ativo: boolean }>().ativo).toBe(false);

    const aposRevogar = await app.inject({
      method: 'GET',
      url: `/api/v1/public/rastreabilidade/${codigoBarras}`,
      headers: { 'x-api-key': parceiro.apiKey },
    });
    expect(aposRevogar.statusCode).toBe(401);
  });

  it('executa análises, persiste histórico e conclui fluxo assíncrono de job (PENDENTE -> CONCLUIDO)', async () => {
    const headersAdmin = gerarCabecalhoAuth(app, Papel.ADMIN, ID_USUARIO_TESTE_PADRAO);

    // Cria equipamento DESTINADO para REUTILIZACAO para rentabilidade
    const org = await prisma.organizacao.create({
      data: { codigo: 'ORGANA', cnpj: '12ABC34501DE35', nome: 'Org Analítica' },
    });
    const lote = await prisma.lote.create({
      data: {
        organizacaoId: org.id,
        notaFiscal: 'NF-ANA-1',
        transportadora: 'Transp',
        dataEntrada: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    await prisma.equipamento.create({
      data: {
        loteId: lote.id,
        codigoBarrasInterno: 'GC-000099',
        tipo: TipoEquipamento.NOTEBOOK,
        descricao: 'Notebook Reutilizado',
        valorAquisicao: '5000.00',
        estadoFisico: EstadoFisico.EXCELENTE,
        status: StatusEquipamento.DESTINADO,
        triagemCompleta: true,
        classificacaoDestino: ClassificacaoDestino.REUTILIZACAO,
      },
    });

    // 1. Endpoints analíticos diretos + histórico
    const rentResp = await app.inject({
      method: 'GET',
      url: '/api/v1/analitico/rentabilidade',
      headers: headersAdmin,
    });
    expect(rentResp.statusCode).toBe(200);
    expect(rentResp.json<{ dados: Record<string, Record<string, { quantidade: number }>> }>().dados.NOTEBOOK?.EXCELENTE?.quantidade).toBe(1);

    const histResp = await app.inject({
      method: 'GET',
      url: '/api/v1/analitico/historico',
      headers: headersAdmin,
    });
    expect(histResp.statusCode).toBe(200);
    expect(histResp.json<{ resultados: unknown[] }>().resultados.length).toBeGreaterThanOrEqual(1);

    // 2. Submete job assíncrono -> 202
    const jobResp = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/relatorio',
      headers: headersAdmin,
      payload: { tipo: 'RENTABILIDADE' },
    });
    expect(jobResp.statusCode).toBe(202);
    const { jobId } = jobResp.json<{ jobId: string; status: string }>();
    expect(filaPublicada).toHaveLength(1);

    // Antes do worker: GET /resultado devolve 202
    const pendente = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}/resultado`,
      headers: headersAdmin,
    });
    expect(pendente.statusCode).toBe(202);

    // Worker processa o payload enfileirado
    await processarJobRelatorio(filaPublicada[0]!, {
      jobRepo: new PrismaJobRepository(prisma),
      analiticoService: new AnaliticoService(
        new PrismaAnaliticoRepository(prisma),
        new PrismaParametroRepository(prisma),
      ),
    });

    // Após o worker: GET /status = CONCLUIDO (100%) e GET /resultado = 200 (JSON e CSV)
    const statusResp = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}/status`,
      headers: headersAdmin,
    });
    expect(statusResp.statusCode).toBe(200);
    expect(statusResp.json<{ status: string; progresso: number }>()).toMatchObject({
      status: 'CONCLUIDO',
      progresso: 100,
    });

    const csvResp = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}/resultado?formato=csv`,
      headers: headersAdmin,
    });
    expect(csvResp.statusCode).toBe(200);
    expect(csvResp.headers['content-type']).toContain('text/csv');
  });
});
