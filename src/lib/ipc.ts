// Cliente da camada nativa. Cada pedido guarda a "época" em que começou: se o cofre for
// bloqueado entretanto, a resposta é DESCARTADA (lança `Descartado`) e nunca chega a pintar
// segredos num ecrã que já devia estar limpo.

import { invoke } from '@tauri-apps/api/core'
import type {
  Agrupamentos,
  Consulta,
  CopiaCriada,
  Definicoes,
  DefinicoesVista,
  Desbloqueio,
  EstadoApp,
  ConfigApp,
  Forca,
  Gerada,
  InfoCopia,
  Item,
  ItemVista,
  OpcoesFrase,
  OpcoesSenha,
  Relatorio,
  Resumo,
  VisaoGeral,
  CodigoTotp,
  PreferenciasGerador,
  PreviaSenhas,
  Importacao,
  ResumoGastos,
  Movimento,
  PastaNuvem,
  CopiaEncontrada,
  EstadoCopias,
  CopiaFeita,
} from './tipos'

let epoca = 0
let aoBloqueado: (() => void) | null = null

export const epocaAtual = () => epoca
/** Chamado ao bloquear: tudo o que estava pendente passa a ser descartado. */
export function novaEpoca() {
  epoca++
}
/** A camada nativa respondeu "bloqueado" (p. ex. o aviso de bloqueio perdeu-se). */
export function definirAoBloqueado(f: () => void) {
  aoBloqueado = f
}

export class ErroIpc extends Error {
  constructor(
    public codigo: string,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

/** Resposta que chegou depois de um bloqueio — ignora-se em silêncio. */
export class Descartado extends Error {
  constructor() {
    super('descartado')
  }
}

/** Para cadeias `.catch(ignorarDescartado)`: engole o Descartado e volta a lançar o resto. */
export const ignorarDescartado = (e: unknown) => {
  if (!(e instanceof Descartado)) throw e
}

/** Para blocos try/catch: `if (descartado(e)) return`. */
export const descartado = (e: unknown): e is Descartado => e instanceof Descartado

async function chamar<T>(comando: string, args?: Record<string, unknown>): Promise<T> {
  const inicio = epoca
  try {
    const r = await invoke<T>(comando, args)
    if (epoca !== inicio) throw new Descartado()
    return r
  } catch (e) {
    if (e instanceof Descartado || epoca !== inicio) throw new Descartado()
    const { codigo, mensagem } =
      typeof e === 'object' && e !== null && 'codigo' in e
        ? (e as { codigo: string; mensagem: string })
        : { codigo: 'sistema', mensagem: 'Ocorreu um erro inesperado.' }
    if (codigo === 'bloqueado') aoBloqueado?.()
    throw new ErroIpc(codigo, mensagem)
  }
}

export const api = {
  // aplicação e janela
  estadoApp: () => chamar<EstadoApp>('estado_app'),
  janelaPronta: () => chamar<void>('janela_pronta'),
  janelaMinimizar: () => chamar<void>('janela_minimizar'),
  janelaAlternarMaximizar: () => chamar<boolean>('janela_alternar_maximizar'),
  janelaMaximizada: () => chamar<boolean>('janela_maximizada'),
  janelaFechar: () => chamar<void>('janela_fechar'),

  // abrir e fechar
  criarCofre: (senha: string, nome: string, bloqueioMinutos: number, comRecuperacao: boolean) =>
    chamar<string | null>('criar_cofre', { senha, nome, bloqueioMinutos, comRecuperacao }),
  desbloquear: (senha: string) => chamar<Desbloqueio>('desbloquear', { senha }),
  desbloquearRecuperacao: (chave: string) => chamar<Desbloqueio>('desbloquear_recuperacao', { chave }),
  bloquear: (motivo?: string) => chamar<void>('bloquear_cofre', { motivo }),
  registarAtividade: () => chamar<void>('registar_atividade'),

  // senha mestra e recuperação
  alterarSenha: (atual: string | null, nova: string) => chamar<string | null>('alterar_senha', { atual, nova }),
  ativarRecuperacao: (senha: string) => chamar<string>('ativar_recuperacao', { senha }),
  desativarRecuperacao: (senha: string) => chamar<void>('desativar_recuperacao', { senha }),

  // leitura
  visaoGeral: () => chamar<VisaoGeral>('visao_geral'),
  listar: (consulta: Consulta) => chamar<Resumo[]>('listar', { consulta }),
  agrupamentos: (tipo: string) => chamar<Agrupamentos>('agrupamentos', { tipo }),
  obterItem: (id: string) => chamar<ItemVista>('obter_item', { id }),
  obterItemEdicao: (id: string) => chamar<Item>('obter_item_edicao', { id }),
  revelarCampo: (id: string, campo: string) => chamar<string>('revelar_campo', { id, campo }),
  copiarCampo: (id: string, campo: string) => chamar<number>('copiar_campo', { id, campo }),
  copiarTexto: (texto: string) => chamar<number>('copiar_texto', { texto }),
  abrirEndereco: (id: string) => chamar<void>('abrir_endereco', { id }),
  relatorioSeguranca: () => chamar<Relatorio>('relatorio_seguranca'),

  // escrita
  guardarItem: (item: Item) => chamar<string>('guardar_item', { item }),
  duplicarItem: (id: string) => chamar<string>('duplicar_item', { id }),
  moverParaLixo: (id: string) => chamar<void>('mover_para_lixo', { id }),
  restaurarItem: (id: string) => chamar<void>('restaurar_item', { id }),
  eliminarItem: (id: string) => chamar<void>('eliminar_item', { id }),
  esvaziarLixo: () => chamar<number>('esvaziar_lixo'),
  alternarFavorito: (id: string) => chamar<boolean>('alternar_favorito', { id }),
  marcarCodigo: (id: string, indice: number, usado: boolean) => chamar<void>('marcar_codigo', { id, indice, usado }),
  limparHistorico: (id: string) => chamar<void>('limpar_historico', { id }),

  // gerador
  gerarSenha: (opcoes: OpcoesSenha) => chamar<Gerada>('gerar_senha', { opcoes }),
  gerarFrase: (opcoes: OpcoesFrase) => chamar<Gerada>('gerar_frase', { opcoes }),
  avaliarSenha: (senha: string, contexto: string[] = []) => chamar<Forca>('avaliar_senha', { senha, contexto }),

  // definições
  obterDefinicoes: () => chamar<DefinicoesVista>('obter_definicoes'),
  guardarDefinicoes: (definicoes: Definicoes, nome: string) => chamar<void>('guardar_definicoes', { definicoes, nome }),
  guardarConfig: (config: ConfigApp) => chamar<ConfigApp>('guardar_config', { config }),
  abrirPastaCofre: () => chamar<void>('abrir_pasta_cofre'),

  // cópias de segurança
  criarCopia: () => chamar<CopiaCriada | null>('criar_copia'),
  escolherCopia: () => chamar<string | null>('escolher_copia'),
  testarCopia: (caminho: string, senha: string) => chamar<InfoCopia>('testar_copia', { caminho, senha }),
  restaurarCopia: (caminho: string, senha: string, senhaAtual: string | null) =>
    chamar<InfoCopia>('restaurar_copia', { caminho, senha, senhaAtual }),

  // v0.2 — reautenticação, 2FA, proteção, gerador
  reautenticar: (senha: string) => chamar<void>('reautenticar', { senha }),
  codigoTotp: (id: string) => chamar<CodigoTotp>('codigo_totp', { id }),
  copiarCodigoTotp: (id: string) => chamar<number>('copiar_codigo_totp', { id }),
  reforcarProtecao: (senha: string, nivel: 'normal' | 'forte' | 'maxima') => chamar<string | null>('reforcar_protecao', { senha, nivel }),
  guardarGerador: (preferencias: PreferenciasGerador) => chamar<void>('guardar_gerador', { preferencias }),

  // importação
  escolherCsv: (titulo: string) => chamar<string | null>('escolher_csv', { titulo }),
  apagarFicheiroImportado: (caminho: string) => chamar<void>('apagar_ficheiro_importado', { caminho }),
  preVisualizarSenhas: (caminho: string) => chamar<PreviaSenhas>('pre_visualizar_senhas', { caminho }),
  importarSenhas: (caminho: string) => chamar<Importacao>('importar_senhas', { caminho }),
  importarExtrato: (caminho: string) => chamar<Importacao>('importar_extrato', { caminho }),

  // gastos
  resumoGastos: (ano?: number, mes?: number, moeda?: string) => chamar<ResumoGastos>('resumo_gastos', { ano, mes, moeda }),
  listarMovimentos: (ano: number, mes: number, moeda: string, categoria?: string, texto?: string) =>
    chamar<Movimento[]>('listar_movimentos', { ano, mes, moeda, categoria, texto }),
  categorizarMovimento: (id: string, categoria: string, todos: boolean) => chamar<number>('categorizar_movimento', { id, categoria, todos }),
  eliminarMovimentos: (origem?: string) => chamar<number>('eliminar_movimentos', { origem }),

  // cópias automáticas
  pastasNuvem: () => chamar<PastaNuvem[]>('pastas_nuvem'),
  escolherPasta: (titulo: string) => chamar<string | null>('escolher_pasta', { titulo }),
  listarCopias: (pasta: string) => chamar<CopiaEncontrada[]>('listar_copias', { pasta }),
  estadoCopias: () => chamar<EstadoCopias>('estado_copias'),
  configurarCopias: (ativo: boolean, pasta: string, manter: number) => chamar<EstadoCopias>('configurar_copias', { ativo, pasta, manter }),
  fazerCopiaAuto: () => chamar<CopiaFeita>('fazer_copia_auto'),
}
