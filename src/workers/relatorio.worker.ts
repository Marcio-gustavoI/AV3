import { type Job, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { obterOpcoesConexaoRedis } from '../lib/redis.js';
import type { AnaliticoService, FiltroPeriodoString } from '../modules/analitico/analitico.service.js';
import {
  type JobRepository,
  StatusJobRelatorio,
  TipoJobRelatorio,
} from '../modules/job/job.repository.js';
import type { PayloadFilaRelatorio } from '../modules/job/job.service.js';

export const NOME_FILA_RELATORIO = 'relatorio';

export interface DependenciasWorkerRelatorio {
  jobRepo: JobRepository;
  analiticoService: AnaliticoService;
}

function extrairFiltroPeriodo(
  parametros?: Record<string, unknown> | null,
): FiltroPeriodoString | undefined {
  if (!parametros) return undefined;
  const dataInicio = typeof parametros['dataInicio'] === 'string' ? parametros['dataInicio'] : undefined;
  const dataFim = typeof parametros['dataFim'] === 'string' ? parametros['dataFim'] : undefined;
  if (!dataInicio && !dataFim) return undefined;
  return { dataInicio, dataFim };
}

/**
 * Processa um único job de relatório analítico:
 * - Atualiza status para PROCESSANDO (progresso 25%).
 * - Executa o cálculo correspondente no AnaliticoService.
 * - Salva o resultado e marca como CONCLUIDO (100%) com concluidoEm.
 * - Em caso de erro, registra status=ERRO, mensagem e incrementa tentativas,
 *   relançando o erro para que o BullMQ aplique o retry exponencial (1s, 2s, 4s).
 */
export async function processarJobRelatorio(
  payload: PayloadFilaRelatorio,
  deps: DependenciasWorkerRelatorio,
): Promise<unknown> {
  const { jobId, tipo, parametros } = payload;

  await deps.jobRepo.atualizar(jobId, {
    status: StatusJobRelatorio.PROCESSANDO,
    progresso: 25,
    erro: null,
  });

  try {
    let resultado: unknown;
    switch (tipo) {
      case TipoJobRelatorio.EFICIENCIA:
        resultado = await deps.analiticoService.calcularEficienciaOperacional(
          extrairFiltroPeriodo(parametros),
        );
        break;
      case TipoJobRelatorio.RENTABILIDADE:
        resultado = await deps.analiticoService.calcularRentabilidadePorTipo();
        break;
      case TipoJobRelatorio.VIDA_UTIL:
        resultado = await deps.analiticoService.calcularVidaUtil();
        break;
    }

    await deps.jobRepo.atualizar(jobId, {
      status: StatusJobRelatorio.CONCLUIDO,
      progresso: 100,
      resultado,
      erro: null,
      concluidoEm: new Date(),
    });

    return resultado;
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido ao processar relatório.';
    await deps.jobRepo.atualizar(jobId, {
      status: StatusJobRelatorio.ERRO,
      erro: mensagem,
      incrementarTentativas: true,
    });
    throw err;
  }
}

/**
 * Inicia o consumidor BullMQ da fila `relatorio` (AV3, Pilar 3).
 */
export function iniciarWorkerRelatorio(
  deps: DependenciasWorkerRelatorio,
): Worker<PayloadFilaRelatorio> {
  const worker = new Worker<PayloadFilaRelatorio>(
    NOME_FILA_RELATORIO,
    async (job: Job<PayloadFilaRelatorio>) => {
      logger.info({ jobId: job.data.jobId, tipo: job.data.tipo }, 'Iniciando processamento de job analítico');
      const resultado = await processarJobRelatorio(job.data, deps);
      logger.info({ jobId: job.data.jobId, tipo: job.data.tipo }, 'Job analítico concluído com sucesso');
      return resultado;
    },
    {
      connection: obterOpcoesConexaoRedis(),
      concurrency: env.WORKER_CONCORRENCIA,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.data?.jobId, tentativasFeitas: job?.attemptsMade, err },
      'Falha na execução do job analítico (BullMQ aplicará retry se houver tentativas restantes)',
    );
  });

  return worker;
}
