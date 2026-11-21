/**
 * Validação e carregamento das variáveis de ambiente.
 * Falha com mensagem clara listando o que falta.
 */

import 'dotenv/config';

interface Env {
  PORT: number;
  HOST: string;
  NODE_ENV: 'development' | 'production' | 'test';
  DATABASE_URL: string;
  DATABASE_URL_TEST: string;
  JWT_SECRET: string;
  JWT_EXPIRA_EM: string;
  BCRYPT_ROUNDS: number;
  CORS_ORIGENS: string[];
  TZ_NEGOCIO: string;
  LOG_MAX_SIZE: string;
  LOG_LEVEL: string;
  AUDITORIA_RETENCAO_DIAS: number;
  SHUTDOWN_TIMEOUT_MS: number;
  // AV3
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD: string;
  WORKER_HABILITADO: boolean;
  WORKER_CONCORRENCIA: number;
  CRON_ANALITICO: string;
  CRON_HABILITADO: boolean;
  API_KEY_PREFIX: string;
  API_KEY_RATE_LIMIT_MAX: number;
}

function optionalBoolean(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (!val || val.trim() === '') return defaultValue;
  return ['true', '1', 'sim', 'yes'].includes(val.trim().toLowerCase());
}

function requiredString(key: string): string {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  }
  return val.trim();
}

function optionalString(key: string, defaultValue: string): string {
  const val = process.env[key];
  return val && val.trim() !== '' ? val.trim() : defaultValue;
}

function requiredInt(key: string, defaultValue?: number): number {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  }
  const parsed = parseInt(val.trim(), 10);
  if (isNaN(parsed)) {
    throw new Error(`Variável de ambiente inválida (esperado inteiro): ${key}=${val}`);
  }
  return parsed;
}

function loadEnv(): Env {
  const errors: string[] = [];
  const results: Partial<Env> = {};

  // NODE_ENV
  const nodeEnv = optionalString('NODE_ENV', 'development');
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    errors.push(`NODE_ENV deve ser development, production ou test. Recebido: ${nodeEnv}`);
  } else {
    results.NODE_ENV = nodeEnv as Env['NODE_ENV'];
  }

  // DATABASE_URL — obrigatória
  try {
    results.DATABASE_URL = requiredString('DATABASE_URL');
  } catch {
    errors.push('DATABASE_URL: string de conexão do banco principal (ex: postgresql://user:pass@localhost:5432/greencode)');
  }

  // DATABASE_URL_TEST — obrigatória apenas em test
  results.DATABASE_URL_TEST = optionalString('DATABASE_URL_TEST', '');

  // JWT_SECRET — obrigatório, mínimo 32 chars
  try {
    const secret = requiredString('JWT_SECRET');
    if (secret.length < 32) {
      errors.push(`JWT_SECRET deve ter no mínimo 32 caracteres (tem ${secret.length})`);
    } else {
      results.JWT_SECRET = secret;
    }
  } catch {
    errors.push('JWT_SECRET: segredo JWT com mínimo 32 caracteres');
  }

  results.JWT_EXPIRA_EM = optionalString('JWT_EXPIRA_EM', '30m');
  results.BCRYPT_ROUNDS = requiredInt('BCRYPT_ROUNDS', 12);
  if (results.BCRYPT_ROUNDS < 10) {
    errors.push(`BCRYPT_ROUNDS deve ser no mínimo 10 (tem ${results.BCRYPT_ROUNDS})`);
  }

  // CORS_ORIGENS — opcional (lista separada por vírgula)
  const corsRaw = optionalString('CORS_ORIGENS', '');
  results.CORS_ORIGENS = corsRaw
    ? corsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  results.TZ_NEGOCIO = optionalString('TZ_NEGOCIO', 'America/Sao_Paulo');
  results.LOG_MAX_SIZE = optionalString('LOG_MAX_SIZE', '10m');
  results.LOG_LEVEL = optionalString('LOG_LEVEL', 'info');

  results.AUDITORIA_RETENCAO_DIAS = requiredInt('AUDITORIA_RETENCAO_DIAS', 180);
  if (results.AUDITORIA_RETENCAO_DIAS < 180) {
    errors.push(`AUDITORIA_RETENCAO_DIAS deve ser no mínimo 180 (tem ${results.AUDITORIA_RETENCAO_DIAS})`);
  }

  results.SHUTDOWN_TIMEOUT_MS = requiredInt('SHUTDOWN_TIMEOUT_MS', 10000);
  results.PORT = requiredInt('PORT', 3000);
  results.HOST = optionalString('HOST', '0.0.0.0');

  // --- AV3: Redis, worker, cron e API pública ---
  const emTeste = results.NODE_ENV === 'test';
  results.REDIS_HOST = optionalString('REDIS_HOST', 'localhost');
  results.REDIS_PORT = requiredInt('REDIS_PORT', 6379);
  results.REDIS_PASSWORD = optionalString('REDIS_PASSWORD', '');
  results.WORKER_HABILITADO = optionalBoolean('WORKER_HABILITADO', !emTeste);
  results.WORKER_CONCORRENCIA = requiredInt('WORKER_CONCORRENCIA', 2);
  if (results.WORKER_CONCORRENCIA < 1) {
    errors.push(`WORKER_CONCORRENCIA deve ser no mínimo 1 (tem ${results.WORKER_CONCORRENCIA})`);
  }
  results.CRON_ANALITICO = optionalString('CRON_ANALITICO', '0 2 * * *');
  results.CRON_HABILITADO = optionalBoolean('CRON_HABILITADO', !emTeste);
  results.API_KEY_PREFIX = optionalString('API_KEY_PREFIX', 'greencode_');
  results.API_KEY_RATE_LIMIT_MAX = requiredInt('API_KEY_RATE_LIMIT_MAX', 100);
  if (results.API_KEY_RATE_LIMIT_MAX < 1) {
    errors.push(`API_KEY_RATE_LIMIT_MAX deve ser no mínimo 1 (tem ${results.API_KEY_RATE_LIMIT_MAX})`);
  }

  if (errors.length > 0) {
    const msg = [
      '❌ greencode: falha na validação das variáveis de ambiente.',
      'Verifique seu arquivo .env (copie de .env.example):',
      ...errors.map((e) => `  • ${e}`),
    ].join('\n');
    throw new Error(msg);
  }

  return results as Env;
}

export const env = loadEnv();
