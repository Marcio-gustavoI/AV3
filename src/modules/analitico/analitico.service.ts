import { Decimal } from 'decimal.js';
import {
  linearRegression,
  linearRegressionLine,
  mean,
  median,
  standardDeviation,
} from 'simple-statistics';
import {
  ErroRegraDeNegocio,
  EstadoFisico,
  type Relogio,
  RelogioReal,
  TipoEquipamento,
  valorEstadoFisico,
} from '../../domain/index.js';
import type { ParametroRepository } from '../parametro/parametro.repository.js';
import {
  type AnaliticoRepository,
  type FiltroPeriodoAnalise,
  type ResultadoAnaliticoEntidade,
  TipoAnalise,
} from './analitico.repository.js';

const COEFICIENTES_PADRAO: Readonly<Record<TipoEquipamento, string>> = {
  [TipoEquipamento.DESKTOP]: '0.400000',
  [TipoEquipamento.NOTEBOOK]: '0.350000',
  [TipoEquipamento.MONITOR]: '0.450000',
  [TipoEquipamento.SERVIDOR]: '0.250000',
  [TipoEquipamento.PERIFERICO]: '0.600000',
  [TipoEquipamento.REDE]: '0.300000',
  [TipoEquipamento.OUTRO]: '0.500000',
};

const FATOR_ESTADO_FISICO: Readonly<Record<EstadoFisico, string>> = {
  [EstadoFisico.EXCELENTE]: '1.0',
  [EstadoFisico.BOM]: '0.8',
  [EstadoFisico.REGULAR]: '0.5',
  [EstadoFisico.RUIM]: '0.2',
  [EstadoFisico.SUCATA]: '0.0',
};

const MINIMO_AMOSTRAS_REGRESSAO = 5;
const MS_POR_HORA = 1000 * 60 * 60;
const MS_POR_DIA = MS_POR_HORA * 24;

export interface EficienciaPorOperador {
  usuarioId: string;
  nome: string;
  mediaHoras: number;
}

export interface EficienciaPorMes {
  mes: string;
  mediaHoras: number;
}

export interface DadosEficienciaOperacional {
  mediaHoras: number;
  medianaHoras: number;
  desvioPadrao: number;
  totalLotes: number;
  porOperador: EficienciaPorOperador[];
  porMes: EficienciaPorMes[];
}

export interface RentabilidadeEstado {
  valorMedioEstimado: number;
  quantidade: number;
}

export type DadosRentabilidadePorTipo = Record<string, Record<string, RentabilidadeEstado>>;

export interface PrevisaoVidaUtilTipo {
  amostras: number;
  coeficienteAngular: number;
  intercepto: number;
  valorPrevistoAtual: number;
  diasMediosAteInservivel: number | null;
  dataPrevistaInservivel: string | null;
}

export type DadosVidaUtil = Record<string, PrevisaoVidaUtilTipo>;

export interface RespostaAnalise<T> {
  dados: T;
  geradoEm: string;
}

export interface FiltroPeriodoString {
  dataInicio?: string | undefined;
  dataFim?: string | undefined;
}

function arredondar(valor: number, casas = 2): number {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

function parsearFiltroPeriodo(filtro?: FiltroPeriodoString): FiltroPeriodoAnalise {
  const resultado: FiltroPeriodoAnalise = {};
  if (filtro?.dataInicio) {
    const d = new Date(filtro.dataInicio);
    if (Number.isNaN(d.getTime())) {
      throw new ErroRegraDeNegocio('dataInicio inválida para análise.', 'FILTRO_INVALIDO');
    }
    resultado.dataInicio = d;
  }
  if (filtro?.dataFim) {
    const d = new Date(filtro.dataFim);
    if (Number.isNaN(d.getTime())) {
      throw new ErroRegraDeNegocio('dataFim inválida para análise.', 'FILTRO_INVALIDO');
    }
    resultado.dataFim = d;
  }
  if (resultado.dataInicio && resultado.dataFim && resultado.dataFim < resultado.dataInicio) {
    throw new ErroRegraDeNegocio(
      'dataFim não pode ser anterior a dataInicio.',
      'FILTRO_INVALIDO',
    );
  }
  return resultado;
}

/**
 * AnaliticoService (AV3, Pilar 1):
 * - Independente de Fastify e Prisma.
 * - Executa cálculos estatísticos com `simple-statistics` e aritmética monetária com `Decimal`.
 * - Persiste cada resultado em `ResultadoAnalitico` para histórico comparativo.
 */
export class AnaliticoService {
  constructor(
    private readonly analiticoRepo: AnaliticoRepository,
    private readonly parametroRepo: ParametroRepository,
    private readonly relogio: Relogio = new RelogioReal(),
  ) {}

  async calcularEficienciaOperacional(
    filtro?: FiltroPeriodoString,
  ): Promise<RespostaAnalise<DadosEficienciaOperacional>> {
    const filtroDatas = parsearFiltroPeriodo(filtro);
    const triagens = await this.analiticoRepo.listarTriagensConcluidas(filtroDatas);

    if (triagens.length === 0) {
      const vazio: DadosEficienciaOperacional = {
        mediaHoras: 0,
        medianaHoras: 0,
        desvioPadrao: 0,
        totalLotes: 0,
        porOperador: [],
        porMes: [],
      };
      const salvo = await this.analiticoRepo.salvarResultado({
        tipo: TipoAnalise.EFICIENCIA_OPERACIONAL,
        parametros: filtro ? { ...filtro } : null,
        resultado: vazio,
      });
      return { dados: vazio, geradoEm: salvo.geradoEm.toISOString() };
    }

    // Por lote: considera a última movimentação com statusNovo=TRIADO do lote
    const ultimaTriagemPorLote = new Map<
      string,
      { dataEntradaLote: Date; triadoEm: Date; horas: number }
    >();
    const horasPorOperador = new Map<string, { nome: string; valores: number[] }>();
    const horasPorMes = new Map<string, number[]>();

    for (const item of triagens) {
      const horas = Math.max(0, (item.triadoEm.getTime() - item.dataEntradaLote.getTime()) / MS_POR_HORA);

      const atualLote = ultimaTriagemPorLote.get(item.loteId);
      if (!atualLote || item.triadoEm.getTime() >= atualLote.triadoEm.getTime()) {
        ultimaTriagemPorLote.set(item.loteId, {
          dataEntradaLote: item.dataEntradaLote,
          triadoEm: item.triadoEm,
          horas,
        });
      }

      const grupoOp = horasPorOperador.get(item.usuarioId) ?? {
        nome: item.usuarioEmail,
        valores: [],
      };
      grupoOp.valores.push(horas);
      horasPorOperador.set(item.usuarioId, grupoOp);
    }

    const duracoesLotes: number[] = [];
    for (const lote of ultimaTriagemPorLote.values()) {
      duracoesLotes.push(lote.horas);
      const mes = lote.dataEntradaLote.toISOString().slice(0, 7);
      const listaMes = horasPorMes.get(mes) ?? [];
      listaMes.push(lote.horas);
      horasPorMes.set(mes, listaMes);
    }

    const porOperador: EficienciaPorOperador[] = Array.from(horasPorOperador.entries())
      .map(([usuarioId, info]) => ({
        usuarioId,
        nome: info.nome,
        mediaHoras: arredondar(mean(info.valores)),
      }))
      .sort((a, b) => a.mediaHoras - b.mediaHoras);

    const porMes: EficienciaPorMes[] = Array.from(horasPorMes.entries())
      .map(([mes, valores]) => ({
        mes,
        mediaHoras: arredondar(mean(valores)),
      }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    const dados: DadosEficienciaOperacional = {
      mediaHoras: arredondar(mean(duracoesLotes)),
      medianaHoras: arredondar(median(duracoesLotes)),
      desvioPadrao: arredondar(standardDeviation(duracoesLotes)),
      totalLotes: duracoesLotes.length,
      porOperador,
      porMes,
    };

    const salvo = await this.analiticoRepo.salvarResultado({
      tipo: TipoAnalise.EFICIENCIA_OPERACIONAL,
      parametros: filtro ? { ...filtro } : null,
      resultado: dados,
    });

    return { dados, geradoEm: salvo.geradoEm.toISOString() };
  }

  async calcularRentabilidadePorTipo(): Promise<RespostaAnalise<DadosRentabilidadePorTipo>> {
    const [equipamentos, parametros] = await Promise.all([
      this.analiticoRepo.listarEquipamentosReutilizados(),
      this.parametroRepo.listarTodos(),
    ]);

    const mapaParametros = new Map<string, string>();
    for (const p of parametros) {
      mapaParametros.set(p.chave, p.valor);
    }

    // Acumulador exato em Decimal por tipo -> estadoFisico
    const acumulador = new Map<string, Map<string, { soma: Decimal; quantidade: number }>>();

    for (const eq of equipamentos) {
      if (eq.valorAquisicao === null) {
        continue;
      }

      const chaveCoef = `COEF_DEPRECIACAO_${eq.tipo}`;
      const coefStr = mapaParametros.get(chaveCoef) ?? COEFICIENTES_PADRAO[eq.tipo];
      const fatorStr = FATOR_ESTADO_FISICO[eq.estadoFisico];

      const valorEstimado = new Decimal(eq.valorAquisicao)
        .mul(new Decimal(coefStr))
        .mul(new Decimal(fatorStr));

      let mapaEstado = acumulador.get(eq.tipo);
      if (!mapaEstado) {
        mapaEstado = new Map();
        acumulador.set(eq.tipo, mapaEstado);
      }

      const atual = mapaEstado.get(eq.estadoFisico) ?? { soma: new Decimal(0), quantidade: 0 };
      atual.soma = atual.soma.plus(valorEstimado);
      atual.quantidade += 1;
      mapaEstado.set(eq.estadoFisico, atual);
    }

    const dados: DadosRentabilidadePorTipo = {};
    for (const [tipo, mapaEstado] of acumulador.entries()) {
      const estadosObj: Record<string, RentabilidadeEstado> = {};
      for (const [estado, info] of mapaEstado.entries()) {
        const media = info.soma.div(info.quantidade).toDecimalPlaces(2).toNumber();
        estadosObj[estado] = {
          valorMedioEstimado: media,
          quantidade: info.quantidade,
        };
      }
      dados[tipo] = estadosObj;
    }

    const salvo = await this.analiticoRepo.salvarResultado({
      tipo: TipoAnalise.RENTABILIDADE,
      parametros: null,
      resultado: dados,
    });

    return { dados, geradoEm: salvo.geradoEm.toISOString() };
  }

  async calcularVidaUtil(): Promise<RespostaAnalise<DadosVidaUtil>> {
    const amostras = await this.analiticoRepo.listarAmostrasVidaUtil();
    const agora = this.relogio.agora();

    const pontosPorTipo = new Map<TipoEquipamento, [number, number][]>();
    for (const item of amostras) {
      const diasUso = Math.max(0, (agora.getTime() - item.criadoEm.getTime()) / MS_POR_DIA);
      const indiceEstado = valorEstadoFisico(item.estadoFisico);

      const lista = pontosPorTipo.get(item.tipo) ?? [];
      lista.push([diasUso, indiceEstado]);
      pontosPorTipo.set(item.tipo, lista);
    }

    const dados: DadosVidaUtil = {};
    for (const [tipo, pontos] of pontosPorTipo.entries()) {
      if (pontos.length < MINIMO_AMOSTRAS_REGRESSAO) {
        continue;
      }

      const regressao = linearRegression(pontos);
      const reta = linearRegressionLine(regressao);
      const mediaDias = mean(pontos.map(([x]) => x));
      const valorPrevistoAtual = arredondar(reta(mediaDias), 4);

      let diasMediosAteInservivel: number | null = null;
      let dataPrevistaInservivel: string | null = null;

      if (regressao.m < 0 && Number.isFinite(regressao.b)) {
        const xZero = -regressao.b / regressao.m;
        if (Number.isFinite(xZero) && xZero >= 0) {
          diasMediosAteInservivel = arredondar(xZero, 2);
          const diasRestantes = Math.max(0, xZero - mediaDias);
          dataPrevistaInservivel = new Date(
            agora.getTime() + diasRestantes * MS_POR_DIA,
          ).toISOString();
        }
      }

      dados[tipo] = {
        amostras: pontos.length,
        coeficienteAngular: arredondar(regressao.m, 6),
        intercepto: arredondar(regressao.b, 4),
        valorPrevistoAtual,
        diasMediosAteInservivel,
        dataPrevistaInservivel,
      };
    }

    const salvo = await this.analiticoRepo.salvarResultado({
      tipo: TipoAnalise.VIDA_UTIL,
      parametros: null,
      resultado: dados,
    });

    return { dados, geradoEm: salvo.geradoEm.toISOString() };
  }

  async listarHistorico(
    limite = 50,
    tipo?: TipoAnalise | undefined,
  ): Promise<ResultadoAnaliticoEntidade[]> {
    const limiteSeguro = Math.min(100, Math.max(1, limite));
    return this.analiticoRepo.listarHistorico(limiteSeguro, tipo);
  }

  /** Executa as 3 análises em sequência (usado pela tarefa agendada cron). */
  async executarTodasAnalises(): Promise<{
    eficiencia: RespostaAnalise<DadosEficienciaOperacional>;
    rentabilidade: RespostaAnalise<DadosRentabilidadePorTipo>;
    vidaUtil: RespostaAnalise<DadosVidaUtil>;
  }> {
    const eficiencia = await this.calcularEficienciaOperacional();
    const rentabilidade = await this.calcularRentabilidadePorTipo();
    const vidaUtil = await this.calcularVidaUtil();
    return { eficiencia, rentabilidade, vidaUtil };
  }
}
