// Ações partilhadas pela barra de título, menus, atalhos e paleta.

import { api, descartado } from './ipc'
import { useSessao } from './sessao'
import { depoisDePintar } from './utils'
import { avisar, erroParaTexto, limparAvisos } from '@/componentes/avisos'
import { cancelarConfirmacao } from '@/componentes/ui'
import type { ConfigApp, TipoItem } from './tipos'

/**
 * Bloquear: PRIMEIRO esconde tudo (síncrono, o React desmonta o ecrã do cofre e descarta
 * pedidos pendentes), DEPOIS pede à camada nativa para largar as chaves. Nenhuma animação
 * acontece antes de os dados saírem do ecrã.
 */
export function bloquearAgora(motivo = 'manual') {
  cancelarConfirmacao()
  limparAvisos()
  useSessao.getState().bloquearLocal(motivo)
  api.bloquear(motivo === 'atalho' ? 'atalho' : 'manual').catch(() => {})
}

/** Minimizar com a política "bloquear ao minimizar": esconde e espera pela pintura antes de
 *  minimizar, para a miniatura da barra de tarefas não ficar com o conteúdo do cofre. */
export async function minimizar() {
  const s = useSessao.getState()
  if (s.fase === 'desbloqueado' && s.bloquearAoMinimizar) {
    cancelarConfirmacao()
    limparAvisos()
    s.bloquearLocal('minimizar')
    await depoisDePintar()
  }
  await api.janelaMinimizar().catch(() => {})
}

export function novoRegisto(tipo: TipoItem, senhaInicial?: string) {
  useSessao.getState().abrirEditor({ tipo, senhaInicial })
}

export async function criarCopiaAgora() {
  try {
    const r = await api.criarCopia()
    if (r) {
      avisar('sucesso', 'Cópia de segurança criada e verificada.')
      useSessao.getState().mudou()
    }
  } catch (e) {
    if (descartado(e)) return
    avisar('erro', erroParaTexto(e))
  }
}

export async function mudarConfig(alteracao: Partial<ConfigApp>) {
  const atual = useSessao.getState().config
  if (!atual) return
  const nova = { ...atual, ...alteracao }
  aplicarAparencia(nova)
  useSessao.getState().definirConfig(nova)
  try {
    const gravada = await api.guardarConfig(nova)
    useSessao.getState().definirConfig(gravada)
  } catch (e) {
    if (descartado(e)) return
    aplicarAparencia(atual)
    useSessao.getState().definirConfig(atual)
    avisar('erro', erroParaTexto(e))
  }
}

export function aplicarAparencia(c: ConfigApp | null) {
  const html = document.documentElement
  html.dataset.tema = c?.tema ?? 'grafite'
  html.dataset.densidade = c?.densidade ?? 'confortavel'
  html.dataset.cor = c?.cor ?? 'verde'
  const reduzir = c?.animacoes === 'reduzidas' || (c?.animacoes !== 'completas' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  html.dataset.movimento = reduzir ? 'reduzido' : 'normal'
}

export function movimentoReduzido(c: ConfigApp | null): boolean {
  return c?.animacoes === 'reduzidas' || (c?.animacoes !== 'completas' && matchMedia('(prefers-reduced-motion: reduce)').matches)
}

/** Ações do menu Editar sobre o campo com foco. */
export function editar(acao: 'undo' | 'redo' | 'cut' | 'copy' | 'selectAll') {
  // execCommand continua a ser a única forma de o fazer num campo a partir de um menu
  document.execCommand(acao)
}
