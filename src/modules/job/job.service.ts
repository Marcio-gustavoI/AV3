import type { Queue } from 'bullmq';
import { ErroNaoEncontrado, ErroRegraDeNegocio } from '../../domain/index.js';
import {
  type EntidadeJobRelatorio,
  type JobRepository,
  StatusJobRelatorio,
  TIPOS_JOB_VALIDOS,
  type TipoJobRelatorio,
} from './job.repository.js';

export interface PayloadFilaRelatorio {
  jobId: string;
  tipo: TipoJobRelatorio;
  parametros?: Record<string, unknown> | null | undefined;
}

/**
 * Abstração do publicador de fila (permite testar JobService sem Redis/BullMQ real).
 */
export interface PublicadorFilaRelatorio {
  publicar(payload: PayloadFilaRelatorio): Promise<void>;
}

/** Implementação concreta usando BullMQ Queue com retry exponencial (1s, 2s, 4s). */
export class PublicadorFilaBullMQ implements PublicadorFilaRelatorio {
  constructor(private readonly fila: Queue) {}

  async publicar(payload: PayloadFilaRelatorio): Promise<void> {
    await this.fila.add(payload.tipo, payload, {
      jobId: payload.jobId,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });
  }
}

export interface JobSubmetidoResposta {
  jobId: string;
  status: string;
}

export interface StatusJobResposta {
  jobId: string;
  tipo: string;
  status: string;
  progresso: number;
  tentativas: number;
  erro: string | null;
  criadoEm: string;
  concluidoEm: string | null;
}

/**
 * JobService (AV3, Pilar 3):
 * - Independente de Fastify e Prisma.
 * - Persiste `JobRelatorio` no PostgreSQL e enfileira no BullMQ.
 * - Suporta padrão polling (`submeterJob` -> `consultarStatus` -> `obterResultado`).
 */
export class JobService {
  constructor(
    private readonly jobRepo: JobRepository,
    private readonly filaPublicador: PublicadorFilaRelatorio,
  ) {}

  async submeterJob(
    tipo: string,
    parametros?: Record<string, unknown> | null,
    parceiroId?: string | null,
    usuarioId?: string | null,
  ): Promise<JobSubmetidoResposta> {
    const tipoNormalizado = tipo.trim().toUpperCase() as TipoJobRelatorio;
    if (!TIPOS_JOB_VALIDOS.includes(tipoNormalizado)) {
      throw new ErroRegraDeNegocio(
        `Tipo de relatório inválido: "${tipo}". Permitidos: ${TIPOS_JOB_VALIDOS.join(', ')}.`,
        'TIPO_JOB_INVALIDO',
      );
    }

    const job = await this.jobRepo.criar({
      tipo: tipoNormalizado,
      parceiroId: parceiroId ?? null,
      usuarioId: usuarioId ?? null,
      parametros: parametros ?? null,
    });

    await this.filaPublicador.publicar({
      jobId: job.id,
      tipo: tipoNormalizado,
      parametros: job.parametros,
    });

    return {
      jobId: job.id,
      status: job.status,
    };
  }

  async consultarStatus(id: string): Promise<StatusJobResposta> {
    const job = await this.buscarObrigatorio(id);
    return {
      jobId: job.id,
      tipo: job.tipo,
      status: job.status,
      progresso: job.progresso,
      tentativas: job.tentativas,
      erro: job.erro,
      criadoEm: job.criadoEm.toISOString(),
      concluidoEm: job.concluidoEm ? job.concluidoEm.toISOString() : null,
    };
  }

  async obterResultado(id: string): Promise<{
    concluido: boolean;
    status: string;
    resultado: unknown;
    concluidoEm: string | null;
  }> {
    const job = await this.buscarObrigatorio(id);
    if (job.status !== StatusJobRelatorio.CONCLUIDO) {
      return {
        concluido: false,
        status: job.status,
        resultado: null,
        concluidoEm: null,
      };
    }

    return {
      concluido: true,
      status: job.status,
      resultado: job.resultado,
      concluidoEm: job.concluidoEm ? job.concluidoEm.toISOString() : null,
    };
  }

  private async buscarObrigatorio(id: string): Promise<EntidadeJobRelatorio> {
    const job = await this.jobRepo.buscarPorId(id);
    if (!job) {
      throw new ErroNaoEncontrado(`Job de relatório ${id} não encontrado.`);
    }
    return job;
  }
}
