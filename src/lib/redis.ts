import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/** Opções de conexão compatíveis com ioredis e BullMQ. */
export function obterOpcoesConexaoRedis(): ConnectionOptions {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    maxRetriesPerRequest: null,
  };
}

/**
 * Cliente Redis compartilhado (lazyConnect = true para não abrir socket
 * automaticamente durante testes unitários que não usam Redis).
 */
export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

/** Fábrica de filas BullMQ com política padrão de retry exponencial (1s, 2s, 4s). */
export function criarFila(nome: string): Queue {
  return new Queue(nome, {
    connection: obterOpcoesConexaoRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
}
