import type { Prisma, PrismaClient } from '@prisma/client';

/** Permissões reconhecidas para parceiros externos da API Pública (AV3, Pilar 2). */
export const PermissaoParceiro = {
  LEITURA_RASTREABILIDADE: 'LEITURA_RASTREABILIDADE',
  LEITURA_LOTES: 'LEITURA_LOTES',
  ESCRITA_LOTES: 'ESCRITA_LOTES',
} as const;
export type PermissaoParceiro = (typeof PermissaoParceiro)[keyof typeof PermissaoParceiro];

export const PERMISSOES_PARCEIRO_VALIDAS: readonly PermissaoParceiro[] = [
  PermissaoParceiro.LEITURA_RASTREABILIDADE,
  PermissaoParceiro.LEITURA_LOTES,
  PermissaoParceiro.ESCRITA_LOTES,
];

export interface EntidadeParceiro {
  id: string;
  nome: string;
  apiKeyPrefixo: string;
  permissoes: string[];
  organizacaoId: string | null;
  ativo: boolean;
  versao: number;
  criadoEm: Date;
}

export interface EntidadeParceiroComHash extends EntidadeParceiro {
  apiKeyHash: string;
}

export interface CriarParceiroRepoInput {
  nome: string;
  apiKeyHash: string;
  apiKeyPrefixo: string;
  permissoes: string[];
  organizacaoId?: string | null | undefined;
}

export interface AtualizarParceiroRepoInput {
  id: string;
  versao: number;
  nome?: string | undefined;
  permissoes?: string[] | undefined;
  organizacaoId?: string | null | undefined;
  ativo?: boolean | undefined;
}

export interface ParceiroRepository {
  criar(dados: CriarParceiroRepoInput, tx?: unknown): Promise<EntidadeParceiro>;
  listarTodos(): Promise<EntidadeParceiro[]>;
  buscarPorId(id: string, tx?: unknown): Promise<EntidadeParceiro | null>;
  buscarAtivoPorApiKeyHash(apiKeyHash: string): Promise<EntidadeParceiro | null>;
  atualizarComVersao(
    dados: AtualizarParceiroRepoInput,
    tx?: unknown,
  ): Promise<EntidadeParceiro | null>;
  desativar(id: string, tx?: unknown): Promise<EntidadeParceiro | null>;
}

type DbClient = PrismaClient | Prisma.TransactionClient;

const SELECT_SEGURO = {
  id: true,
  nome: true,
  apiKeyPrefixo: true,
  permissoes: true,
  organizacaoId: true,
  ativo: true,
  versao: true,
  criadoEm: true,
} as const;

export class PrismaParceiroRepository implements ParceiroRepository {
  constructor(private readonly prismaClient: PrismaClient) {}

  private client(tx?: unknown): DbClient {
    return (tx as Prisma.TransactionClient | undefined) ?? this.prismaClient;
  }

  async criar(dados: CriarParceiroRepoInput, tx?: unknown): Promise<EntidadeParceiro> {
    const db = this.client(tx);
    return db.parceiroExterno.create({
      data: {
        nome: dados.nome,
        apiKeyHash: dados.apiKeyHash,
        apiKeyPrefixo: dados.apiKeyPrefixo,
        permissoes: dados.permissoes,
        organizacaoId: dados.organizacaoId ?? null,
        ativo: true,
        versao: 1,
      },
      select: SELECT_SEGURO,
    });
  }

  async listarTodos(): Promise<EntidadeParceiro[]> {
    return this.prismaClient.parceiroExterno.findMany({
      orderBy: { criadoEm: 'desc' },
      select: SELECT_SEGURO,
    });
  }

  async buscarPorId(id: string, tx?: unknown): Promise<EntidadeParceiro | null> {
    const db = this.client(tx);
    return db.parceiroExterno.findUnique({
      where: { id },
      select: SELECT_SEGURO,
    });
  }

  async buscarAtivoPorApiKeyHash(apiKeyHash: string): Promise<EntidadeParceiro | null> {
    return this.prismaClient.parceiroExterno.findFirst({
      where: { apiKeyHash, ativo: true },
      select: SELECT_SEGURO,
    });
  }

  async atualizarComVersao(
    dados: AtualizarParceiroRepoInput,
    tx?: unknown,
  ): Promise<EntidadeParceiro | null> {
    const db = this.client(tx);
    const res = await db.parceiroExterno.updateMany({
      where: { id: dados.id, versao: dados.versao },
      data: {
        ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
        ...(dados.permissoes !== undefined ? { permissoes: dados.permissoes } : {}),
        ...(dados.organizacaoId !== undefined ? { organizacaoId: dados.organizacaoId } : {}),
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
        versao: { increment: 1 },
      },
    });
    if (res.count === 0) {
      return null;
    }
    return db.parceiroExterno.findUnique({
      where: { id: dados.id },
      select: SELECT_SEGURO,
    });
  }

  async desativar(id: string, tx?: unknown): Promise<EntidadeParceiro | null> {
    const db = this.client(tx);
    const existente = await db.parceiroExterno.findUnique({ where: { id }, select: { id: true } });
    if (!existente) {
      return null;
    }
    return db.parceiroExterno.update({
      where: { id },
      data: { ativo: false, versao: { increment: 1 } },
      select: SELECT_SEGURO,
    });
  }
}

/** Implementação em memória para testes unitários. */
export class MemoriaParceiroRepository implements ParceiroRepository {
  public readonly itens = new Map<string, EntidadeParceiroComHash>();

  private semHash(item: EntidadeParceiroComHash): EntidadeParceiro {
    return {
      id: item.id,
      nome: item.nome,
      apiKeyPrefixo: item.apiKeyPrefixo,
      permissoes: [...item.permissoes],
      organizacaoId: item.organizacaoId,
      ativo: item.ativo,
      versao: item.versao,
      criadoEm: item.criadoEm,
    };
  }

  async criar(dados: CriarParceiroRepoInput): Promise<EntidadeParceiro> {
    const novo: EntidadeParceiroComHash = {
      id: crypto.randomUUID(),
      nome: dados.nome,
      apiKeyHash: dados.apiKeyHash,
      apiKeyPrefixo: dados.apiKeyPrefixo,
      permissoes: [...dados.permissoes],
      organizacaoId: dados.organizacaoId ?? null,
      ativo: true,
      versao: 1,
      criadoEm: new Date(),
    };
    this.itens.set(novo.id, novo);
    return this.semHash(novo);
  }

  async listarTodos(): Promise<EntidadeParceiro[]> {
    return Array.from(this.itens.values()).map((i) => this.semHash(i));
  }

  async buscarPorId(id: string): Promise<EntidadeParceiro | null> {
    const item = this.itens.get(id);
    return item ? this.semHash(item) : null;
  }

  async buscarAtivoPorApiKeyHash(apiKeyHash: string): Promise<EntidadeParceiro | null> {
    for (const item of this.itens.values()) {
      if (item.apiKeyHash === apiKeyHash && item.ativo) {
        return this.semHash(item);
      }
    }
    return null;
  }

  async atualizarComVersao(dados: AtualizarParceiroRepoInput): Promise<EntidadeParceiro | null> {
    const atual = this.itens.get(dados.id);
    if (!atual || atual.versao !== dados.versao) {
      return null;
    }
    const atualizado: EntidadeParceiroComHash = {
      ...atual,
      nome: dados.nome ?? atual.nome,
      permissoes: dados.permissoes ? [...dados.permissoes] : atual.permissoes,
      organizacaoId: dados.organizacaoId !== undefined ? dados.organizacaoId : atual.organizacaoId,
      ativo: dados.ativo ?? atual.ativo,
      versao: atual.versao + 1,
    };
    this.itens.set(dados.id, atualizado);
    return this.semHash(atualizado);
  }

  async desativar(id: string): Promise<EntidadeParceiro | null> {
    const atual = this.itens.get(id);
    if (!atual) {
      return null;
    }
    const atualizado: EntidadeParceiroComHash = {
      ...atual,
      ativo: false,
      versao: atual.versao + 1,
    };
    this.itens.set(id, atualizado);
    return this.semHash(atualizado);
  }
}
