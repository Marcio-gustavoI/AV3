import Fastify from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { type Relogio, RelogioReal } from './domain/index.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { criarFila } from './lib/redis.js';
import { registrarRotasAnalitico } from './modules/analitico/analitico.controller.js';
import { PrismaAnaliticoRepository } from './modules/analitico/analitico.repository.js';
import { AnaliticoService } from './modules/analitico/analitico.service.js';
import { registrarRotasAuditoria } from './modules/auditoria/auditoria.controller.js';
import {
  PrismaAuditoriaRepository,
  PrismaGerenciadorTransacao,
} from './modules/auditoria/auditoria.repository.js';
import { AuditoriaService } from './modules/auditoria/auditoria.service.js';
import { registrarRotasAuth } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import { registrarRotasContrato } from './modules/contrato/contrato.controller.js';
import { PrismaContratoRepository } from './modules/contrato/contrato.repository.js';
import { ContratoService } from './modules/contrato/contrato.service.js';
import { registrarRotasEquipamento } from './modules/equipamento/equipamento.controller.js';
import { PrismaEquipamentoRepository } from './modules/equipamento/equipamento.repository.js';
import { EquipamentoService } from './modules/equipamento/equipamento.service.js';
import { registrarRotasJob } from './modules/job/job.controller.js';
import { PrismaJobRepository } from './modules/job/job.repository.js';
import {
  JobService,
  PublicadorFilaBullMQ,
  type PublicadorFilaRelatorio,
} from './modules/job/job.service.js';
import { registrarRotasLote } from './modules/lote/lote.controller.js';
import { PrismaLoteRepository } from './modules/lote/lote.repository.js';
import { LoteService } from './modules/lote/lote.service.js';
import { registrarRotasMovimentacao } from './modules/movimentacao/movimentacao.controller.js';
import { PrismaMovimentacaoRepository } from './modules/movimentacao/movimentacao.repository.js';
import { MovimentacaoService } from './modules/movimentacao/movimentacao.service.js';
import { registrarRotasOrganizacao } from './modules/organizacao/organizacao.controller.js';
import { PrismaOrganizacaoRepository } from './modules/organizacao/organizacao.repository.js';
import { OrganizacaoService } from './modules/organizacao/organizacao.service.js';
import { registrarRotasParametro } from './modules/parametro/parametro.controller.js';
import { PrismaParametroRepository } from './modules/parametro/parametro.repository.js';
import { ParametroService } from './modules/parametro/parametro.service.js';
import { registrarRotasParceiro } from './modules/parceiro/parceiro.controller.js';
import { PrismaParceiroRepository } from './modules/parceiro/parceiro.repository.js';
import { ParceiroService } from './modules/parceiro/parceiro.service.js';
import { registrarRotasPublicas } from './modules/public/public.controller.js';
import { PublicService } from './modules/public/public.service.js';
import { registrarRotasRelatorio } from './modules/relatorio/relatorio.controller.js';
import { PrismaRelatorioRepository } from './modules/relatorio/relatorio.repository.js';
import { RelatorioService } from './modules/relatorio/relatorio.service.js';
import { registrarRotasUsuario } from './modules/usuario/usuario.controller.js';
import { PrismaUsuarioRepository } from './modules/usuario/usuario.repository.js';
import { UsuarioService } from './modules/usuario/usuario.service.js';
import { registrarHookAutenticacao } from './plugins/auth.js';
import { registrarErrorHandler } from './plugins/error-handler.js';
import { registrarSwagger } from './plugins/swagger.js';
import { NOME_FILA_RELATORIO } from './workers/relatorio.worker.js';

export interface OpcoesBuildApp {
  relogio?: Relogio | undefined;
  corsOrigens?: string[] | undefined;
  publicadorFila?: PublicadorFilaRelatorio | undefined;
}

export async function buildApp(opcoes?: OpcoesBuildApp) {
  const app = Fastify({
    logger: false, // usamos nosso próprio logger pino
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Hook de log de requisições
  app.addHook('onRequest', async (request) => {
    logger.info(
      { reqId: request.id, method: request.method, url: request.url },
      'request recebida',
    );
  });

  app.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        reqId: request.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
        usuarioId: request.usuario?.id,
      },
      'request concluída',
    );
  });

  // Segurança HTTP
  await app.register(helmet, {
    contentSecurityPolicy: false, // desabilitado para o Swagger
  });

  // CORS configurável por env (A2-20)
  const origensPermitidas = opcoes?.corsOrigens ?? env.CORS_ORIGENS;
  await app.register(cors, {
    origin: origensPermitidas.length > 0 ? origensPermitidas : false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
  });

  // Rate limit (habilitado por rota, ex.: POST /api/v1/auth/login)
  await app.register(rateLimit, {
    global: false,
  });

  // JWT
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_EXPIRA_EM,
    },
  });

  // Documentação OpenAPI / Swagger em /docs
  await registrarSwagger(app);

  // Error handler e not found
  registrarErrorHandler(app);

  // Hook global de autenticação
  registrarHookAutenticacao(app);

  // Rota pública de saúde (sem prefixo /api/v1)
  app.get(
    '/saude',
    {
      schema: {
        tags: ['Sistema'],
        summary: 'Verifica saúde do servidor',
        security: [],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              versao: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        versao: '1.0.0',
      });
    },
  );

  // Instanciação das dependências (Repositórios + Services)
  const relogio = opcoes?.relogio ?? new RelogioReal();
  const transacao = new PrismaGerenciadorTransacao(prisma);
  const auditoriaRepo = new PrismaAuditoriaRepository(prisma);
  const usuarioRepo = new PrismaUsuarioRepository(prisma);
  const parametroRepo = new PrismaParametroRepository(prisma);
  const organizacaoRepo = new PrismaOrganizacaoRepository(prisma);
  const contratoRepo = new PrismaContratoRepository(prisma);
  const loteRepo = new PrismaLoteRepository(prisma);
  const equipamentoRepo = new PrismaEquipamentoRepository(prisma);
  const movimentacaoRepo = new PrismaMovimentacaoRepository(prisma);
  const relatorioRepo = new PrismaRelatorioRepository(prisma);

  const authService = new AuthService(
    usuarioRepo,
    {
      assinar: (payload) =>
        app.jwt.sign(payload, {
          expiresIn: env.JWT_EXPIRA_EM,
        }),
    },
    env.JWT_EXPIRA_EM,
  );
  const usuarioService = new UsuarioService(
    usuarioRepo,
    auditoriaRepo,
    transacao,
    env.BCRYPT_ROUNDS,
  );
  const parametroService = new ParametroService(
    parametroRepo,
    auditoriaRepo,
    transacao,
  );
  const organizacaoService = new OrganizacaoService(
    organizacaoRepo,
    auditoriaRepo,
    transacao,
  );
  const contratoService = new ContratoService(
    contratoRepo,
    organizacaoRepo,
    auditoriaRepo,
    transacao,
  );
  const loteService = new LoteService(
    loteRepo,
    equipamentoRepo,
    organizacaoRepo,
    auditoriaRepo,
    transacao,
    relogio,
    env.TZ_NEGOCIO,
  );
  const equipamentoService = new EquipamentoService(
    equipamentoRepo,
    loteRepo,
    movimentacaoRepo,
    auditoriaRepo,
    transacao,
  );
  const movimentacaoService = new MovimentacaoService(
    equipamentoRepo,
    movimentacaoRepo,
    auditoriaRepo,
    transacao,
  );
  const auditoriaService = new AuditoriaService(auditoriaRepo);
  const relatorioService = new RelatorioService(relatorioRepo, parametroRepo);

  // Dependências AV3 (Camada Analítica, Parceiros, Jobs Assíncronos e API Pública)
  const analiticoRepo = new PrismaAnaliticoRepository(prisma);
  const analiticoService = new AnaliticoService(analiticoRepo, parametroRepo, relogio);
  const parceiroRepo = new PrismaParceiroRepository(prisma);
  const parceiroService = new ParceiroService(
    parceiroRepo,
    auditoriaRepo,
    transacao,
    env.API_KEY_PREFIX,
  );
  const jobRepo = new PrismaJobRepository(prisma);

  let filaRelatorio: ReturnType<typeof criarFila> | null = null;
  const publicadorFila: PublicadorFilaRelatorio = opcoes?.publicadorFila ?? {
    publicar: async (payload) => {
      if (!filaRelatorio) {
        filaRelatorio = criarFila(NOME_FILA_RELATORIO);
      }
      const bullPublisher = new PublicadorFilaBullMQ(filaRelatorio);
      await bullPublisher.publicar(payload);
    },
  };

  app.addHook('onClose', async () => {
    if (filaRelatorio) {
      await filaRelatorio.close();
      filaRelatorio = null;
    }
  });

  const jobService = new JobService(jobRepo, publicadorFila);
  const publicService = new PublicService(equipamentoRepo, loteService, jobService);

  // Registro das rotas /api/v1 (internas + novas AV3)
  await app.register(
    async (api) => {
      registrarRotasAuth(api, authService);
      registrarRotasUsuario(api, usuarioService);
      registrarRotasParametro(api, parametroService);
      registrarRotasOrganizacao(api, organizacaoService);
      registrarRotasContrato(api, contratoService);
      registrarRotasLote(api, loteService);
      registrarRotasEquipamento(api, equipamentoService);
      registrarRotasMovimentacao(api, movimentacaoService);
      registrarRotasRelatorio(api, relatorioService);
      registrarRotasAuditoria(api, auditoriaService);
      registrarRotasAnalitico(api, analiticoService);
      registrarRotasParceiro(api, parceiroService);
      registrarRotasJob(api, jobService);
    },
    { prefix: '/api/v1' },
  );

  // Registro das rotas da API Pública (/api/v1/public/* — X-Api-Key)
  await app.register(
    async (pub) => {
      registrarRotasPublicas(pub, publicService, parceiroRepo);
    },
    { prefix: '/api/v1/public' },
  );

  return app;
}
