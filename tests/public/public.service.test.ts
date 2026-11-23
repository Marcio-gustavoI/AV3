import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClassificacaoDestino,
  ErroNaoEncontrado,
  ErroSemPermissao,
  EstadoFisico,
  StatusEquipamento,
  TipoEquipamento,
} from '../../src/domain/index.js';
import type { EquipamentoRepository } from '../../src/modules/equipamento/equipamento.repository.js';
import type { JobService } from '../../src/modules/job/job.service.js';
import type { LoteService } from '../../src/modules/lote/lote.service.js';
import { PermissaoParceiro } from '../../src/modules/parceiro/parceiro.repository.js';
import { PublicService } from '../../src/modules/public/public.service.js';
import type { ParceiroAutenticado } from '../../src/plugins/api-key-auth.js';

const PARCEIRO_COMPLETO: ParceiroAutenticado = {
  id: '00000000-0000-0000-0000-000000000201',
  nome: 'Parceiro Full',
  permissoes: [
    PermissaoParceiro.LEITURA_RASTREABILIDADE,
    PermissaoParceiro.LEITURA_LOTES,
    PermissaoParceiro.ESCRITA_LOTES,
  ],
  organizacaoId: '00000000-0000-0000-0000-000000000501',
};

const PARCEIRO_SEM_PERMISSOES: ParceiroAutenticado = {
  id: '00000000-0000-0000-0000-000000000202',
  nome: 'Parceiro Restrito',
  permissoes: [],
  organizacaoId: null,
};

describe('PublicService (AV3 — Pilar 2: API Pública)', () => {
  let equipamentoRepo: {
    buscarPorCodigoBarras: ReturnType<typeof vi.fn>;
    buscarRastreabilidadePorId: ReturnType<typeof vi.fn>;
  };

  let loteService: {
    listar: ReturnType<typeof vi.fn>;
    criar: ReturnType<typeof vi.fn>;
  };

  let jobService: {
    submeterJob: ReturnType<typeof vi.fn>;
    consultarStatus: ReturnType<typeof vi.fn>;
    obterResultado: ReturnType<typeof vi.fn>;
  };

  let service: PublicService;

  beforeEach(() => {
    equipamentoRepo = {
      buscarPorCodigoBarras: vi.fn().mockResolvedValue(null),
      buscarRastreabilidadePorId: vi.fn().mockResolvedValue(null),
    };

    loteService = {
      listar: vi.fn().mockResolvedValue({
        dados: [],
        paginacao: { pagina: 1, tamanhoPagina: 20, total: 0, totalPaginas: 0 },
      }),
      criar: vi.fn(),
    };

    jobService = {
      submeterJob: vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'PENDENTE' }),
      consultarStatus: vi.fn().mockResolvedValue({
        jobId: 'job-1',
        tipo: 'EFICIENCIA',
        status: 'PENDENTE',
        progresso: 0,
        tentativas: 0,
        erro: null,
        criadoEm: '2026-11-20T00:00:00.000Z',
        concluidoEm: null,
      }),
      obterResultado: vi.fn().mockResolvedValue({
        concluido: false,
        status: 'PROCESSANDO',
        resultado: null,
        concluidoEm: null,
      }),
    };

    service = new PublicService(
      equipamentoRepo as unknown as EquipamentoRepository,
      loteService as unknown as LoteService,
      jobService as unknown as JobService,
    );
  });

  it('rastreabilidade retorna 404 quando equipamento não existe', async () => {
    await expect(
      service.consultarRastreabilidade(PARCEIRO_COMPLETO, 'GC-999999'),
    ).rejects.toBeInstanceOf(ErroNaoEncontrado);
  });

  it('retorna 403 quando parceiro não tem permissão necessária em cada operação', async () => {
    await expect(
      service.consultarRastreabilidade(PARCEIRO_SEM_PERMISSOES, 'GC-000001'),
    ).rejects.toBeInstanceOf(ErroSemPermissao);

    await expect(service.listarLotes(PARCEIRO_SEM_PERMISSOES, {})).rejects.toBeInstanceOf(
      ErroSemPermissao,
    );

    await expect(
      service.submeterLote(PARCEIRO_SEM_PERMISSOES, {
        organizacaoId: '00000000-0000-0000-0000-000000000501',
        notaFiscal: 'NF-1',
        transportadora: 'Transp',
        dataEntrada: '2026-11-20',
        equipamentos: [],
      }),
    ).rejects.toBeInstanceOf(ErroSemPermissao);

    await expect(
      service.solicitarRelatorio(PARCEIRO_SEM_PERMISSOES, 'EFICIENCIA'),
    ).rejects.toBeInstanceOf(ErroSemPermissao);
  });

  it('rastreabilidade retorna status e última movimentação e bloqueia acesso a outra organização (403)', async () => {
    equipamentoRepo.buscarPorCodigoBarras.mockResolvedValue({ id: 'eq-1' });
    equipamentoRepo.buscarRastreabilidadePorId.mockResolvedValue({
      equipamento: {
        id: 'eq-1',
        codigoBarrasInterno: 'GC-000001',
        tipo: TipoEquipamento.NOTEBOOK,
        status: StatusEquipamento.TRIADO,
        estadoFisico: EstadoFisico.BOM,
        classificacaoDestino: ClassificacaoDestino.REUTILIZACAO,
      },
      organizacao: { id: PARCEIRO_COMPLETO.organizacaoId },
      movimentacoes: [
        {
          criadoEm: new Date('2026-11-19T10:00:00.000Z'),
          statusAnterior: StatusEquipamento.EM_TRIAGEM,
          statusNovo: StatusEquipamento.TRIADO,
        },
      ],
    });

    const resp = await service.consultarRastreabilidade(PARCEIRO_COMPLETO, 'gc-000001');
    expect(resp).toEqual({
      codigoBarras: 'GC-000001',
      tipo: TipoEquipamento.NOTEBOOK,
      status: StatusEquipamento.TRIADO,
      estadoFisico: EstadoFisico.BOM,
      classificacaoDestino: ClassificacaoDestino.REUTILIZACAO,
      ultimaMovimentacao: {
        data: '2026-11-19T10:00:00.000Z',
        statusAnterior: StatusEquipamento.EM_TRIAGEM,
        statusNovo: StatusEquipamento.TRIADO,
      },
    });

    equipamentoRepo.buscarRastreabilidadePorId.mockResolvedValueOnce({
      equipamento: { id: 'eq-2', codigoBarrasInterno: 'GC-000002' },
      organizacao: { id: '00000000-0000-0000-0000-999999999999' },
      movimentacoes: [],
    });
    await expect(
      service.consultarRastreabilidade(PARCEIRO_COMPLETO, 'GC-000002'),
    ).rejects.toBeInstanceOf(ErroSemPermissao);
  });

  it('lista lotes respeitando organização do parceiro, submete lote e delega jobs de relatório', async () => {
    loteService.listar.mockResolvedValue({
      dados: [
        {
          id: 'lote-1',
          organizacaoId: PARCEIRO_COMPLETO.organizacaoId,
          notaFiscal: 'NF-100',
          transportadora: 'EcoTrans',
          dataEntrada: new Date('2026-11-15T00:00:00.000Z'),
          criadoEm: new Date('2026-11-15T10:00:00.000Z'),
        },
      ],
      paginacao: { pagina: 1, tamanhoPagina: 20, total: 1, totalPaginas: 1 },
    });

    const listagem = await service.listarLotes(PARCEIRO_COMPLETO, { page: 1, limit: 20 });
    expect(listagem.total).toBe(1);
    expect(listagem.lotes[0]?.notaFiscal).toBe('NF-100');

    await expect(
      service.listarLotes(PARCEIRO_COMPLETO, {
        organizacaoId: '00000000-0000-0000-0000-999999999999',
      }),
    ).rejects.toBeInstanceOf(ErroSemPermissao);

    loteService.criar.mockResolvedValue({
      id: 'lote-novo',
      equipamentos: [
        {
          id: 'eq-novo',
          codigoBarrasInterno: 'GC-000010',
          tipo: TipoEquipamento.DESKTOP,
          status: StatusEquipamento.RECEBIDO,
        },
      ],
    });

    const criado = await service.submeterLote(PARCEIRO_COMPLETO, {
      organizacaoId: PARCEIRO_COMPLETO.organizacaoId!,
      notaFiscal: 'NF-200',
      transportadora: 'EcoTrans',
      dataEntrada: '2026-11-20',
      equipamentos: [
        {
          tipo: TipoEquipamento.DESKTOP,
          descricao: 'Desktop i5',
          estadoFisico: EstadoFisico.BOM,
        },
      ],
    });
    expect(criado.loteId).toBe('lote-novo');
    expect(criado.equipamentosCriados).toHaveLength(1);

    await expect(
      service.submeterLote(PARCEIRO_COMPLETO, {
        organizacaoId: '00000000-0000-0000-0000-999999999999',
        notaFiscal: 'NF-201',
        transportadora: 'EcoTrans',
        dataEntrada: '2026-11-20',
        equipamentos: [],
      }),
    ).rejects.toBeInstanceOf(ErroSemPermissao);

    const jobEf = await service.solicitarRelatorioEficiencia(PARCEIRO_COMPLETO);
    expect(jobEf.jobId).toBe('job-1');

    const statusJob = await service.consultarStatusJob(PARCEIRO_COMPLETO, 'job-1');
    expect(statusJob.status).toBe('PENDENTE');

    const resJob = await service.obterResultadoJob(PARCEIRO_COMPLETO, 'job-1');
    expect(resJob.concluido).toBe(false);
  });

  it('retorna 403 "Parceiro sem organização vinculada" quando organizacaoId é null', async () => {
    const parceiroSemOrg: ParceiroAutenticado = {
      ...PARCEIRO_COMPLETO,
      organizacaoId: null,
    };

    await expect(
      service.consultarRastreabilidade(parceiroSemOrg, 'GC-000001'),
    ).rejects.toThrow('Parceiro sem organização vinculada');

    await expect(service.listarLotes(parceiroSemOrg, {})).rejects.toThrow(
      'Parceiro sem organização vinculada',
    );

    await expect(
      service.submeterLote(parceiroSemOrg, {
        organizacaoId: '00000000-0000-0000-0000-000000000501',
        notaFiscal: 'NF-SEM-ORG',
        transportadora: 'EcoTrans',
        dataEntrada: '2026-11-20',
        equipamentos: [],
      }),
    ).rejects.toThrow('Parceiro sem organização vinculada');
  });
});
