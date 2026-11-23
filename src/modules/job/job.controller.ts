import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { converterParaCsv } from '../../lib/csv.js';
import { obterUsuarioRequisicao } from '../../plugins/auth.js';
import { TipoJobRelatorio } from './job.repository.js';
import type { JobService } from './job.service.js';

const JobParamsSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid', title: 'ID do job', description: 'UUID do job assíncrono.' }),
  },
  {
    title: 'JobParams',
    description: 'Parâmetro de rota contendo o UUID do job.',
  },
);

const SubmeterJobBodySchema = Type.Object(
  {
    tipo: Type.Union(
      [
        Type.Literal(TipoJobRelatorio.EFICIENCIA),
        Type.Literal(TipoJobRelatorio.RENTABILIDADE),
        Type.Literal(TipoJobRelatorio.VIDA_UTIL),
      ],
      {
        title: 'Tipo do relatório',
        description: 'Tipo de cálculo analítico a ser enfileirado (EFICIENCIA, RENTABILIDADE ou VIDA_UTIL).',
      },
    ),
    parametros: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        title: 'Parâmetros opcionais',
        description: 'Filtros opcionais encaminhados ao cálculo (ex.: dataInicio, dataFim).',
      }),
    ),
  },
  {
    additionalProperties: false,
    title: 'SubmeterJobBody',
    description: 'Solicitação de processamento assíncrono de relatório analítico.',
  },
);

const SubmeterJobResponseSchema = Type.Object(
  {
    jobId: Type.String({ format: 'uuid', title: 'ID do job', description: 'Identificador para polling.' }),
    status: Type.String({ title: 'Status inicial', description: 'Status inicial do job (PENDENTE).' }),
  },
  {
    title: 'SubmeterJobResponse',
    description: 'Confirmação de enfileiramento de job assíncrono.',
  },
);

const StatusJobResponseSchema = Type.Object(
  {
    jobId: Type.String({ format: 'uuid', title: 'ID do job', description: 'UUID do job.' }),
    tipo: Type.String({ title: 'Tipo', description: 'Tipo de relatório solicitado.' }),
    status: Type.String({ title: 'Status', description: 'PENDENTE, PROCESSANDO, CONCLUIDO ou ERRO.' }),
    progresso: Type.Integer({ minimum: 0, maximum: 100, title: 'Progresso (%)', description: 'Percentual de conclusão.' }),
    tentativas: Type.Integer({ minimum: 0, title: 'Tentativas', description: 'Número de tentativas executadas.' }),
    erro: Type.Union([Type.String(), Type.Null()], { title: 'Erro', description: 'Mensagem de erro em caso de falha.' }),
    criadoEm: Type.String({ format: 'date-time', title: 'Criado em', description: 'Data/hora de criação do job.' }),
    concluidoEm: Type.Union([Type.String({ format: 'date-time' }), Type.Null()], {
      title: 'Concluído em',
      description: 'Data/hora de conclusão ou null se pendente.',
    }),
  },
  {
    title: 'StatusJobResponse',
    description: 'Estado atual do processamento assíncrono.',
  },
);

const ResultadoJobQuerySchema = Type.Object(
  {
    formato: Type.Optional(
      Type.Union([Type.Literal('json'), Type.Literal('csv')], {
        default: 'json',
        title: 'Formato',
        description: 'Formato de retorno do relatório concluído (json ou csv).',
      }),
    ),
  },
  {
    title: 'ResultadoJobQuery',
    description: 'Parâmetro opcional de formato para download do resultado.',
  },
);

const ResultadoPendenteResponseSchema = Type.Object(
  {
    mensagem: Type.String({ title: 'Mensagem', description: 'Aviso de processamento em andamento.' }),
    status: Type.String({ title: 'Status atual', description: 'Status corrente do job.' }),
  },
  {
    title: 'ResultadoPendenteResponse',
    description: 'Resposta HTTP 202 quando o job ainda não foi concluído.',
  },
);

/**
 * Rotas internas de Jobs Assíncronos (AV3, Pilar 3 — autenticadas por JWT).
 */
export function registrarRotasJob(app: FastifyInstance, jobService: JobService): void {
  const servidor = app.withTypeProvider<TypeBoxTypeProvider>();

  servidor.post(
    '/jobs/relatorio',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Submete um job assíncrono de relatório analítico para a fila BullMQ',
        description: 'Persiste o job como PENDENTE e enfileira no Redis/BullMQ, retornando jobId para polling.',
        body: SubmeterJobBodySchema,
        response: {
          202: SubmeterJobResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ator = obterUsuarioRequisicao(request);
      const resposta = await jobService.submeterJob(
        request.body.tipo,
        request.body.parametros ?? null,
        null,
        ator.id,
      );
      return reply.status(202).send(resposta);
    },
  );

  servidor.get(
    '/jobs/:id/status',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Consulta o status e progresso de um job assíncrono',
        params: JobParamsSchema,
        response: {
          200: StatusJobResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const status = await jobService.consultarStatus(request.params.id);
      return reply.status(200).send(status);
    },
  );

  servidor.get(
    '/jobs/:id/resultado',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Obtém o resultado de um job assíncrono concluído (JSON ou CSV)',
        description: 'Retorna 200 com o resultado quando CONCLUIDO ou 202 caso ainda esteja em processamento.',
        params: JobParamsSchema,
        querystring: ResultadoJobQuerySchema,
        response: {
          200: Type.Unknown({
            title: 'ResultadoJobConcluido',
            description: 'Resultado do relatório analítico concluído (JSON ou texto CSV).',
          }),
          202: ResultadoPendenteResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const dados = await jobService.obterResultado(request.params.id);
      if (!dados.concluido) {
        return reply.status(202).send({
          mensagem: 'Relatório ainda em processamento',
          status: dados.status,
        });
      }

      if (request.query.formato === 'csv') {
        const csv = converterParaCsv(dados.resultado);
        return reply
          .status(200)
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="relatorio-${request.params.id}.csv"`)
          .send(csv);
      }

      return reply.status(200).send({
        jobId: request.params.id,
        status: dados.status,
        concluidoEm: dados.concluidoEm,
        resultado: dados.resultado,
      });
    },
  );
}
