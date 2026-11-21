import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErroConflitoDeVersao,
  ErroNaoEncontrado,
  ErroRegraDeNegocio,
  ErroSemPermissao,
  Papel,
} from '../../src/domain/index.js';
import {
  type AuditoriaRepository,
  MemoriaGerenciadorTransacao,
} from '../../src/modules/auditoria/auditoria.repository.js';
import type { AtorOperacao } from '../../src/modules/organizacao/organizacao.service.js';
import {
  type EntidadeParceiro,
  type ParceiroRepository,
  PermissaoParceiro,
} from '../../src/modules/parceiro/parceiro.repository.js';
import {
  ParceiroService,
  calcularHashApiKey,
} from '../../src/modules/parceiro/parceiro.service.js';

const ATOR_ADMIN: AtorOperacao = {
  id: '00000000-0000-0000-0000-000000000001',
  papel: Papel.ADMIN,
};

const ATOR_AUDITOR: AtorOperacao = {
  id: '00000000-0000-0000-0000-000000000004',
  papel: Papel.AUDITOR,
};

describe('ParceiroService (AV3 — Pilar 2)', () => {
  let parceiroRepo: {
    criar: ReturnType<typeof vi.fn>;
    listarTodos: ReturnType<typeof vi.fn>;
    buscarPorId: ReturnType<typeof vi.fn>;
    buscarAtivoPorApiKeyHash: ReturnType<typeof vi.fn>;
    atualizarComVersao: ReturnType<typeof vi.fn>;
    desativar: ReturnType<typeof vi.fn>;
  };

  let auditoriaRepo: {
    registrar: ReturnType<typeof vi.fn>;
    listar: ReturnType<typeof vi.fn>;
  };

  let service: ParceiroService;

  beforeEach(() => {
    parceiroRepo = {
      criar: vi.fn(),
      listarTodos: vi.fn().mockResolvedValue([]),
      buscarPorId: vi.fn().mockResolvedValue(null),
      buscarAtivoPorApiKeyHash: vi.fn().mockResolvedValue(null),
      atualizarComVersao: vi.fn().mockResolvedValue(null),
      desativar: vi.fn().mockResolvedValue(null),
    };

    auditoriaRepo = {
      registrar: vi.fn().mockResolvedValue(undefined),
      listar: vi.fn().mockResolvedValue({ dados: [], total: 0 }),
    };

    service = new ParceiroService(
      parceiroRepo as unknown as ParceiroRepository,
      auditoriaRepo as unknown as AuditoriaRepository,
      new MemoriaGerenciadorTransacao(),
      'greencode_',
    );
  });

  it('cria parceiro gerando apiKey com prefixo "greencode_", salva hash SHA-256 e registra auditoria', async () => {
    parceiroRepo.criar.mockImplementation(
      async (dados: {
        nome: string;
        apiKeyHash: string;
        apiKeyPrefixo: string;
        permissoes: string[];
        organizacaoId: string | null;
      }): Promise<EntidadeParceiro> => ({
        id: '00000000-0000-0000-0000-000000000201',
        nome: dados.nome,
        apiKeyPrefixo: dados.apiKeyPrefixo,
        permissoes: dados.permissoes,
        organizacaoId: dados.organizacaoId,
        ativo: true,
        versao: 1,
        criadoEm: new Date('2026-11-20T00:00:00.000Z'),
      }),
    );

    const criado = await service.criar(ATOR_ADMIN, {
      nome: 'Parceiro EcoTech',
      permissoes: [PermissaoParceiro.LEITURA_RASTREABILIDADE, PermissaoParceiro.LEITURA_LOTES],
    });

    expect(criado.apiKey.startsWith('greencode_')).toBe(true);
    expect(criado.ativo).toBe(true);
    expect(parceiroRepo.criar).toHaveBeenCalledWith(
      expect.objectContaining({
        nome: 'Parceiro EcoTech',
        apiKeyHash: calcularHashApiKey(criado.apiKey),
      }),
      undefined,
    );
    expect(auditoriaRepo.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'CRIAR', entidade: 'ParceiroExterno' }),
      undefined,
    );
  });

  it('revoga parceiro setando ativo=false e registrando auditoria', async () => {
    const existente: EntidadeParceiro = {
      id: '00000000-0000-0000-0000-000000000202',
      nome: 'Parceiro Antigo',
      apiKeyPrefixo: 'greencode_12345678',
      permissoes: [PermissaoParceiro.LEITURA_RASTREABILIDADE],
      organizacaoId: null,
      ativo: true,
      versao: 1,
      criadoEm: new Date(),
    };
    parceiroRepo.buscarPorId.mockResolvedValue(existente);
    parceiroRepo.desativar.mockResolvedValue({ ...existente, ativo: false, versao: 2 });

    const revogado = await service.revogar(ATOR_ADMIN, existente.id);

    expect(revogado.ativo).toBe(false);
    expect(parceiroRepo.desativar).toHaveBeenCalledWith(existente.id, undefined);
    expect(auditoriaRepo.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'REVOGAR', entidade: 'ParceiroExterno' }),
      undefined,
    );
  });

  it('bloqueia acesso de papéis não-ADMIN com 403 (ErroSemPermissao)', async () => {
    await expect(
      service.criar(ATOR_AUDITOR, {
        nome: 'Invasor',
        permissoes: [PermissaoParceiro.LEITURA_LOTES],
      }),
    ).rejects.toBeInstanceOf(ErroSemPermissao);

    await expect(service.listar(ATOR_AUDITOR)).rejects.toBeInstanceOf(ErroSemPermissao);
    await expect(service.revogar(ATOR_AUDITOR, 'qualquer-id')).rejects.toBeInstanceOf(
      ErroSemPermissao,
    );
  });

  it('valida nome vazio, permissões inválidas, 404 e conflito de versão (409) no update', async () => {
    await expect(
      service.criar(ATOR_ADMIN, { nome: '   ', permissoes: [PermissaoParceiro.LEITURA_LOTES] }),
    ).rejects.toBeInstanceOf(ErroRegraDeNegocio);

    await expect(
      service.criar(ATOR_ADMIN, { nome: 'Ok', permissoes: [] }),
    ).rejects.toBeInstanceOf(ErroRegraDeNegocio);

    await expect(
      service.criar(ATOR_ADMIN, { nome: 'Ok', permissoes: ['PERMISSAO_FAKE'] }),
    ).rejects.toBeInstanceOf(ErroRegraDeNegocio);

    await expect(service.buscarPorId(ATOR_ADMIN, 'nao-existe')).rejects.toBeInstanceOf(
      ErroNaoEncontrado,
    );
    await expect(service.revogar(ATOR_ADMIN, 'nao-existe')).rejects.toBeInstanceOf(
      ErroNaoEncontrado,
    );

    const existente: EntidadeParceiro = {
      id: '00000000-0000-0000-0000-000000000203',
      nome: 'Parceiro V1',
      apiKeyPrefixo: 'greencode_abcdef12',
      permissoes: [PermissaoParceiro.LEITURA_LOTES],
      organizacaoId: null,
      ativo: true,
      versao: 1,
      criadoEm: new Date(),
    };

    parceiroRepo.buscarPorId.mockResolvedValue(existente);
    parceiroRepo.atualizarComVersao.mockResolvedValueOnce(null);

    await expect(
      service.atualizar(ATOR_ADMIN, {
        id: existente.id,
        versao: 99,
        nome: 'Parceiro V2',
      }),
    ).rejects.toBeInstanceOf(ErroConflitoDeVersao);

    parceiroRepo.atualizarComVersao.mockResolvedValueOnce({
      ...existente,
      nome: 'Parceiro V2',
      permissoes: [PermissaoParceiro.ESCRITA_LOTES],
      versao: 2,
    });

    const atualizado = await service.atualizar(ATOR_ADMIN, {
      id: existente.id,
      versao: 1,
      nome: 'Parceiro V2',
      permissoes: [PermissaoParceiro.ESCRITA_LOTES],
    });
    expect(atualizado.versao).toBe(2);
    expect(atualizado.nome).toBe('Parceiro V2');

    const lista = await service.listar(ATOR_ADMIN);
    expect(lista).toEqual([]);
  });
});
