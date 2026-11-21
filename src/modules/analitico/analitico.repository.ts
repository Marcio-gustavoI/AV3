import type { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from 'decimal.js';
import {
  ClassificacaoDestino,
  type EstadoFisico,
  StatusEquipamento,
  type TipoEquipamento,
} from '../../domain/index.js';

/** Tipos de análise persistidos em `resultados_analiticos` (CHECK na migração AV3). */
export const TipoAnalise = {
  EFICIENCIA_OPERACIONAL: 'EFICIENCIA_OPERACIONAL',
  RENTABILIDADE: 'RENTABILIDADE',
  VIDA_UTIL: 'VIDA_UTIL',
} as const;
export type TipoAnalise = (typeof TipoAnalise)[keyof typeof TipoAnalise];

/** Uma triagem concluída: equipamento que recebeu Movimentacao com statusNovo=TRIADO. */
export interface RegistroTriagem {
  loteId: string;
  dataEntradaLote: Date;
  equipamentoId: string;
  triadoEm: Date;
  usuarioId: string;
  usuarioEmail: string;
}

export interface EquipamentoReutilizado {
  tipo: TipoEquipamento;
  estadoFisico: EstadoFisico;
  valorAquisicao: string | null;
}

export interface AmostraVidaUtil {
  tipo: TipoEquipamento;
  estadoFisico: EstadoFisico;
  criadoEm: Date;
}

export interface FiltroPeriodoAnalise {
  dataInicio?: Date | undefined;
  dataFim?: Date | undefined;
}

export interface ResultadoAnaliticoEntidade {
  id: string;
  tipo: string;
  parametros: Record<string, unknown> | null;
  resultado: unknown;
  geradoEm: Date;
}

export interface SalvarResultadoInput {
  tipo: TipoAnalise;
  parametros: Record<string, unknown> | null;
  resultado: unknown;
}

/**
 * AnaliticoRepository (AV3, Pilar 1): leitura agregável das tabelas operacionais
 * e persistência do histórico de resultados. O service não conhece o Prisma.
 */
export interface AnaliticoRepository {
  listarTriagensConcluidas(filtro: FiltroPeriodoAnalise): Promise<RegistroTriagem[]>;
  listarEquipamentosReutilizados(): Promise<EquipamentoReutilizado[]>;
  listarAmostrasVidaUtil(): Promise<AmostraVidaUtil[]>;
  salvarResultado(dados: SalvarResultadoInput): Promise<ResultadoAnaliticoEntidade>;
  listarHistorico(limite: number, tipo?: TipoAnalise | undefined): Promise<ResultadoAnaliticoEntidade[]>;
}

function paraObjetoOuNulo(valor: Prisma.JsonValue | null): Record<string, unknown> | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

export class PrismaAnaliticoRepository implements AnaliticoRepository {
  constructor(private readonly prismaClient: PrismaClient) {}

  async listarTriagensConcluidas(filtro: FiltroPeriodoAnalise): Promise<RegistroTriagem[]> {
    const filtroData: Prisma.DateTimeFilter = {};
    if (filtro.dataInicio) filtroData.gte = filtro.dataInicio;
    if (filtro.dataFim) filtroData.lte = filtro.dataFim;

    // Uma única consulta com JOIN via `select` aninhado (sem N+1, A2-11).
    const linhas = await this.prismaClient.movimentacao.findMany({
      where: {
        statusNovo: StatusEquipamento.TRIADO,
        ...(filtro.dataInicio || filtro.dataFim
          ? { equipamento: { lote: { dataEntrada: filtroData } } }
          : {}),
      },
      select: {
        equipamentoId: true,
        criadoEm: true,
        usuarioId: true,
        usuario: { select: { email: true } },
        equipamento: { select: { lote: { select: { id: true, dataEntrada: true } } } },
      },
      orderBy: { criadoEm: 'asc' },
    });

    return linhas.map((l) => ({
      loteId: l.equipamento.lote.id,
      dataEntradaLote: l.equipamento.lote.dataEntrada,
      equipamentoId: l.equipamentoId,
      triadoEm: l.criadoEm,
      usuarioId: l.usuarioId,
      usuarioEmail: l.usuario.email,
    }));
  }

  async listarEquipamentosReutilizados(): Promise<EquipamentoReutilizado[]> {
    const linhas = await this.prismaClient.equipamento.findMany({
      where: {
        status: StatusEquipamento.DESTINADO,
        classificacaoDestino: ClassificacaoDestino.REUTILIZACAO,
      },
      select: { tipo: true, estadoFisico: true, valorAquisicao: true },
    });
    return linhas.map((l) => ({
      tipo: l.tipo,
      estadoFisico: l.estadoFisico,
      valorAquisicao:
        l.valorAquisicao !== null ? new Decimal(l.valorAquisicao.toString()).toFixed(2) : null,
    }));
  }

  async listarAmostrasVidaUtil(): Promise<AmostraVidaUtil[]> {
    return this.prismaClient.equipamento.findMany({
      select: { tipo: true, estadoFisico: true, criadoEm: true },
    });
  }

  async salvarResultado(dados: SalvarResultadoInput): Promise<ResultadoAnaliticoEntidade> {
    const criado = await this.prismaClient.resultadoAnalitico.create({
      data: {
        tipo: dados.tipo,
        ...(dados.parametros !== null
          ? { parametros: dados.parametros as Prisma.InputJsonValue }
          : {}),
        resultado: dados.resultado as Prisma.InputJsonValue,
      },
    });
    return {
      id: criado.id,
      tipo: criado.tipo,
      parametros: paraObjetoOuNulo(criado.parametros),
      resultado: criado.resultado,
      geradoEm: criado.geradoEm,
    };
  }

  async listarHistorico(
    limite: number,
    tipo?: TipoAnalise | undefined,
  ): Promise<ResultadoAnaliticoEntidade[]> {
    const linhas = await this.prismaClient.resultadoAnalitico.findMany({
      where: tipo ? { tipo } : {},
      orderBy: { geradoEm: 'desc' },
      take: limite,
    });
    return linhas.map((l) => ({
      id: l.id,
      tipo: l.tipo,
      parametros: paraObjetoOuNulo(l.parametros),
      resultado: l.resultado,
      geradoEm: l.geradoEm,
    }));
  }
}

/** Implementação em memória para testes unitários. */
export class MemoriaAnaliticoRepository implements AnaliticoRepository {
  public triagens: RegistroTriagem[] = [];
  public reutilizados: EquipamentoReutilizado[] = [];
  public amostras: AmostraVidaUtil[] = [];
  public readonly resultados: ResultadoAnaliticoEntidade[] = [];

  async listarTriagensConcluidas(filtro: FiltroPeriodoAnalise): Promise<RegistroTriagem[]> {
    return this.triagens.filter(
      (t) =>
        (!filtro.dataInicio || t.dataEntradaLote >= filtro.dataInicio) &&
        (!filtro.dataFim || t.dataEntradaLote <= filtro.dataFim),
    );
  }

  async listarEquipamentosReutilizados(): Promise<EquipamentoReutilizado[]> {
    return [...this.reutilizados];
  }

  async listarAmostrasVidaUtil(): Promise<AmostraVidaUtil[]> {
    return [...this.amostras];
  }

  async salvarResultado(dados: SalvarResultadoInput): Promise<ResultadoAnaliticoEntidade> {
    const novo: ResultadoAnaliticoEntidade = {
      id: crypto.randomUUID(),
      tipo: dados.tipo,
      parametros: dados.parametros,
      resultado: dados.resultado,
      geradoEm: new Date(),
    };
    this.resultados.push(novo);
    return novo;
  }

  async listarHistorico(
    limite: number,
    tipo?: TipoAnalise | undefined,
  ): Promise<ResultadoAnaliticoEntidade[]> {
    return this.resultados
      .filter((r) => !tipo || r.tipo === tipo)
      .sort((a, b) => b.geradoEm.getTime() - a.geradoEm.getTime())
      .slice(0, limite);
  }
}
