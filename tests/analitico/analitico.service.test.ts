import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErroRegraDeNegocio,
  EstadoFisico,
  RelogioFixo,
  TipoEquipamento,
} from '../../src/domain/index.js';
import {
  type AnaliticoRepository,
  type ResultadoAnaliticoEntidade,
  TipoAnalise,
} from '../../src/modules/analitico/analitico.repository.js';
import { AnaliticoService } from '../../src/modules/analitico/analitico.service.js';
import type { ParametroRepository } from '../../src/modules/parametro/parametro.repository.js';

describe('AnaliticoService (AV3 — Pilar 1)', () => {
  const agoraFixo = new Date('2026-11-20T12:00:00.000Z');
  const relogio = new RelogioFixo(agoraFixo);

  let analiticoRepo: {
    listarTriagensConcluidas: ReturnType<typeof vi.fn>;
    listarEquipamentosReutilizados: ReturnType<typeof vi.fn>;
    listarAmostrasVidaUtil: ReturnType<typeof vi.fn>;
    salvarResultado: ReturnType<typeof vi.fn>;
    listarHistorico: ReturnType<typeof vi.fn>;
  };

  let parametroRepo: {
    listarTodos: ReturnType<typeof vi.fn>;
    buscarPorChave: ReturnType<typeof vi.fn>;
    criar: ReturnType<typeof vi.fn>;
    atualizarComVersao: ReturnType<typeof vi.fn>;
  };

  let service: AnaliticoService;

  beforeEach(() => {
    analiticoRepo = {
      listarTriagensConcluidas: vi.fn().mockResolvedValue([]),
      listarEquipamentosReutilizados: vi.fn().mockResolvedValue([]),
      listarAmostrasVidaUtil: vi.fn().mockResolvedValue([]),
      salvarResultado: vi.fn().mockImplementation(
        async (dados: { tipo: string; parametros: Record<string, unknown> | null; resultado: unknown }): Promise<ResultadoAnaliticoEntidade> => ({
          id: '00000000-0000-0000-0000-000000000101',
          tipo: dados.tipo,
          parametros: dados.parametros,
          resultado: dados.resultado,
          geradoEm: agoraFixo,
        }),
      ),
      listarHistorico: vi.fn().mockResolvedValue([]),
    };

    parametroRepo = {
      listarTodos: vi.fn().mockResolvedValue([]),
      buscarPorChave: vi.fn().mockResolvedValue(null),
      criar: vi.fn(),
      atualizarComVersao: vi.fn(),
    };

    service = new AnaliticoService(
      analiticoRepo as unknown as AnaliticoRepository,
      parametroRepo as unknown as ParametroRepository,
      relogio,
    );
  });

  describe('Eficiência operacional', () => {
    it('calcula corretamente média, mediana, desvio padrão, porOperador e porMes com simple-statistics', async () => {
      // Lote 1: 10h; Lote 2: 20h; Lote 3: 30h -> média = 20, mediana = 20, desvio padrão = sqrt(200/3) ≈ 8.16
      analiticoRepo.listarTriagensConcluidas.mockResolvedValue([
        {
          loteId: 'lote-1',
          dataEntradaLote: new Date('2026-10-01T00:00:00.000Z'),
          equipamentoId: 'eq-1',
          triadoEm: new Date('2026-10-01T10:00:00.000Z'),
          usuarioId: 'op-1',
          usuarioEmail: 'op1@greencode.com.br',
        },
        {
          loteId: 'lote-2',
          dataEntradaLote: new Date('2026-10-10T00:00:00.000Z'),
          equipamentoId: 'eq-2',
          triadoEm: new Date('2026-10-10T20:00:00.000Z'),
          usuarioId: 'op-1',
          usuarioEmail: 'op1@greencode.com.br',
        },
        {
          loteId: 'lote-3',
          dataEntradaLote: new Date('2026-11-05T00:00:00.000Z'),
          equipamentoId: 'eq-3',
          triadoEm: new Date('2026-11-06T06:00:00.000Z'),
          usuarioId: 'op-2',
          usuarioEmail: 'op2@greencode.com.br',
        },
      ]);

      const resp = await service.calcularEficienciaOperacional({
        dataInicio: '2026-10-01',
        dataFim: '2026-11-30',
      });

      expect(resp.dados.mediaHoras).toBe(20);
      expect(resp.dados.medianaHoras).toBe(20);
      expect(resp.dados.desvioPadrao).toBe(8.16);
      expect(resp.dados.totalLotes).toBe(3);
      expect(resp.dados.porOperador).toEqual([
        { usuarioId: 'op-1', nome: 'op1@greencode.com.br', mediaHoras: 15 },
        { usuarioId: 'op-2', nome: 'op2@greencode.com.br', mediaHoras: 30 },
      ]);
      expect(resp.dados.porMes).toEqual([
        { mes: '2026-10', mediaHoras: 15 },
        { mes: '2026-11', mediaHoras: 30 },
      ]);
      expect(resp.geradoEm).toBe(agoraFixo.toISOString());
      expect(analiticoRepo.salvarResultado).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: TipoAnalise.EFICIENCIA_OPERACIONAL }),
      );
    });

    it('retorna zeros e arrays vazios quando não há triagens concluídas', async () => {
      const resp = await service.calcularEficienciaOperacional();
      expect(resp.dados).toEqual({
        mediaHoras: 0,
        medianaHoras: 0,
        desvioPadrao: 0,
        totalLotes: 0,
        porOperador: [],
        porMes: [],
      });
      expect(analiticoRepo.salvarResultado).toHaveBeenCalledTimes(1);
    });

    it('rejeita filtros de data inválidos ou invertidos com ErroRegraDeNegocio', async () => {
      await expect(
        service.calcularEficienciaOperacional({ dataInicio: 'nao-e-data' }),
      ).rejects.toBeInstanceOf(ErroRegraDeNegocio);

      await expect(
        service.calcularEficienciaOperacional({ dataFim: 'invalida' }),
      ).rejects.toBeInstanceOf(ErroRegraDeNegocio);

      await expect(
        service.calcularEficienciaOperacional({
          dataInicio: '2026-11-10',
          dataFim: '2026-11-01',
        }),
      ).rejects.toBeInstanceOf(ErroRegraDeNegocio);
    });
  });

  describe('Rentabilidade por tipo', () => {
    it('calcula valor médio estimado com precisão Decimal usando parâmetros do banco e fallback', async () => {
      parametroRepo.listarTodos.mockResolvedValue([
        {
          chave: 'COEF_DEPRECIACAO_NOTEBOOK',
          valor: '0.500000',
          versao: 1,
          atualizadoEm: agoraFixo,
        },
      ]);

      analiticoRepo.listarEquipamentosReutilizados.mockResolvedValue([
        // NOTEBOOK BOM: 4000 * 0.50 * 0.8 = 1600
        { tipo: TipoEquipamento.NOTEBOOK, estadoFisico: EstadoFisico.BOM, valorAquisicao: '4000.00' },
        // NOTEBOOK BOM: 2000 * 0.50 * 0.8 = 800 -> média = 1200, qtd = 2
        { tipo: TipoEquipamento.NOTEBOOK, estadoFisico: EstadoFisico.BOM, valorAquisicao: '2000.00' },
        // DESKTOP EXCELENTE (fallback 0.40): 3000 * 0.40 * 1.0 = 1200
        { tipo: TipoEquipamento.DESKTOP, estadoFisico: EstadoFisico.EXCELENTE, valorAquisicao: '3000.00' },
        // Equipamento sem valorAquisicao deve ser ignorado
        { tipo: TipoEquipamento.MONITOR, estadoFisico: EstadoFisico.REGULAR, valorAquisicao: null },
      ]);

      const resp = await service.calcularRentabilidadePorTipo();

      expect(resp.dados[TipoEquipamento.NOTEBOOK]?.[EstadoFisico.BOM]).toEqual({
        valorMedioEstimado: 1200,
        quantidade: 2,
      });
      expect(resp.dados[TipoEquipamento.DESKTOP]?.[EstadoFisico.EXCELENTE]).toEqual({
        valorMedioEstimado: 1200,
        quantidade: 1,
      });
      expect(resp.dados[TipoEquipamento.MONITOR]).toBeUndefined();
      expect(analiticoRepo.salvarResultado).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: TipoAnalise.RENTABILIDADE }),
      );
    });
  });

  describe('Vida útil remanescente (regressão linear simples)', () => {
    it('projeta dias até estado SUCATA (y=0) para tipos com >= 5 amostras e ignora tipos com < 5', async () => {
      const msDia = 24 * 60 * 60 * 1000;
      // Reta exata: y = 4 - 0.04 * x -> atinge y = 0 em x = 100 dias (m = -0.04, b = 4)
      analiticoRepo.listarAmostrasVidaUtil.mockResolvedValue([
        { tipo: TipoEquipamento.NOTEBOOK, estadoFisico: EstadoFisico.EXCELENTE, criadoEm: new Date(agoraFixo.getTime() - 0 * msDia) },
        { tipo: TipoEquipamento.NOTEBOOK, estadoFisico: EstadoFisico.BOM, criadoEm: new Date(agoraFixo.getTime() - 25 * msDia) },
        { tipo: TipoEquipamento.NOTEBOOK, estadoFisico: EstadoFisico.REGULAR, criadoEm: new Date(agoraFixo.getTime() - 50 * msDia) },
        { tipo: TipoEquipamento.NOTEBOOK, estadoFisico: EstadoFisico.RUIM, criadoEm: new Date(agoraFixo.getTime() - 75 * msDia) },
        { tipo: TipoEquipamento.NOTEBOOK, estadoFisico: EstadoFisico.SUCATA, criadoEm: new Date(agoraFixo.getTime() - 100 * msDia) },
        // Apenas 2 desktops (< 5) -> ignorado
        { tipo: TipoEquipamento.DESKTOP, estadoFisico: EstadoFisico.BOM, criadoEm: new Date(agoraFixo.getTime() - 10 * msDia) },
        { tipo: TipoEquipamento.DESKTOP, estadoFisico: EstadoFisico.BOM, criadoEm: new Date(agoraFixo.getTime() - 20 * msDia) },
      ]);

      const resp = await service.calcularVidaUtil();
      const nb = resp.dados[TipoEquipamento.NOTEBOOK];

      expect(nb).toBeDefined();
      expect(nb?.amostras).toBe(5);
      expect(nb?.coeficienteAngular).toBe(-0.04);
      expect(nb?.intercepto).toBe(4);
      expect(nb?.diasMediosAteInservivel).toBe(100);
      expect(nb?.dataPrevistaInservivel).not.toBeNull();
      expect(resp.dados[TipoEquipamento.DESKTOP]).toBeUndefined();
    });

    it('retorna diasMediosAteInservivel = null quando a inclinação não é negativa (m >= 0)', async () => {
      const msDia = 24 * 60 * 60 * 1000;
      analiticoRepo.listarAmostrasVidaUtil.mockResolvedValue([
        { tipo: TipoEquipamento.SERVIDOR, estadoFisico: EstadoFisico.BOM, criadoEm: new Date(agoraFixo.getTime() - 10 * msDia) },
        { tipo: TipoEquipamento.SERVIDOR, estadoFisico: EstadoFisico.BOM, criadoEm: new Date(agoraFixo.getTime() - 20 * msDia) },
        { tipo: TipoEquipamento.SERVIDOR, estadoFisico: EstadoFisico.BOM, criadoEm: new Date(agoraFixo.getTime() - 30 * msDia) },
        { tipo: TipoEquipamento.SERVIDOR, estadoFisico: EstadoFisico.EXCELENTE, criadoEm: new Date(agoraFixo.getTime() - 40 * msDia) },
        { tipo: TipoEquipamento.SERVIDOR, estadoFisico: EstadoFisico.EXCELENTE, criadoEm: new Date(agoraFixo.getTime() - 50 * msDia) },
      ]);

      const resp = await service.calcularVidaUtil();
      expect(resp.dados[TipoEquipamento.SERVIDOR]?.diasMediosAteInservivel).toBeNull();
      expect(resp.dados[TipoEquipamento.SERVIDOR]?.dataPrevistaInservivel).toBeNull();
    });
  });

  describe('Histórico e execução em lote (cron)', () => {
    it('lista histórico respeitando limite seguro e executa todas as 3 análises', async () => {
      await service.listarHistorico(500, TipoAnalise.RENTABILIDADE);
      expect(analiticoRepo.listarHistorico).toHaveBeenCalledWith(100, TipoAnalise.RENTABILIDADE);

      const tudo = await service.executarTodasAnalises();
      expect(tudo.eficiencia.dados.totalLotes).toBe(0);
      expect(tudo.rentabilidade.dados).toEqual({});
      expect(tudo.vidaUtil.dados).toEqual({});
      expect(analiticoRepo.salvarResultado).toHaveBeenCalledTimes(3);
    });
  });
});
