import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { ErroNaoAutenticado, ErroSemPermissao } from '../domain/index.js';
import type { ParceiroRepository, PermissaoParceiro } from '../modules/parceiro/parceiro.repository.js';
import { calcularHashApiKey } from '../modules/parceiro/parceiro.service.js';

export interface ParceiroAutenticado {
  id: string;
  nome: string;
  permissoes: string[];
  organizacaoId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    parceiro?: ParceiroAutenticado;
  }
}

export function extrairApiKeyHeader(request: FastifyRequest): string | null {
  const bruto = request.headers['x-api-key'];
  if (typeof bruto === 'string' && bruto.trim() !== '') {
    return bruto.trim();
  }
  return null;
}

/**
 * Registra o hook de autenticação por API Key (`X-Api-Key`) no escopo da API Pública.
 * Valida o hash SHA-256 da chave contra `parceiros_externos` ativos e injeta `request.parceiro`.
 */
export function registrarAutenticacaoApiKey(
  app: FastifyInstance,
  parceiroRepo: ParceiroRepository,
): void {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const apiKey = extrairApiKeyHeader(request);
    if (!apiKey) {
      throw new ErroNaoAutenticado('Chave de API inválida ou inativa');
    }

    const hash = calcularHashApiKey(apiKey);
    const parceiro = await parceiroRepo.buscarAtivoPorApiKeyHash(hash);
    if (!parceiro) {
      throw new ErroNaoAutenticado('Chave de API inválida ou inativa');
    }

    request.parceiro = {
      id: parceiro.id,
      nome: parceiro.nome,
      permissoes: parceiro.permissoes,
      organizacaoId: parceiro.organizacaoId,
    };
  });
}

export function exigirPermissaoParceiro(permissao: PermissaoParceiro) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.parceiro) {
      throw new ErroNaoAutenticado('Chave de API inválida ou inativa');
    }
    if (!request.parceiro.permissoes.includes(permissao)) {
      throw new ErroSemPermissao(
        `Parceiro não possui a permissão necessária: ${permissao}.`,
      );
    }
  };
}

export function obterParceiroRequisicao(request: FastifyRequest): ParceiroAutenticado {
  if (!request.parceiro) {
    throw new ErroNaoAutenticado('Chave de API inválida ou inativa');
  }
  return request.parceiro;
}

/**
 * Configuração de rate limit por chave de API (X-Api-Key) para as rotas públicas.
 * Usa o valor de `x-api-key` como keyGenerator (com fallback para IP).
 */
export function criarConfigRateLimitApiKey() {
  return {
    rateLimit: {
      max: env.API_KEY_RATE_LIMIT_MAX,
      timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest): string => {
        const chave = extrairApiKeyHeader(request);
        return chave ?? request.ip;
      },
    },
  };
}
