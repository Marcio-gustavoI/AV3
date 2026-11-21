import type { Prisma, PrismaClient } from '@prisma/client';

export const TipoJobRelatorio = {
  EFICIENCIA: 'EFICIENCIA',
  RENTABILIDADE: 'RENTABILIDADE',
  VIDA_UTIL: 'VIDA_UTIL',
} as const;
export type TipoJobRelatorio = (typeof TipoJobRelatorio)[keyof typeof TipoJobRelatorio];

export const TIPOS_JOB_VALIDOS: readonly TipoJobRelatorio[] = [
  TipoJobRelatorio.EFICIENCIA,
  TipoJobRelatorio.RENTABILIDADE,
  TipoJobRelatorio.VIDA_UTIL,
];

export const StatusJobRelatorio = {
  PENDENTE: 'PENDENTE',
  PROCESSANDO: 'PROCESSANDO',
  CONCLUIDO: 'CONCLUIDO',
  ERRO: 'ERRO',
} as const;
export type StatusJobRelatorio = (typeof StatusJobRelatorio)[keyof typeof StatusJobRelatorio];

export interface EntidadeJobRelatorio {
  id: string;
  tipo: string;
  status: string;
  progresso: number;
  parceiroId: string | null;
  usuarioId: string | null;
  parametros: Record<string, unknown> | null;
  resultado: unknown;
  erro: string | null;
  tentativas: number;
  criadoEm: Date;
  concluidoEm: Date | null;
}

export interface CriarJobRepoInput {
  tipo: TipoJobRelatorio;
  parceiroId?: string | null | undefined;
  usuarioId?: string | null | undefined;
  parametros?: Record<string, unknown> | null | undefined;
}

export interface AtualizarJobRepoInput {
  status?: StatusJobRelatorio | undefined;
  progresso?: number | undefined;
  resultado?: unknown;
  erro?: string | null | undefined;
  incrementarTentativas?: boolean | undefined;
  concluidoEm?: Date | null | undefined;
}

export interface JobRepository {
  criar(dados: CriarJobRepoInput): Promise<EntidadeJobRelatorio>;
  buscarPorId(id: string): Promise<EntidadeJobRelatorio | null>;
  atualizar(id: string, dados: AtualizarJobRepoInput): Promise<EntidadeJobRelatorio>;
}

function paraObjetoOuNulo(valor: Prisma.JsonValue | null): Record<string, unknown> | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function mapearJobPrisma(row: {
  id: string;
  tipo: string;
  status: string;
  progresso: number;
  parceiroId: string | null;
  usuarioId: string | null;
  parametros: Prisma.JsonValue | null;
  resultado: Prisma.JsonValue | null;
  erro: string | null;
  tentativas: number;
  criadoEm: Date;
  concluidoEm: Date | null;
}): EntidadeJobRelatorio {
  return {
    id: row.id,
    tipo: row.tipo,
    status: row.status,
    progresso: row.progresso,
    parceiroId: row.parceiroId,
    usuarioId: row.usuarioId,
    parametros: paraObjetoOuNulo(row.parametros),
    resultado: row.resultado,
    erro: row.erro,
    tentativas: row.tentativas,
    criadoEm: row.criadoEm,
    concluidoEm: row.concluidoEm,
  };
}

export class PrismaJobRepository implements JobRepository {
  constructor(private readonly prismaClient: PrismaClient) {}

  async criar(dados: CriarJobRepoInput): Promise<EntidadeJobRelatorio> {
    const criado = await this.prismaClient.jobRelatorio.create({
      data: {
        tipo: dados.tipo,
        status: StatusJobRelatorio.PENDENTE,
        progresso: 0,
        parceiroId: dados.parceiroId ?? null,
        usuarioId: dados.usuarioId ?? null,
        ...(dados.parametros !== undefined && dados.parametros !== null
          ? { parametros: dados.parametros as Prisma.InputJsonValue }
          : {}),
      },
    });
    return mapearJobPrisma(criado);
  }

  async buscarPorId(id: string): Promise<EntidadeJobRelatorio | null> {
    const encontrado = await this.prismaClient.jobRelatorio.findUnique({ where: { id } });
    return encontrado ? mapearJobPrisma(encontrado) : null;
  }

  async atualizar(id: string, dados: AtualizarJobRepoInput): Promise<EntidadeJobRelatorio> {
    const atualizado = await this.prismaClient.jobRelatorio.update({
      where: { id },
      data: {
        ...(dados.status !== undefined ? { status: dados.status } : {}),
        ...(dados.progresso !== undefined ? { progresso: dados.progresso } : {}),
        ...(dados.resultado !== undefined
          ? { resultado: dados.resultado as Prisma.InputJsonValue }
          : {}),
        ...(dados.erro !== undefined ? { erro: dados.erro } : {}),
        ...(dados.incrementarTentativas ? { tentativas: { increment: 1 } } : {}),
        ...(dados.concluidoEm !== undefined ? { concluidoEm: dados.concluidoEm } : {}),
      },
    });
    return mapearJobPrisma(atualizado);
  }
}

/** Implementação em memória para testes unitários. */
export class MemoriaJobRepository implements JobRepository {
  public readonly itens = new Map<string, EntidadeJobRelatorio>();

  async criar(dados: CriarJobRepoInput): Promise<EntidadeJobRelatorio> {
    const novo: EntidadeJobRelatorio = {
      id: crypto.randomUUID(),
      tipo: dados.tipo,
      status: StatusJobRelatorio.PENDENTE,
      progresso: 0,
      parceiroId: dados.parceiroId ?? null,
      usuarioId: dados.usuarioId ?? null,
      parametros: dados.parametros ?? null,
      resultado: null,
      erro: null,
      tentativas: 0,
      criadoEm: new Date(),
      concluidoEm: null,
    };
    this.itens.set(novo.id, novo);
    return { ...novo };
  }

  async buscarPorId(id: string): Promise<EntidadeJobRelatorio | null> {
    const item = this.itens.get(id);
    return item ? { ...item } : null;
  }

  async atualizar(id: string, dados: AtualizarJobRepoInput): Promise<EntidadeJobRelatorio> {
    const atual = this.itens.get(id);
    if (!atual) {
      throw new Error(`Job ${id} não encontrado em memória.`);
    }
    const atualizado: EntidadeJobRelatorio = {
      ...atual,
      status: dados.status ?? atual.status,
      progresso: dados.progresso ?? atual.progresso,
      resultado: dados.resultado !== undefined ? dados.resultado : atual.resultado,
      erro: dados.erro !== undefined ? dados.erro : atual.erro,
      tentativas: dados.incrementarTentativas ? atual.tentativas + 1 : atual.tentativas,
      concluidoEm: dados.concluidoEm !== undefined ? dados.concluidoEm : atual.concluidoEm,
    };
    this.itens.set(id, atualizado);
    return { ...atualizado };
  }
}
