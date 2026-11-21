import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { Papel } from '../../domain/index.js';
import { exigirPapel, obterUsuarioRequisicao } from '../../plugins/auth.js';
import { type EntidadeParceiro, PermissaoParceiro } from './parceiro.repository.js';
import type { ParceiroCriadoComChave, ParceiroService } from './parceiro.service.js';

const PermissaoSchema = Type.Union(
  [
    Type.Literal(PermissaoParceiro.LEITURA_RASTREABILIDADE),
    Type.Literal(PermissaoParceiro.LEITURA_LOTES),
    Type.Literal(PermissaoParceiro.ESCRITA_LOTES),
  ],
  {
    title: 'PermissaoParceiro',
    description: 'Permissão concedida a um parceiro externo da API pública.',
  },
);

const ParceiroParamsSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid', title: 'ID do parceiro', description: 'UUID do parceiro externo.' }),
  },
  {
    title: 'ParceiroParams',
    description: 'Parâmetros de rota com o identificador do parceiro.',
  },
);

const CriarParceiroBodySchema = Type.Object(
  {
    nome: Type.String({
      minLength: 2,
      maxLength: 200,
      title: 'Nome do parceiro',
      description: 'Razão social ou identificação do parceiro integrador.',
    }),
    permissoes: Type.Array(PermissaoSchema, {
      minItems: 1,
      title: 'Permissões',
      description: 'Lista de permissões atribuídas à chave de API.',
    }),
    organizacaoId: Type.Optional(
      Type.Union([Type.String({ format: 'uuid' }), Type.Null()], {
        title: 'ID da organização',
        description: 'Organização vinculada ao parceiro (opcional; filtra escopo de lotes).',
      }),
    ),
  },
  {
    additionalProperties: false,
    title: 'CriarParceiroBody',
    description: 'Dados para cadastro de parceiro externo e geração de API Key.',
  },
);

const AtualizarParceiroBodySchema = Type.Object(
  {
    versao: Type.Integer({
      minimum: 1,
      title: 'Versão',
      description: 'Versão atual do registro para controle de concorrência otimista.',
    }),
    nome: Type.Optional(
      Type.String({
        minLength: 2,
        maxLength: 200,
        title: 'Nome',
        description: 'Novo nome do parceiro.',
      }),
    ),
    permissoes: Type.Optional(
      Type.Array(PermissaoSchema, {
        minItems: 1,
        title: 'Permissões',
        description: 'Novo conjunto de permissões.',
      }),
    ),
    organizacaoId: Type.Optional(
      Type.Union([Type.String({ format: 'uuid' }), Type.Null()], {
        title: 'ID da organização',
        description: 'Nova organização vinculada ou null.',
      }),
    ),
    ativo: Type.Optional(
      Type.Boolean({
        title: 'Ativo',
        description: 'Indica se a chave de API permanece ativa.',
      }),
    ),
  },
  {
    additionalProperties: false,
    title: 'AtualizarParceiroBody',
    description: 'Dados para atualização de permissões ou status do parceiro externo.',
  },
);

const ParceiroResponseSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid', title: 'ID', description: 'UUID do parceiro.' }),
    nome: Type.String({ title: 'Nome', description: 'Nome do parceiro.' }),
    apiKeyPrefixo: Type.String({
      title: 'Prefixo da API Key',
      description: 'Prefixo visível da chave para identificação sem expor o segredo.',
    }),
    permissoes: Type.Array(Type.String(), { title: 'Permissões', description: 'Permissões ativas.' }),
    organizacaoId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()], {
      title: 'Organização vinculada',
      description: 'UUID da organização associada ou null.',
    }),
    ativo: Type.Boolean({ title: 'Ativo', description: 'Status de ativação da chave.' }),
    versao: Type.Integer({ title: 'Versão', description: 'Versão de controle otimista.' }),
    criadoEm: Type.String({ format: 'date-time', title: 'Criado em', description: 'Data/hora de criação.' }),
  },
  {
    title: 'ParceiroResponse',
    description: 'Representação segura do parceiro externo (sem hash ou segredo).',
  },
);

const ParceiroCriadoResponseSchema = Type.Intersect(
  [
    ParceiroResponseSchema,
    Type.Object({
      apiKey: Type.String({
        title: 'API Key',
        description: 'Chave em texto puro exibida UMA única vez no momento da criação.',
      }),
    }),
  ],
  {
    title: 'ParceiroCriadoResponse',
    description: 'Parceiro recém-criado incluindo a apiKey gerada.',
  },
);

function serializarParceiro(p: EntidadeParceiro) {
  return {
    id: p.id,
    nome: p.nome,
    apiKeyPrefixo: p.apiKeyPrefixo,
    permissoes: p.permissoes,
    organizacaoId: p.organizacaoId,
    ativo: p.ativo,
    versao: p.versao,
    criadoEm: p.criadoEm.toISOString(),
  };
}

function serializarParceiroCriado(p: ParceiroCriadoComChave) {
  return {
    ...serializarParceiro(p),
    apiKey: p.apiKey,
  };
}

/**
 * Rotas internas de gestão de parceiros externos (exclusivo ADMIN).
 */
export function registrarRotasParceiro(
  app: FastifyInstance,
  parceiroService: ParceiroService,
): void {
  const servidor = app.withTypeProvider<TypeBoxTypeProvider>();
  const somenteAdmin = [Papel.ADMIN] as const;

  servidor.post(
    '/parceiros',
    {
      preHandler: [exigirPapel(somenteAdmin)],
      schema: {
        tags: ['Parceiros'],
        summary: 'Cadastra um parceiro externo e gera sua API Key (exclusivo ADMIN)',
        description:
          'Gera uma chave no formato greencode_<uuid>. O segredo é retornado apenas nesta resposta; no banco é salvo somente o hash SHA-256.',
        body: CriarParceiroBodySchema,
        response: {
          201: ParceiroCriadoResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ator = obterUsuarioRequisicao(request);
      const criado = await parceiroService.criar(ator, {
        nome: request.body.nome,
        permissoes: request.body.permissoes,
        organizacaoId: request.body.organizacaoId,
      });
      return reply.status(201).send(serializarParceiroCriado(criado));
    },
  );

  servidor.get(
    '/parceiros',
    {
      preHandler: [exigirPapel(somenteAdmin)],
      schema: {
        tags: ['Parceiros'],
        summary: 'Lista todos os parceiros externos cadastrados (exclusivo ADMIN)',
        response: {
          200: Type.Array(ParceiroResponseSchema, {
            title: 'ListaParceirosResponse',
            description: 'Lista de parceiros externos.',
          }),
        },
      },
    },
    async (request, reply) => {
      const ator = obterUsuarioRequisicao(request);
      const itens = await parceiroService.listar(ator);
      return reply.status(200).send(itens.map(serializarParceiro));
    },
  );

  servidor.get(
    '/parceiros/:id',
    {
      preHandler: [exigirPapel(somenteAdmin)],
      schema: {
        tags: ['Parceiros'],
        summary: 'Obtém detalhes de um parceiro externo (exclusivo ADMIN)',
        params: ParceiroParamsSchema,
        response: {
          200: ParceiroResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ator = obterUsuarioRequisicao(request);
      const item = await parceiroService.buscarPorId(ator, request.params.id);
      return reply.status(200).send(serializarParceiro(item));
    },
  );

  servidor.patch(
    '/parceiros/:id',
    {
      preHandler: [exigirPapel(somenteAdmin)],
      schema: {
        tags: ['Parceiros'],
        summary: 'Atualiza nome, permissões ou status de um parceiro externo (exclusivo ADMIN)',
        params: ParceiroParamsSchema,
        body: AtualizarParceiroBodySchema,
        response: {
          200: ParceiroResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ator = obterUsuarioRequisicao(request);
      const atualizado = await parceiroService.atualizar(ator, {
        id: request.params.id,
        versao: request.body.versao,
        nome: request.body.nome,
        permissoes: request.body.permissoes,
        organizacaoId: request.body.organizacaoId,
        ativo: request.body.ativo,
      });
      return reply.status(200).send(serializarParceiro(atualizado));
    },
  );

  servidor.delete(
    '/parceiros/:id',
    {
      preHandler: [exigirPapel(somenteAdmin)],
      schema: {
        tags: ['Parceiros'],
        summary: 'Revoga (desativa) a chave de API de um parceiro externo (exclusivo ADMIN)',
        params: ParceiroParamsSchema,
        response: {
          200: ParceiroResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ator = obterUsuarioRequisicao(request);
      const revogado = await parceiroService.revogar(ator, request.params.id);
      return reply.status(200).send(serializarParceiro(revogado));
    },
  );
}
