import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { EstadoFisico, TipoEquipamento } from '../../domain/index.js';
import { converterParaCsv } from '../../lib/csv.js';
import {
  criarConfigRateLimitApiKey,
  exigirPermissaoParceiro,
  obterParceiroRequisicao,
  registrarAutenticacaoApiKey,
} from '../../plugins/api-key-auth.js';
import { TipoJobRelatorio } from '../job/job.repository.js';
import { type ParceiroRepository, PermissaoParceiro } from '../parceiro/parceiro.repository.js';
import type { PublicService } from './public.service.js';

const RastreabilidadeParamsSchema = Type.Object(
  {
    codigoBarras: Type.String({
      minLength: 3,
      maxLength: 50,
      title: 'Código de barras',
      description: 'Código de barras interno do equipamento (ex.: GC-000001).',
    }),
  },
  {
    title: 'RastreabilidadePublicaParams',
    description: 'Parâmetro de rota com o código de barras do equipamento.',
  },
);

const RastreabilidadePublicaResponseSchema = Type.Object(
  {
    codigoBarras: Type.String({ title: 'Código de barras', description: 'Identificador único do equipamento.' }),
    tipo: Type.String({ title: 'Tipo', description: 'Categoria do equipamento eletrônico.' }),
    status: Type.String({ title: 'Status atual', description: 'Etapa atual no fluxo de logística reversa.' }),
    estadoFisico: Type.String({ title: 'Estado físico', description: 'Classificação física do equipamento.' }),
    classificacaoDestino: Type.Union([Type.String(), Type.Null()], {
      title: 'Classificação de destino',
      description: 'Destino definido na triagem (REUTILIZACAO, RECICLAGEM, DESCARTE_SEGURO) ou null.',
    }),
    ultimaMovimentacao: Type.Union(
      [
        Type.Object({
          data: Type.String({ format: 'date-time', title: 'Data', description: 'Timestamp da última movimentação.' }),
          statusAnterior: Type.String({ title: 'Status anterior', description: 'Status antes da transição.' }),
          statusNovo: Type.String({ title: 'Status novo', description: 'Status após a transição.' }),
        }),
        Type.Null(),
      ],
      { title: 'Última movimentação', description: 'Última transição registrada ou null.' },
    ),
  },
  {
    title: 'RastreabilidadePublicaResponse',
    description: 'Situação pública de rastreabilidade de um equipamento.',
  },
);

const ListarLotesPublicoQuerySchema = Type.Object(
  {
    page: Type.Optional(
      Type.Integer({
        minimum: 1,
        default: 1,
        title: 'Página',
        description: 'Número da página (padrão 1).',
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        default: 20,
        title: 'Limite por página',
        description: 'Quantidade de lotes por página (1 a 100, padrão 20).',
      }),
    ),
    organizacaoId: Type.Optional(
      Type.String({
        format: 'uuid',
        title: 'ID da organização',
        description: 'Filtro opcional de organização (restrito à organização vinculada ao parceiro, se houver).',
      }),
    ),
  },
  {
    title: 'ListarLotesPublicoQuery',
    description: 'Parâmetros de paginação e filtro para consulta pública de lotes.',
  },
);

const ListarLotesPublicoResponseSchema = Type.Object(
  {
    lotes: Type.Array(
      Type.Object({
        id: Type.String({ format: 'uuid', title: 'ID do lote', description: 'UUID do lote.' }),
        organizacaoId: Type.String({ format: 'uuid', title: 'ID da organização', description: 'UUID da organização.' }),
        notaFiscal: Type.String({ title: 'Nota fiscal', description: 'Número da nota fiscal.' }),
        transportadora: Type.String({ title: 'Transportadora', description: 'Transportadora responsável.' }),
        dataEntrada: Type.String({ title: 'Data de entrada', description: 'Data de chegada (YYYY-MM-DD).' }),
        criadoEm: Type.String({ format: 'date-time', title: 'Criado em', description: 'Timestamp de criação.' }),
      }),
      { title: 'Lotes', description: 'Lotes retornados na página.' },
    ),
    total: Type.Integer({ title: 'Total', description: 'Total de lotes encontrados.' }),
    page: Type.Integer({ title: 'Página', description: 'Página atual.' }),
    limit: Type.Integer({ title: 'Limite', description: 'Tamanho da página.' }),
  },
  {
    title: 'ListarLotesPublicoResponse',
    description: 'Lista paginada de lotes para parceiros externos.',
  },
);

const EquipamentoPublicoBodySchema = Type.Object(
  {
    tipo: Type.Union(
      [
        Type.Literal(TipoEquipamento.DESKTOP),
        Type.Literal(TipoEquipamento.NOTEBOOK),
        Type.Literal(TipoEquipamento.MONITOR),
        Type.Literal(TipoEquipamento.SERVIDOR),
        Type.Literal(TipoEquipamento.PERIFERICO),
        Type.Literal(TipoEquipamento.REDE),
        Type.Literal(TipoEquipamento.OUTRO),
      ],
      { title: 'Tipo', description: 'Tipo do equipamento.' },
    ),
    descricao: Type.String({ minLength: 1, maxLength: 500, title: 'Descrição', description: 'Descrição do item.' }),
    estadoFisico: Type.Union(
      [
        Type.Literal(EstadoFisico.SUCATA),
        Type.Literal(EstadoFisico.RUIM),
        Type.Literal(EstadoFisico.REGULAR),
        Type.Literal(EstadoFisico.BOM),
        Type.Literal(EstadoFisico.EXCELENTE),
      ],
      { title: 'Estado físico', description: 'Condição física inicial do equipamento.' },
    ),
    valorAquisicao: Type.Optional(
      Type.Union([Type.Number({ minimum: 0 }), Type.String({ minLength: 1 }), Type.Null()], {
        title: 'Valor de aquisição',
        description: 'Valor original do bem em reais (opcional).',
      }),
    ),
    codigoBarrasInterno: Type.Optional(
      Type.String({
        minLength: 3,
        maxLength: 50,
        title: 'Código de barras interno',
        description: 'Código opcional no formato GC-XXXXXX; gerado automaticamente se omitido.',
      }),
    ),
  },
  {
    additionalProperties: false,
    title: 'EquipamentoPublicoBody',
    description: 'Equipamento pertencente a um lote submetido por parceiro.',
  },
);

const SubmeterLotePublicoBodySchema = Type.Object(
  {
    organizacaoId: Type.String({ format: 'uuid', title: 'ID da organização', description: 'UUID da organização cliente.' }),
    notaFiscal: Type.String({ minLength: 1, maxLength: 100, title: 'Nota fiscal', description: 'Número da nota fiscal.' }),
    transportadora: Type.String({ minLength: 1, maxLength: 200, title: 'Transportadora', description: 'Nome da transportadora.' }),
    dataEntrada: Type.String({
      minLength: 10,
      title: 'Data de entrada',
      description: 'Data de entrada do lote (YYYY-MM-DD, respeitando janela de 0 a 90 dias).',
    }),
    equipamentos: Type.Array(EquipamentoPublicoBodySchema, {
      title: 'Equipamentos',
      description: 'Lista de equipamentos do lote.',
    }),
  },
  {
    additionalProperties: false,
    title: 'SubmeterLotePublicoBody',
    description: 'Payload para criação de lote via API Pública.',
  },
);

const LotePublicoCriadoResponseSchema = Type.Object(
  {
    loteId: Type.String({ format: 'uuid', title: 'ID do lote', description: 'UUID do lote criado.' }),
    equipamentosCriados: Type.Array(
      Type.Object({
        id: Type.String({ format: 'uuid', title: 'ID', description: 'UUID do equipamento.' }),
        codigoBarrasInterno: Type.String({ title: 'Código de barras', description: 'Etiqueta interna gerada.' }),
        tipo: Type.String({ title: 'Tipo', description: 'Tipo do equipamento.' }),
        status: Type.String({ title: 'Status', description: 'Status inicial (RECEBIDO).' }),
      }),
      { title: 'Equipamentos criados', description: 'Resumo dos equipamentos persistidos.' },
    ),
  },
  {
    title: 'LotePublicoCriadoResponse',
    description: 'Resposta da submissão de lote por parceiro externo.',
  },
);

const SubmeterJobPublicoBodySchema = Type.Object(
  {
    tipo: Type.Union(
      [
        Type.Literal(TipoJobRelatorio.EFICIENCIA),
        Type.Literal(TipoJobRelatorio.RENTABILIDADE),
        Type.Literal(TipoJobRelatorio.VIDA_UTIL),
      ],
      { title: 'Tipo do relatório', description: 'EFICIENCIA, RENTABILIDADE ou VIDA_UTIL.' },
    ),
    parametros: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        title: 'Parâmetros',
        description: 'Filtros opcionais para o relatório.',
      }),
    ),
  },
  {
    additionalProperties: false,
    title: 'SubmeterJobPublicoBody',
    description: 'Solicitação de relatório analítico assíncrono via API Pública.',
  },
);

const JobPublicoParamsSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid', title: 'ID do job', description: 'UUID do job assíncrono.' }),
  },
  {
    title: 'JobPublicoParams',
    description: 'Parâmetro de rota contendo o UUID do job.',
  },
);

const JobSubmetidoPublicoResponseSchema = Type.Object(
  {
    jobId: Type.String({ format: 'uuid', title: 'ID do job', description: 'UUID para consulta de status.' }),
    status: Type.String({ title: 'Status', description: 'Status inicial (PENDENTE).' }),
  },
  {
    title: 'JobSubmetidoPublicoResponse',
    description: 'Confirmação de enfileiramento de relatório.',
  },
);

const StatusJobPublicoResponseSchema = Type.Object(
  {
    jobId: Type.String({ format: 'uuid', title: 'ID do job', description: 'UUID do job.' }),
    tipo: Type.String({ title: 'Tipo', description: 'Tipo do relatório.' }),
    status: Type.String({ title: 'Status', description: 'PENDENTE, PROCESSANDO, CONCLUIDO ou ERRO.' }),
    progresso: Type.Integer({ title: 'Progresso', description: 'Progresso percentual (0 a 100).' }),
    tentativas: Type.Integer({ title: 'Tentativas', description: 'Quantidade de tentativas.' }),
    erro: Type.Union([Type.String(), Type.Null()], { title: 'Erro', description: 'Descrição do erro ou null.' }),
    criadoEm: Type.String({ format: 'date-time', title: 'Criado em', description: 'Data/hora de criação.' }),
    concluidoEm: Type.Union([Type.String({ format: 'date-time' }), Type.Null()], {
      title: 'Concluído em',
      description: 'Data/hora de conclusão ou null.',
    }),
  },
  {
    title: 'StatusJobPublicoResponse',
    description: 'Status atual de um job solicitado via API Pública.',
  },
);

/**
 * Registra o subconjunto isolado da API Pública (`/api/v1/public/*`).
 * Autenticado por `X-Api-Key` (sem JWT) com rate limit de 100 req/min por chave.
 */
export function registrarRotasPublicas(
  app: FastifyInstance,
  publicService: PublicService,
  parceiroRepo: ParceiroRepository,
): void {
  const servidor = app.withTypeProvider<TypeBoxTypeProvider>();

  // Autenticação por X-Api-Key aplicada a todas as rotas deste plugin encapsulado
  registrarAutenticacaoApiKey(servidor, parceiroRepo);

  const configRateLimitPorChave = criarConfigRateLimitApiKey();

  servidor.get(
    '/rastreabilidade/:codigoBarras',
    {
      config: configRateLimitPorChave,
      preHandler: [exigirPermissaoParceiro(PermissaoParceiro.LEITURA_RASTREABILIDADE)],
      schema: {
        tags: ['API Pública'],
        security: [{ apiKeyAuth: [] }],
        summary: 'Consulta status e última movimentação de um equipamento por código de barras',
        description: 'Requer header X-Api-Key com permissão LEITURA_RASTREABILIDADE.',
        params: RastreabilidadeParamsSchema,
        response: {
          200: RastreabilidadePublicaResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parceiro = obterParceiroRequisicao(request);
      const dados = await publicService.consultarRastreabilidade(
        parceiro,
        request.params.codigoBarras,
      );
      return reply.status(200).send(dados);
    },
  );

  servidor.get(
    '/lotes',
    {
      config: configRateLimitPorChave,
      preHandler: [exigirPermissaoParceiro(PermissaoParceiro.LEITURA_LOTES)],
      schema: {
        tags: ['API Pública'],
        security: [{ apiKeyAuth: [] }],
        summary: 'Lista lotes da organização parceira com paginação',
        description: 'Requer header X-Api-Key com permissão LEITURA_LOTES.',
        querystring: ListarLotesPublicoQuerySchema,
        response: {
          200: ListarLotesPublicoResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parceiro = obterParceiroRequisicao(request);
      const dados = await publicService.listarLotes(parceiro, {
        page: request.query.page,
        limit: request.query.limit,
        organizacaoId: request.query.organizacaoId,
      });
      return reply.status(200).send(dados);
    },
  );

  servidor.post(
    '/lotes',
    {
      config: configRateLimitPorChave,
      preHandler: [exigirPermissaoParceiro(PermissaoParceiro.ESCRITA_LOTES)],
      schema: {
        tags: ['API Pública'],
        security: [{ apiKeyAuth: [] }],
        summary: 'Submete um novo lote com equipamentos via API Pública',
        description: 'Requer header X-Api-Key com permissão ESCRITA_LOTES.',
        body: SubmeterLotePublicoBodySchema,
        response: {
          201: LotePublicoCriadoResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parceiro = obterParceiroRequisicao(request);
      const criado = await publicService.submeterLote(parceiro, {
        organizacaoId: request.body.organizacaoId,
        notaFiscal: request.body.notaFiscal,
        transportadora: request.body.transportadora,
        dataEntrada: request.body.dataEntrada,
        equipamentos: request.body.equipamentos,
      });
      return reply.status(201).send(criado);
    },
  );

  servidor.get(
    '/relatorios/eficiencia',
    {
      config: configRateLimitPorChave,
      preHandler: [exigirPermissaoParceiro(PermissaoParceiro.LEITURA_RASTREABILIDADE)],
      schema: {
        tags: ['API Pública'],
        security: [{ apiKeyAuth: [] }],
        summary: 'Solicita relatório assíncrono de eficiência operacional',
        description: 'Enfileira o relatório na fila BullMQ e retorna jobId para polling em /api/v1/public/jobs/:id/status.',
        response: {
          202: JobSubmetidoPublicoResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parceiro = obterParceiroRequisicao(request);
      const resp = await publicService.solicitarRelatorioEficiencia(parceiro);
      return reply.status(202).send(resp);
    },
  );

  servidor.post(
    '/jobs/relatorio',
    {
      config: configRateLimitPorChave,
      preHandler: [exigirPermissaoParceiro(PermissaoParceiro.LEITURA_RASTREABILIDADE)],
      schema: {
        tags: ['API Pública'],
        security: [{ apiKeyAuth: [] }],
        summary: 'Submete job assíncrono de relatório analítico (EFICIENCIA, RENTABILIDADE ou VIDA_UTIL)',
        description: 'Requer header X-Api-Key com permissão LEITURA_RASTREABILIDADE.',
        body: SubmeterJobPublicoBodySchema,
        response: {
          202: JobSubmetidoPublicoResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parceiro = obterParceiroRequisicao(request);
      const resp = await publicService.solicitarRelatorio(
        parceiro,
        request.body.tipo,
        request.body.parametros ?? null,
      );
      return reply.status(202).send(resp);
    },
  );

  servidor.get(
    '/jobs/:id/status',
    {
      config: configRateLimitPorChave,
      preHandler: [exigirPermissaoParceiro(PermissaoParceiro.LEITURA_RASTREABILIDADE)],
      schema: {
        tags: ['API Pública'],
        security: [{ apiKeyAuth: [] }],
        summary: 'Consulta o status de um job assíncrono de relatório',
        description: 'Retorna status (PENDENTE, PROCESSANDO, CONCLUIDO, ERRO), progresso e datas.',
        params: JobPublicoParamsSchema,
        response: {
          200: StatusJobPublicoResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parceiro = obterParceiroRequisicao(request);
      const status = await publicService.consultarStatusJob(parceiro, request.params.id);
      return reply.status(200).send(status);
    },
  );

  servidor.get(
    '/jobs/:id/resultado',
    {
      config: configRateLimitPorChave,
      preHandler: [exigirPermissaoParceiro(PermissaoParceiro.LEITURA_RASTREABILIDADE)],
      schema: {
        tags: ['API Pública'],
        security: [{ apiKeyAuth: [] }],
        summary: 'Obtém o resultado de um job concluído (JSON ou CSV) ou 202 se ainda em processamento',
        description: 'Padrão polling: retorna 200 quando CONCLUIDO (aceita ?formato=json ou ?formato=csv) e 202 enquanto PENDENTE/PROCESSANDO.',
        params: JobPublicoParamsSchema,
        querystring: Type.Object(
          {
            formato: Type.Optional(
              Type.Union([Type.Literal('json'), Type.Literal('csv')], {
                default: 'json',
                title: 'Formato',
                description: 'Formato de exportação do relatório (json ou csv).',
              }),
            ),
          },
          {
            title: 'ResultadoJobPublicoQuery',
            description: 'Formato opcional de download do relatório.',
          },
        ),
        response: {
          200: Type.Unknown({
            title: 'ResultadoJobPublicoConcluido',
            description: 'Payload JSON ou CSV do relatório concluído.',
          }),
          202: Type.Object(
            {
              mensagem: Type.String({ title: 'Mensagem', description: 'Aviso de processamento pendente.' }),
            },
            { title: 'JobEmProcessamentoResponse', description: 'Resposta 202 quando o relatório não concluiu.' },
          ),
        },
      },
    },
    async (request, reply) => {
      const parceiro = obterParceiroRequisicao(request);
      const dados = await publicService.obterResultadoJob(parceiro, request.params.id);
      if (!dados.concluido) {
        return reply.status(202).send({ mensagem: 'Relatório ainda em processamento' });
      }
      if (request.query.formato === 'csv') {
        const csv = converterParaCsv(dados.resultado);
        return reply
          .status(200)
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="relatorio-${request.params.id}.csv"`)
          .send(csv);
      }
      return reply.status(200).send(dados.resultado);
    },
  );
}
