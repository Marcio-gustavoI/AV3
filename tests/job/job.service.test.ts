import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroNaoEncontrado, ErroRegraDeNegocio } from '../../src/domain/index.js';
import type { AnaliticoService } from '../../src/modules/analitico/analitico.service.js';
import {
  type EntidadeJobRelatorio,
  type JobRepository,
  StatusJobRelatorio,
  TipoJobRelatorio,
} from '../../src/modules/job/job.repository.js';
import type { Queue } from 'bullmq';
import {
  JobService,
  PublicadorFilaBullMQ,
  type PublicadorFilaRelatorio,
} from '../../src/modules/job/job.service.js';
import {
  fecharWorker,
  processarJobRelatorio,
} from '../../src/workers/relatorio.worker.js';

describe('JobService e Worker de Relatórios (AV3 — Pilar 3)', () => {
  let jobRepo: {
    criar: ReturnType<typeof vi.fn>;
    buscarPorId: ReturnType<typeof vi.fn>;
    atualizar: ReturnType<typeof vi.fn>;
  };

  let filaPublicador: {
    publicar: ReturnType<typeof vi.fn>;
  };

  let service: JobService;

  beforeEach(() => {
    jobRepo = {
      criar: vi.fn(),
      buscarPorId: vi.fn().mockResolvedValue(null),
      atualizar: vi.fn(),
    };

    filaPublicador = {
      publicar: vi.fn().mockResolvedValue(undefined),
    };

    service = new JobService(
      jobRepo as unknown as JobRepository,
      filaPublicador as unknown as PublicadorFilaRelatorio,
    );
  });

  it('submeterJob salva PENDENTE, chama publicar na fila mockada e retorna jobId', async () => {
    const jobCriado: EntidadeJobRelatorio = {
      id: '00000000-0000-0000-0000-000000000301',
      tipo: TipoJobRelatorio.EFICIENCIA,
      status: StatusJobRelatorio.PENDENTE,
      progresso: 0,
      parceiroId: '00000000-0000-0000-0000-000000000201',
      usuarioId: null,
      parametros: { dataInicio: '2026-10-01' },
      resultado: null,
      erro: null,
      tentativas: 0,
      criadoEm: new Date('2026-11-20T00:00:00.000Z'),
      concluidoEm: null,
    };
    jobRepo.criar.mockResolvedValue(jobCriado);

    const resposta = await service.submeterJob(
      'eficiencia',
      { dataInicio: '2026-10-01' },
      jobCriado.parceiroId,
    );

    expect(resposta).toEqual({
      jobId: jobCriado.id,
      status: StatusJobRelatorio.PENDENTE,
    });
    expect(filaPublicador.publicar).toHaveBeenCalledWith({
      jobId: jobCriado.id,
      tipo: TipoJobRelatorio.EFICIENCIA,
      parametros: { dataInicio: '2026-10-01' },
    });
  });

  it('rejeita tipo de job inválido com ErroRegraDeNegocio (422)', async () => {
    await expect(service.submeterJob('INEXISTENTE')).rejects.toBeInstanceOf(ErroRegraDeNegocio);
    expect(filaPublicador.publicar).not.toHaveBeenCalled();
  });

  it('consultarStatus e obterResultado retornam dados corretos ou 404 quando não encontrado', async () => {
    await expect(service.consultarStatus('id-inexistente')).rejects.toBeInstanceOf(
      ErroNaoEncontrado,
    );
    await expect(service.obterResultado('id-inexistente')).rejects.toBeInstanceOf(
      ErroNaoEncontrado,
    );

    const pendente: EntidadeJobRelatorio = {
      id: '00000000-0000-0000-0000-000000000302',
      tipo: TipoJobRelatorio.RENTABILIDADE,
      status: StatusJobRelatorio.PROCESSANDO,
      progresso: 25,
      parceiroId: null,
      usuarioId: '00000000-0000-0000-0000-000000000001',
      parametros: null,
      resultado: null,
      erro: null,
      tentativas: 0,
      criadoEm: new Date('2026-11-20T00:00:00.000Z'),
      concluidoEm: null,
    };
    jobRepo.buscarPorId.mockResolvedValueOnce(pendente);
    const status = await service.consultarStatus(pendente.id);
    expect(status.status).toBe(StatusJobRelatorio.PROCESSANDO);
    expect(status.progresso).toBe(25);
    expect(status.concluidoEm).toBeNull();

    jobRepo.buscarPorId.mockResolvedValueOnce(pendente);
    const resPendente = await service.obterResultado(pendente.id);
    expect(resPendente.concluido).toBe(false);
    expect(resPendente.resultado).toBeNull();

    const concluido: EntidadeJobRelatorio = {
      ...pendente,
      status: StatusJobRelatorio.CONCLUIDO,
      progresso: 100,
      resultado: { dados: { NOTEBOOK: { BOM: { valorMedioEstimado: 1200, quantidade: 2 } } } },
      concluidoEm: new Date('2026-11-20T00:01:00.000Z'),
    };
    jobRepo.buscarPorId.mockResolvedValueOnce(concluido);
    const resConcluido = await service.obterResultado(concluido.id);
    expect(resConcluido.concluido).toBe(true);
    expect(resConcluido.resultado).toEqual(concluido.resultado);
  });

  it('worker processa EFICIENCIA, RENTABILIDADE, VIDA_UTIL e marca ERRO em caso de falha', async () => {
    const analiticoMock = {
      calcularEficienciaOperacional: vi.fn().mockResolvedValue({ dados: { totalLotes: 2 }, geradoEm: '2026-11-20T00:00:00.000Z' }),
      calcularRentabilidadePorTipo: vi.fn().mockResolvedValue({ dados: {}, geradoEm: '2026-11-20T00:00:00.000Z' }),
      calcularVidaUtil: vi.fn().mockResolvedValue({ dados: {}, geradoEm: '2026-11-20T00:00:00.000Z' }),
    };

    jobRepo.atualizar.mockResolvedValue({});

    await processarJobRelatorio(
      { jobId: 'job-1', tipo: TipoJobRelatorio.EFICIENCIA, parametros: { dataInicio: '2026-10-01' } },
      {
        jobRepo: jobRepo as unknown as JobRepository,
        analiticoService: analiticoMock as unknown as AnaliticoService,
      },
    );
    expect(analiticoMock.calcularEficienciaOperacional).toHaveBeenCalledWith({
      dataInicio: '2026-10-01',
      dataFim: undefined,
    });
    expect(jobRepo.atualizar).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: StatusJobRelatorio.PROCESSANDO, progresso: 10 }),
    );
    expect(jobRepo.atualizar).toHaveBeenCalledWith('job-1', { progresso: 40 });
    expect(jobRepo.atualizar).toHaveBeenCalledWith('job-1', { progresso: 80 });
    expect(jobRepo.atualizar).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: StatusJobRelatorio.CONCLUIDO, progresso: 100 }),
    );
    await expect(fecharWorker()).resolves.toBeUndefined();

    await processarJobRelatorio(
      { jobId: 'job-2', tipo: TipoJobRelatorio.RENTABILIDADE },
      {
        jobRepo: jobRepo as unknown as JobRepository,
        analiticoService: analiticoMock as unknown as AnaliticoService,
      },
    );
    expect(analiticoMock.calcularRentabilidadePorTipo).toHaveBeenCalledTimes(1);

    await processarJobRelatorio(
      { jobId: 'job-3', tipo: TipoJobRelatorio.VIDA_UTIL },
      {
        jobRepo: jobRepo as unknown as JobRepository,
        analiticoService: analiticoMock as unknown as AnaliticoService,
      },
    );
    expect(analiticoMock.calcularVidaUtil).toHaveBeenCalledTimes(1);

    analiticoMock.calcularVidaUtil.mockRejectedValueOnce(new Error('Falha no banco'));
    await expect(
      processarJobRelatorio(
        { jobId: 'job-4', tipo: TipoJobRelatorio.VIDA_UTIL },
        {
          jobRepo: jobRepo as unknown as JobRepository,
          analiticoService: analiticoMock as unknown as AnaliticoService,
        },
      ),
    ).rejects.toThrow('Falha no banco');

    expect(jobRepo.atualizar).toHaveBeenCalledWith(
      'job-4',
      expect.objectContaining({
        status: StatusJobRelatorio.ERRO,
        erro: 'Falha no banco',
        incrementarTentativas: true,
      }),
    );

    const filaMock = { add: vi.fn().mockResolvedValue(undefined) };
    const pubBull = new PublicadorFilaBullMQ(filaMock as unknown as Queue);
    await pubBull.publicar({ jobId: 'job-5', tipo: TipoJobRelatorio.EFICIENCIA, parametros: null });
    expect(filaMock.add).toHaveBeenCalledWith(
      TipoJobRelatorio.EFICIENCIA,
      { jobId: 'job-5', tipo: TipoJobRelatorio.EFICIENCIA, parametros: null },
      expect.objectContaining({ attempts: 3, backoff: { type: 'exponential', delay: 1000 } }),
    );
  });
});
