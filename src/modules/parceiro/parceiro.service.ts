import crypto from 'node:crypto';
import {
  ErroConflitoDeVersao,
  ErroNaoEncontrado,
  ErroRegraDeNegocio,
  ErroSemPermissao,
  Papel,
} from '../../domain/index.js';
import type {
  AuditoriaRepository,
  GerenciadorTransacao,
} from '../auditoria/auditoria.repository.js';
import type { AtorOperacao } from '../organizacao/organizacao.service.js';
import {
  type EntidadeParceiro,
  PERMISSOES_PARCEIRO_VALIDAS,
  type ParceiroRepository,
} from './parceiro.repository.js';

export interface CriarParceiroInput {
  nome: string;
  permissoes: string[];
  organizacaoId?: string | null | undefined;
}

export interface AtualizarParceiroInput {
  id: string;
  versao: number;
  nome?: string | undefined;
  permissoes?: string[] | undefined;
  organizacaoId?: string | null | undefined;
  ativo?: boolean | undefined;
}

export interface ParceiroCriadoComChave extends EntidadeParceiro {
  /** Chave em texto puro exibida uma única vez na criação. */
  apiKey: string;
}

/** Calcula hash SHA-256 hexadecimal de uma chave de API (D-23). */
export function calcularHashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

function validarPermissoes(permissoes: readonly string[]): string[] {
  if (permissoes.length === 0) {
    throw new ErroRegraDeNegocio(
      'Informe ao menos uma permissão para o parceiro externo.',
      'PERMISSOES_INVALIDAS',
    );
  }
  const conjuntoValido = new Set<string>(PERMISSOES_PARCEIRO_VALIDAS);
  const normalizadas = Array.from(new Set(permissoes.map((p) => p.trim().toUpperCase())));
  const invalidas = normalizadas.filter((p) => !conjuntoValido.has(p));
  if (invalidas.length > 0) {
    throw new ErroRegraDeNegocio(
      `Permissões inválidas: ${invalidas.join(', ')}. Permitidas: ${PERMISSOES_PARCEIRO_VALIDAS.join(', ')}.`,
      'PERMISSOES_INVALIDAS',
    );
  }
  return normalizadas;
}

/**
 * ParceiroService (AV3, Pilar 2):
 * - Gestão de parceiros externos (exclusivo ADMIN).
 * - Gera chaves com prefixo configurável (`greencode_<uuid>`) e persiste apenas o hash SHA-256.
 * - Independente de Fastify e Prisma.
 */
export class ParceiroService {
  constructor(
    private readonly parceiroRepo: ParceiroRepository,
    private readonly auditoriaRepo: AuditoriaRepository,
    private readonly transacao: GerenciadorTransacao,
    private readonly prefixoApiKey: string = 'greencode_',
  ) {}

  private exigirAdmin(ator: AtorOperacao): void {
    if (ator.papel !== Papel.ADMIN) {
      throw new ErroSemPermissao('Apenas ADMIN pode gerenciar parceiros externos e chaves de API.');
    }
  }

  async criar(ator: AtorOperacao, input: CriarParceiroInput): Promise<ParceiroCriadoComChave> {
    this.exigirAdmin(ator);

    const nome = input.nome.trim();
    if (!nome) {
      throw new ErroRegraDeNegocio('Nome do parceiro é obrigatório.', 'PARCEIRO_INVALIDO');
    }
    const permissoes = validarPermissoes(input.permissoes);

    const apiKey = `${this.prefixoApiKey}${crypto.randomUUID()}`;
    const apiKeyHash = calcularHashApiKey(apiKey);
    const apiKeyPrefixo = apiKey.slice(0, this.prefixoApiKey.length + 8);

    const criado = await this.transacao.executar(async (tx) => {
      const novo = await this.parceiroRepo.criar(
        {
          nome,
          apiKeyHash,
          apiKeyPrefixo,
          permissoes,
          organizacaoId: input.organizacaoId ?? null,
        },
        tx,
      );

      await this.auditoriaRepo.registrar(
        {
          usuarioId: ator.id,
          acao: 'CRIAR',
          entidade: 'ParceiroExterno',
          entidadeId: novo.id,
          antes: null,
          depois: {
            id: novo.id,
            nome: novo.nome,
            apiKeyPrefixo: novo.apiKeyPrefixo,
            permissoes: novo.permissoes,
            organizacaoId: novo.organizacaoId,
            ativo: novo.ativo,
          },
        },
        tx,
      );

      return novo;
    });

    return {
      ...criado,
      apiKey,
    };
  }

  async listar(ator: AtorOperacao): Promise<EntidadeParceiro[]> {
    this.exigirAdmin(ator);
    return this.parceiroRepo.listarTodos();
  }

  async buscarPorId(ator: AtorOperacao, id: string): Promise<EntidadeParceiro> {
    this.exigirAdmin(ator);
    const encontrado = await this.parceiroRepo.buscarPorId(id);
    if (!encontrado) {
      throw new ErroNaoEncontrado(`Parceiro externo ${id} não encontrado.`);
    }
    return encontrado;
  }

  async atualizar(ator: AtorOperacao, input: AtualizarParceiroInput): Promise<EntidadeParceiro> {
    this.exigirAdmin(ator);

    const nome = input.nome !== undefined ? input.nome.trim() : undefined;
    if (nome !== undefined && !nome) {
      throw new ErroRegraDeNegocio('Nome do parceiro não pode ser vazio.', 'PARCEIRO_INVALIDO');
    }
    const permissoes =
      input.permissoes !== undefined ? validarPermissoes(input.permissoes) : undefined;

    return this.transacao.executar(async (tx) => {
      const antes = await this.parceiroRepo.buscarPorId(input.id, tx);
      if (!antes) {
        throw new ErroNaoEncontrado(`Parceiro externo ${input.id} não encontrado.`);
      }

      const atualizado = await this.parceiroRepo.atualizarComVersao(
        {
          id: input.id,
          versao: input.versao,
          nome,
          permissoes,
          organizacaoId: input.organizacaoId,
          ativo: input.ativo,
        },
        tx,
      );

      if (!atualizado) {
        throw new ErroConflitoDeVersao(
          'Conflito de versão ao atualizar parceiro externo. Recarregue e tente novamente.',
        );
      }

      await this.auditoriaRepo.registrar(
        {
          usuarioId: ator.id,
          acao: 'ATUALIZAR',
          entidade: 'ParceiroExterno',
          entidadeId: atualizado.id,
          antes: {
            nome: antes.nome,
            permissoes: antes.permissoes,
            organizacaoId: antes.organizacaoId,
            ativo: antes.ativo,
            versao: antes.versao,
          },
          depois: {
            nome: atualizado.nome,
            permissoes: atualizado.permissoes,
            organizacaoId: atualizado.organizacaoId,
            ativo: atualizado.ativo,
            versao: atualizado.versao,
          },
        },
        tx,
      );

      return atualizado;
    });
  }

  async revogar(ator: AtorOperacao, id: string): Promise<EntidadeParceiro> {
    this.exigirAdmin(ator);

    return this.transacao.executar(async (tx) => {
      const antes = await this.parceiroRepo.buscarPorId(id, tx);
      if (!antes) {
        throw new ErroNaoEncontrado(`Parceiro externo ${id} não encontrado.`);
      }

      const revogado = await this.parceiroRepo.desativar(id, tx);
      if (!revogado) {
        throw new ErroNaoEncontrado(`Parceiro externo ${id} não encontrado.`);
      }

      await this.auditoriaRepo.registrar(
        {
          usuarioId: ator.id,
          acao: 'REVOGAR',
          entidade: 'ParceiroExterno',
          entidadeId: revogado.id,
          antes: { ativo: antes.ativo, versao: antes.versao },
          depois: { ativo: revogado.ativo, versao: revogado.versao },
        },
        tx,
      );

      return revogado;
    });
  }
}
