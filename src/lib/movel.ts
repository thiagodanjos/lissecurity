// Android: o que a interface faz de diferente no telemóvel.
//
// * `data-plataforma="android"` no <html>: o CSS e os componentes escolhem a disposição móvel
//   (navegação em baixo, ecrãs inteiros, folhas que sobem do fundo, alvos de toque maiores).
// * Margens do sistema: a app desenha-se por baixo da barra de estado e da navegação; a camada
//   Kotlin dá as medidas (variáveis CSS `--sistema-*`) e volta a dá-las quando mudam (rodar o
//   ecrã, abrir o teclado).
// * Botão voltar: fecha primeiro o que estiver por cima (diálogo, editor, detalhe), depois volta
//   ao início e, no início, manda a app para trás em vez de a fechar.

import { useEffect, useRef } from 'react'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { api } from './ipc'
import { useSessao } from './sessao'
import type { Margens, Plataforma } from './tipos'

export function ehAndroid(): boolean {
  return document.documentElement.dataset.plataforma === 'android'
}

/** Para componentes: a plataforma (o valor só muda no arranque). */
export function useAndroid(): boolean {
  return useSessao((s) => s.app?.plataforma === 'android')
}

let ultimasMargens: Margens | null = null

/** Píxeis do ecrã → píxeis CSS com o zoom da app (arredondado a centésimas). */
export function margemCss(v: number, zoom: number): string {
  const z = zoom > 0 ? zoom : 1
  return `${Math.round((Math.max(0, v) / z) * 100) / 100}px`
}
let zoomAtual = 1

/**
 * As margens chegam em píxeis do ecrã; com o «Tamanho de tudo» acima de 100 % cada píxel CSS
 * fica maior, por isso dividem-se pelo zoom para a app continuar encostada às barras do sistema.
 */
function aplicarMargens(m: Margens) {
  ultimasMargens = m
  const r = document.documentElement.style
  const px = (v: number) => margemCss(v, zoomAtual)
  r.setProperty('--sistema-topo', px(m.topo))
  r.setProperty('--sistema-direita', px(m.direita))
  r.setProperty('--sistema-baixo', px(m.baixo))
  r.setProperty('--sistema-esquerda', px(m.esquerda))
  r.setProperty('--sistema-teclado', px(m.teclado))
}

/**
 * «Tamanho de tudo» no Android: o WebView não tem o zoom de página do Windows, por isso usa-se o
 * `zoom` do CSS na raiz (o Chromium recalcula a disposição, como o zoom de um navegador).
 */
export function aplicarZoom(zoom: number) {
  if (!ehAndroid()) return
  zoomAtual = zoom > 0 ? zoom : 1
  document.documentElement.style.zoom = zoomAtual === 1 ? '' : String(zoomAtual)
  if (ultimasMargens) aplicarMargens(ultimasMargens)
}

// ───────────────────────────── botão voltar ─────────────────────────────

/** O que está aberto por cima, do mais antigo ao mais recente. */
const pilha: { id: number; fechar: () => void }[] = []
let proximoId = 0

/**
 * Enquanto `ativo`, o botão voltar do Android chama `fechar` (o último aberto fecha primeiro).
 * Usado por diálogos, folhas, o editor e o detalhe de um registo.
 */
export function useVoltar(ativo: boolean, fechar: () => void) {
  const ref = useRef(fechar)
  ref.current = fechar
  useEffect(() => {
    if (!ativo) return
    const id = ++proximoId
    pilha.push({ id, fechar: () => ref.current() })
    return () => {
      const i = pilha.findIndex((x) => x.id === id)
      if (i >= 0) pilha.splice(i, 1)
    }
  }, [ativo])
}

export type PassoVoltar = 'fechar-por-cima' | 'fechar-editor' | 'fechar-importar' | 'inicio' | 'segundo-plano'

/** O que o botão voltar faz, do mais próximo para o mais distante (função pura, testada). */
export function passoVoltar(s: { abertosPorCima: number; fase: string; editor: boolean; importar: boolean; pagina: string }): PassoVoltar {
  if (s.abertosPorCima > 0) return 'fechar-por-cima'
  if (s.fase === 'desbloqueado') {
    if (s.editor) return 'fechar-editor'
    if (s.importar) return 'fechar-importar'
    if (s.pagina !== 'inicio') return 'inicio'
  }
  // no primeiro ecrã: para trás, como o botão de início (o cofre bloqueia ao sair da app, se
  // essa opção estiver ligada) em vez de fechar a app
  return 'segundo-plano'
}

function voltar() {
  const s = useSessao.getState()
  const passo = passoVoltar({ abertosPorCima: pilha.length, fase: s.fase, editor: !!s.editor, importar: !!s.importarAberto, pagina: s.pagina })
  if (passo === 'fechar-por-cima') pilha[pilha.length - 1].fechar()
  else if (passo === 'fechar-editor') s.fecharEditor()
  else if (passo === 'fechar-importar') s.abrirImportar(null)
  else if (passo === 'inicio') s.irPara('inicio')
  else api.paraSegundoPlano().catch(() => {})
}

let iniciado = false

/** Chamado uma vez, quando a camada nativa diz que a plataforma é o Android. */
export function iniciarAndroid(plataforma: Plataforma) {
  document.documentElement.dataset.plataforma = plataforma
  if (plataforma !== 'android' || iniciado) return
  iniciado = true
  api
    .margensSistema()
    .then(aplicarMargens)
    .catch(() => {})
  // a camada Kotlin já mudou as variáveis; o evento serve para quem precisar de reagir
  window.addEventListener('lis-margens', (e) => {
    const m = (e as CustomEvent<Margens>).detail
    if (m) aplicarMargens(m)
  })
  onBackButtonPress(() => voltar()).catch(() => {})
  // o campo com foco não fica escondido atrás do teclado
  window.addEventListener('focusin', (e) => {
    const alvo = e.target as HTMLElement
    if (!alvo.matches('input, textarea, select')) return
    setTimeout(() => alvo.scrollIntoView({ block: 'center', behavior: 'smooth' }), 260)
  })
}

/** «computador» ou «telemóvel», para os textos que falam do aparelho onde o cofre vive. */
export function aparelho(): 'computador' | 'telemóvel' {
  return ehAndroid() ? 'telemóvel' : 'computador'
}
