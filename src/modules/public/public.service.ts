import {
  type EquipamentoLoteInput,
  ErroNaoEncontrado,
  ErroSemPermissao,
  Papel,
} from '../../domain/index.js';
import type { ParceiroAutenticado } from '../../plugins/api-key-auth.js';
import type { EquipamentoRepository } from '../equipamento/equipamento.repository.js';
import type { JobService, JobSubmetidoResposta, StatusJobResposta } from '../job/job.service.js';
import { TipoJobRelatorio } from '../job/job.repository.js';
import type { EntidadeLote } from '../lote/lote.repository.js';
import type { LoteService } from '../lote/lote.service.js';
import { PermissaoParceiro } from '../parceiro/parceiro.repository.js';

export interface RastreabilidadePublicaResposta {
  codigoBarras: string;
  tipo: string;
  status: string;
  estadoFisico: string;
  classificacaoDestino: string | null;
  ultimaMovimentacao: {
    data: string;
    statusAnterior: string;
    statusNovo: string;
  } | null;
}

export interface ListarLotesPublicoInput {
  page?: number | undefined;
  limit?: number | undefined;
  organizacaoId?: string | undefined;
}

export interface ListarLotesPublicoResposta {
  lotes: Array<{
    id: string;
    organizacaoId: string;
    notaFiscal: string;
    transportadora: string;
    dataEntrada: string;
    criadoEm: string;
  }>;
  total: number;
  page: number;
  limit: number;
}

export interface SubmeterLotePublicoInput {
  organizacaoId: string;
  notaFiscal: string;
  transportadora: string;
  dataEntrada: string;
  equipamentos: EquipamentoLoteInput[];
}

export interface LotePublicoCriadoResposta {
  loteId: string;
  equipamentosCriados: Array<{
    id: string;
    codigoBarrasInterno: string;
    tipo: string;
    status: string;
  }>;
}

/**
 * PublicService (AV3, Pilar 2):
 * - Fachada de negócio para a API Pública (`/api/v1/public/*`).
 * - Valida permissões do parceiro externo (defesa em profundidade) e escopo por organização.
 * - Delega operações para `EquipamentoRepository`, `LoteService` e `JobService`.
 */
export class PublicService {
  constructor(
    private readonly equipamentoRepo: EquipamentoRepository,
    private readonly loteService: LoteService,
    private readonly jobService: JobService,
  ) {}

  private exigirPermissao(parceiro: ParceiroAutenticado, permissao: PermissaoParceiro): void {
    if (!parceiro.permissoes.includes(permissao)) {
      throw new ErroSemPermissao(
        `Parceiro "${parceiro.nome}" não possui a permissão ${permissao}.`,
      );
    }
  }

  async consultarRastreabilidade(
    parceiro: ParceiroAutenticado,
    codigoBarras: string,
  ): Promise<RastreabilidadePublicaResposta> {
    this.exigirPermissao(parceiro, PermissaoParceiro.LEITURA_RASTREABILIDADE);

    const codigoNormalizado = codigoBarras.trim().toUpperCase();
    const equipamento = await this.equipamentoRepo.buscarPorCodigoBarras(codigoNormalizado);
    if (!equipamento) {
      throw new ErroNaoEncontrado(
        `Equipamento com código de barras "${codigoNormalizado}" não encontrado.`,
      );
    }

    const detalhe = await this.equipamentoRepo.buscarRastreabilidadePorId(equipamento.id);
    if (!detalhe) {
      throw new ErroNaoEncontrado(
        `Rastreabilidade do equipamento "${codigoNormalizado}" não encontrada.`,
      );
    }

    if (parceiro.organizacaoId && detalhe.organizacao.id !== parceiro.organizacaoId) {
      throw new ErroSemPermissao(
        'Parceiro não tem acesso a equipamentos de outra organização.',
      );
    }

    const ultima =
      detalhe.movimentacoes.length > 0
        ? detalhe.movimentacoes[detalhe.movimentacoes.length - 1]
        : undefined;

    return {
      codigoBarras: detalhe.equipamento.codigoBarrasInterno,
      tipo: detalhe.equipamento.tipo,
      status: detalhe.equipamento.status,
      estadoFisico: detalhe.equipamento.estadoFisico,
      classificacaoDestino: detalhe.equipamento.classificacaoDestino,
      ultimaMovimentacao: ultima
        ? {
            data: ultima.criadoEm.toISOString(),
            statusAnterior: ultima.statusAnterior,
            statusNovo: ultima.statusNovo,
          }
        : null,
    };
  }

  async listarLotes(
    parceiro: ParceiroAutenticado,
    input: ListarLotesPublicoInput,
  ): Promise<ListarLotesPublicoResposta> {
    this.exigirPermissao(parceiro, PermissaoParceiro.LEITURA_LOTES);

    if (
      parceiro.organizacaoId &&
      input.organizacaoId &&
      input.organizacaoId !== parceiro.organizacaoId
    ) {
      throw new ErroSemPermissao('Parceiro só pode consultar lotes da própria organização.');
    }

    const organizacaoFiltro = parceiro.organizacaoId ?? input.organizacaoId;
    const resultado = await this.loteService.listar(
      { id: '', papel: Papel.GESTOR_ALMOXARIFADO },
      {
        pagina: input.page ?? 1,
        tamanhoPagina: input.limit ?? 20,
        organizacaoId: organizacaoFiltro,
      },
    );

    return {
      lotes: resultado.dados.map((l: EntidadeLote) => ({
        id: l.id,
        organizacaoId: l.organizacaoId,
        notaFiscal: l.notaFiscal,
        transportadora: l.transportadora,
        dataEntrada: l.dataEntrada.toISOString().slice(0, 10),
        criadoEm: l.criadoEm.toISOString(),
      })),
      total: resultado.paginacao.total,
      page: resultado.paginacao.pagina,
      limit: resultado.paginacao.tamanhoPagina,
    };
  }

  async submeterLote(
    parceiro: ParceiroAutenticado,
    input: SubmeterLotePublicoInput,
  ): Promise<LotePublicoCriadoResposta> {
    this.exigirPermissao(parceiro, PermissaoParceiro.ESCRITA_LOTES);

    if (parceiro.organizacaoId && input.organizacaoId !== parceiro.organizacaoId) {
      throw new ErroSemPermissao('Parceiro só pode submeter lotes para a própria organização.');
    }

    const criado = await this.loteService.criar(
      { id: '', papel: Papel.GESTOR_ALMOXARIFADO },
      {
        organizacaoId: input.organizacaoId,
        notaFiscal: input.notaFiscal,
        transportadora: input.transportadora,
        dataEntrada: input.dataEntrada,
        equipamentos: input.equipamentos,
      },
    );

    return {
      loteId: criado.id,
      equipamentosCriados: criado.equipamentos.map((eq) => ({
        id: eq.id,
        codigoBarrasInterno: eq.codigoBarrasInterno,
        tipo: eq.tipo,
        status: eq.status,
      })),
    };
  }

  async solicitarRelatorio(
    parceiro: ParceiroAutenticado,
    tipo: string,
    parametros?: Record<string, unknown> | null,
  ): Promise<JobSubmetidoResposta> {
    this.exigirPermissao(parceiro, PermissaoParceiro.LEITURA_RASTREABILIDADE);
    return this.jobService.submeterJob(tipo, parametros ?? null, parceiro.id, null);
  }

  async solicitarRelatorioEficiencia(
    parceiro: ParceiroAutenticado,
    parametros?: Record<string, unknown> | null,
  ): Promise<JobSubmetidoResposta> {
    return this.solicitarRelatorio(parceiro, TipoJobRelatorio.EFICIENCIA, parametros);
  }

  async consultarStatusJob(
    parceiro: ParceiroAutenticado,
    jobId: string,
  ): Promise<StatusJobResposta> {
    this.exigirPermissao(parceiro, PermissaoParceiro.LEITURA_RASTREABILIDADE);
    return this.jobService.consultarStatus(jobId);
  }

  async obterResultadoJob(parceiro: ParceiroAutenticado, jobId: string) {
    this.exigirPermissao(parceiro, PermissaoParceiro.LEITURA_RASTREABILIDADE);
    return this.jobService.obterResultado(jobId);
  }
}
