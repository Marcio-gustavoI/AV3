import 'dotenv/config';
import type { Worker } from 'bullmq';
import type { ScheduledTask } from 'node-cron';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { iniciarCronAnalitico } from './jobs/cron.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { PrismaAnaliticoRepository } from './modules/analitico/analitico.repository.js';
import { AnaliticoService } from './modules/analitico/analitico.service.js';
import { PrismaJobRepository } from './modules/job/job.repository.js';
import type { PayloadFilaRelatorio } from './modules/job/job.service.js';
import { PrismaParametroRepository } from './modules/parametro/parametro.repository.js';
import { iniciarWorkerRelatorio } from './workers/relatorio.worker.js';

async function start(): Promise<void> {
  const app = await buildApp();

  let workerRelatorio: Worker<PayloadFilaRelatorio> | null = null;
  let cronAnalitico: ScheduledTask | null = null;

  // Graceful shutdown (A2-05 + encerramento limpo de Worker BullMQ e Cron da AV3)
  let isShuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      logger.warn({ signal }, 'Segundo sinal recebido — forçando saída imediata');
      process.exit(1);
    }
    isShuttingDown = true;
    logger.info({ signal }, 'Sinal de encerramento recebido. Iniciando graceful shutdown...');

    const timeout = setTimeout(() => {
      logger.fatal('Timeout de shutdown atingido. Forçando saída.');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);

    try {
      if (cronAnalitico) {
        cronAnalitico.stop();
        cronAnalitico = null;
      }
      if (workerRelatorio) {
        await workerRelatorio.close();
        workerRelatorio = null;
      }
      await app.close();
      await prisma.$disconnect();
      logger.info('Servidor e conexões encerrados com sucesso.');
      clearTimeout(timeout);
      process.exit(0);
    } catch (err) {
      logger.fatal({ err }, 'Erro durante o shutdown.');
      clearTimeout(timeout);
      process.exit(1);
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  if (process.platform === 'win32') {
    process.on('SIGBREAK', () => void shutdown('SIGBREAK'));
  }

  // Suporte adicional para sinal enviado via IPC em testes automatizados no Windows
  process.on('message', (msg) => {
    if (msg === 'SIGINT' || msg === 'SIGTERM') {
      void shutdown(msg);
    } else if (
      typeof msg === 'object' &&
      msg !== null &&
      'tipo' in msg &&
      (msg as { tipo?: unknown }).tipo === 'GREENCODE_SHUTDOWN_TEST'
    ) {
      const sinal =
        'signal' in msg && typeof (msg as { signal?: unknown }).signal === 'string'
          ? (msg as { signal: string }).signal
          : 'SIGINT';
      void shutdown(sinal);
    }
  });

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info(`🚀 greencode rodando em http://${env.HOST}:${env.PORT}`);
    logger.info(`📖 Documentação: http://${env.HOST}:${env.PORT}/docs`);

    // Inicialização de Worker BullMQ e Cron Analítico após o servidor subir (AV3)
    const analiticoService = new AnaliticoService(
      new PrismaAnaliticoRepository(prisma),
      new PrismaParametroRepository(prisma),
    );

    if (env.WORKER_HABILITADO) {
      workerRelatorio = iniciarWorkerRelatorio({
        jobRepo: new PrismaJobRepository(prisma),
        analiticoService,
      });
      logger.info('⚙️ Worker BullMQ (fila relatorio) iniciado.');
    }

    if (env.CRON_HABILITADO) {
      cronAnalitico = iniciarCronAnalitico(analiticoService, env.CRON_ANALITICO);
    }

    if (typeof process.send === 'function') {
      process.send('PRONTO');
    }
  } catch (err) {
    logger.fatal({ err }, 'Falha ao iniciar o servidor');
    process.exit(1);
  }
}

void start();
