import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { TipoAnalise } from './analitico.repository.js';
import type { AnaliticoService } from './analitico.service.js';

const FiltroEficienciaQuerySchema = Type.Object(
  {
    dataInicio: Type.Optional(
      Type.String({
        title: 'Data de início',
        description: 'Filtro opcional de data inicial de entrada do lote (YYYY-MM-DD ou ISO 8601).',
      }),
    ),
    dataFim: Type.Optional(
      Type.String({
        title: 'Data de fim',
        description: 'Filtro opcional de data final de entrada do lote (YYYY-MM-DD ou ISO 8601).',
      }),
    ),
  },
  {
    title: 'FiltroEficienciaQuery',
    description: 'Parâmetros de período para cálculo de eficiência operacional.',
  },
);

const EficienciaResponseSchema = Type.Object(
  {
    dados: Type.Object(
      {
        mediaHoras: Type.Number({ title: 'Média em horas', description: 'Tempo médio entre entrada do lote e conclusão da triagem.' }),
        medianaHoras: Type.Number({ title: 'Mediana em horas', description: 'Mediana do tempo de triagem dos lotes.' }),
        desvioPadrao: Type.Number({ title: 'Desvio padrão', description: 'Desvio padrão populacional em horas.' }),
        totalLotes: Type.Integer({ title: 'Total de lotes', description: 'Quantidade de lotes considerados na amostra.' }),
        porOperador: Type.Array(
          Type.Object({
            usuarioId: Type.String({ format: 'uuid', title: 'ID do operador', description: 'Identificador do usuário responsável pela triagem.' }),
            nome: Type.String({ title: 'Operador', description: 'E-mail/identificação do operador.' }),
            mediaHoras: Type.Number({ title: 'Média do operador (h)', description: 'Tempo médio de triagem deste operador.' }),
          }),
          { title: 'Eficiência por operador', description: 'Média de horas agrupada por operador.' },
        ),
        porMes: Type.Array(
          Type.Object({
            mes: Type.String({ title: 'Mês', description: 'Mês no formato YYYY-MM.' }),
            mediaHoras: Type.Number({ title: 'Média no mês (h)', description: 'Tempo médio dos lotes recebidos no mês.' }),
          }),
          { title: 'Eficiência por mês', description: 'Evolução mensal do tempo médio de processamento.' },
        ),
      },
      { title: 'DadosEficiencia', description: 'Indicadores estatísticos de eficiência operacional.' },
    ),
    geradoEm: Type.String({ format: 'date-time', title: 'Gerado em', description: 'Timestamp ISO da geração e persistência.' }),
  },
  {
    title: 'EficienciaOperacionalResponse',
    description: 'Resposta da análise de eficiência operacional.',
  },
);

const RentabilidadeResponseSchema = Type.Object(
  {
    dados: Type.Record(
      Type.String(),
      Type.Record(
        Type.String(),
        Type.Object({
          valorMedioEstimado: Type.Number({ title: 'Valor médio estimado', description: 'Valor médio de recuperação estimado em reais.' }),
          quantidade: Type.Integer({ title: 'Quantidade', description: 'Quantidade de equipamentos no grupo.' }),
        }),
      ),
      { title: 'MapaRentabilidade', description: 'Valor médio estimado agrupado por TipoEquipamento e EstadoFisico.' },
    ),
    geradoEm: Type.String({ format: 'date-time', title: 'Gerado em', description: 'Timestamp ISO da geração e persistência.' }),
  },
  {
    title: 'RentabilidadeResponse',
    description: 'Resposta da análise de rentabilidade por tipo e estado físico.',
  },
);

const VidaUtilResponseSchema = Type.Object(
  {
    dados: Type.Record(
      Type.String(),
      Type.Object({
        amostras: Type.Integer({ title: 'Amostras', description: 'Quantidade de equipamentos usados na regressão (>= 5).' }),
        coeficienteAngular: Type.Number({ title: 'Coeficiente angular (m)', description: 'Inclinação da reta de degradação por dia.' }),
        intercepto: Type.Number({ title: 'Intercepto (b)', description: 'Estado físico inicial estimado (x = 0).' }),
        valorPrevistoAtual: Type.Number({ title: 'Valor previsto atual', description: 'Índice de estado físico previsto na idade média da amostra.' }),
        diasMediosAteInservivel: Type.Union([Type.Number(), Type.Null()], {
          title: 'Dias médios até inservível',
          description: 'Projeção de dias totais até atingir SUCATA (y = 0) quando m < 0.',
        }),
        dataPrevistaInservivel: Type.Union([Type.String({ format: 'date-time' }), Type.Null()], {
          title: 'Data prevista inservível',
          description: 'Data ISO projetada para atingir estado SUCATA ou null se não houver tendência decrescente.',
        }),
      }),
      { title: 'MapaVidaUtil', description: 'Regressão linear de vida útil por TipoEquipamento.' },
    ),
    geradoEm: Type.String({ format: 'date-time', title: 'Gerado em', description: 'Timestamp ISO da geração e persistência.' }),
  },
  {
    title: 'VidaUtilResponse',
    description: 'Resposta da análise preditiva de vida útil remanescente.',
  },
);

const HistoricoQuerySchema = Type.Object(
  {
    limite: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        default: 50,
        title: 'Limite',
        description: 'Quantidade máxima de resultados históricos retornados (padrão 50).',
      }),
    ),
    tipo: Type.Optional(
      Type.Union(
        [
          Type.Literal(TipoAnalise.EFICIENCIA_OPERACIONAL),
          Type.Literal(TipoAnalise.RENTABILIDADE),
          Type.Literal(TipoAnalise.VIDA_UTIL),
        ],
        { title: 'Tipo de análise', description: 'Filtra histórico por tipo de análise.' },
      ),
    ),
  },
  {
    title: 'HistoricoAnaliticoQuery',
    description: 'Filtros para listagem do histórico analítico.',
  },
);

const HistoricoResponseSchema = Type.Object(
  {
    resultados: Type.Array(
      Type.Object({
        id: Type.String({ format: 'uuid', title: 'ID', description: 'Identificador do resultado persistido.' }),
        tipo: Type.String({ title: 'Tipo', description: 'Tipo da análise executada.' }),
        parametros: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()], {
          title: 'Parâmetros',
          description: 'Filtros utilizados na execução.',
        }),
        resultado: Type.Unknown({ title: 'Resultado', description: 'Payload JSON calculado pela análise.' }),
        geradoEm: Type.String({ format: 'date-time', title: 'Gerado em', description: 'Data/hora da geração.' }),
      }),
      { title: 'Resultados', description: 'Lista dos últimos resultados analíticos persistidos.' },
    ),
  },
  {
    title: 'HistoricoAnaliticoResponse',
    description: 'Histórico de execuções analíticas persistidas no PostgreSQL.',
  },
);

/**
 * Rotas internas da Camada Analítica (AV3, Pilar 1).
 * Autenticadas via JWT (qualquer papel autenticado).
 */
export function registrarRotasAnalitico(
  app: FastifyInstance,
  analiticoService: AnaliticoService,
): void {
  const servidor = app.withTypeProvider<TypeBoxTypeProvider>();

  servidor.get(
    '/analitico/eficiencia',
    {
      schema: {
        tags: ['Analítico'],
        summary: 'Calcula e persiste eficiência operacional de triagem de lotes',
        description:
          'Calcula média, mediana e desvio padrão (horas) entre entrada do lote e triagem concluída, agrupando por operador e mês.',
        querystring: FiltroEficienciaQuerySchema,
        response: {
          200: EficienciaResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const resultado = await analiticoService.calcularEficienciaOperacional({
        dataInicio: request.query.dataInicio,
        dataFim: request.query.dataFim,
      });
      return reply.status(200).send(resultado);
    },
  );

  servidor.get(
    '/analitico/rentabilidade',
    {
      schema: {
        tags: ['Analítico'],
        summary: 'Calcula e persiste rentabilidade estimada por tipo de equipamento e estado físico',
        description:
          'Considera equipamentos DESTINADOS para REUTILIZACAO aplicando COEF_DEPRECIACAO_<TIPO> e fator de estado físico com precisão Decimal.',
        response: {
          200: RentabilidadeResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const resultado = await analiticoService.calcularRentabilidadePorTipo();
      return reply.status(200).send(resultado);
    },
  );

  servidor.get(
    '/analitico/vida-util',
    {
      schema: {
        tags: ['Analítico'],
        summary: 'Projeta vida útil remanescente via regressão linear simples (mínimos quadrados)',
        description:
          'Para cada tipo com ao menos 5 equipamentos, ajusta y = m*x + b (dias de uso vs índice de estado físico) e projeta quando atingirá SUCATA (y = 0).',
        response: {
          200: VidaUtilResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const resultado = await analiticoService.calcularVidaUtil();
      return reply.status(200).send(resultado);
    },
  );

  servidor.get(
    '/analitico/historico',
    {
      schema: {
        tags: ['Analítico'],
        summary: 'Retorna os últimos resultados analíticos persistidos no banco',
        description: 'Permite comparação temporal das análises de eficiência, rentabilidade e vida útil.',
        querystring: HistoricoQuerySchema,
        response: {
          200: HistoricoResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const itens = await analiticoService.listarHistorico(
        request.query.limite ?? 50,
        request.query.tipo,
      );
      return reply.status(200).send({
        resultados: itens.map((item) => ({
          id: item.id,
          tipo: item.tipo,
          parametros: item.parametros,
          resultado: item.resultado,
          geradoEm: item.geradoEm.toISOString(),
        })),
      });
    },
  );
}
