import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { AnaliticoService } from '../modules/analitico/analitico.service.js';

/**
 * Agenda a execução recorrente das 3 análises (eficiência, rentabilidade e vida útil)
 * usando `node-cron` (AV3, Pilar 1).
 * Expressão padrão: `"0 2 * * *"` (todo dia às 02:00 no fuso `TZ_NEGOCIO`).
 */
export function iniciarCronAnalitico(
  analiticoService: AnaliticoService,
  expressao: string = env.CRON_ANALITICO,
): ScheduledTask {
  if (!cron.validate(expressao)) {
    throw new Error(`Expressão CRON_ANALITICO inválida: "${expressao}".`);
  }

  const tarefa = cron.schedule(
    expressao,
    () => {
      logger.info({ expressao }, 'Executando rotina agendada de cálculos analíticos...');
      void analiticoService
        .executarTodasAnalises()
        .then(() => {
          logger.info('Rotina agendada de cálculos analíticos concluída e persistida.');
        })
        .catch((err: unknown) => {
          logger.error({ err }, 'Falha na rotina agendada de cálculos analíticos.');
        });
    },
    {
      timezone: env.TZ_NEGOCIO,
    },
  );

  logger.info(
    { expressao, timezone: env.TZ_NEGOCIO },
    'Agendamento cron analítico iniciado.',
  );

  return tarefa;
}
