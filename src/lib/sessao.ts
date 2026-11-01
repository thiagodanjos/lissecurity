// Estado da interface. Aqui NUNCA se guardam segredos nem dados do cofre: só a fase da app,
// a navegação (ids, nunca títulos) e preferências de aparência. Os dados vivem no estado dos
// componentes do ecrã aberto e desaparecem quando o cofre bloqueia (o ecrã é desmontado).

import { create } from 'zustand'
import { novaEpoca } from './ipc'
import type { ConfigApp, EstadoApp, TipoItem } from './tipos'

export type Fase = 'a-carregar' | 'erro' | 'sem-cofre' | 'bloqueado' | 'nova-senha' | 'desbloqueado'

export type Pagina =
  | 'inicio'
  | 'senhas'
  | 'notas'
  | 'financeiro'
  | 'gastos'
  | 'bancos'
  | 'cartoes'
  | 'gerador'
  | 'seguranca'
  | 'copias'
  | 'definicoes'

export type Area = 'cofre' | 'financeiro'

export const PAGINA_DO_TIPO: Record<TipoItem, Pagina> = {
  login: 'senhas',
  banco: 'bancos',
  cartao: 'cartoes',
  nota: 'notas',
}

export const AREA_DA_PAGINA: Record<Pagina, Area | null> = {
  inicio: 'cofre',
  senhas: 'cofre',
  notas: 'cofre',
  financeiro: 'financeiro',
  gastos: 'financeiro',
  bancos: 'financeiro',
  cartoes: 'financeiro',
  gerador: null,
  seguranca: null,
  copias: null,
  definicoes: null,
}

export interface PedidoEditor {
  tipo: TipoItem
  id?: string
  /** senha vinda do gerador para um registo novo */
  senhaInicial?: string
}

interface Sessao {
  fase: Fase
  app: EstadoApp | null
  config: ConfigApp | null
  bloquearAoMinimizar: boolean
  motivoBloqueio: string | null
  area: Area
  pagina: Pagina
  /** registo a abrir quando se chega à página (vindo da pesquisa, paleta, visão geral) */
  selecionar: { tipo: TipoItem; id: string } | null
  editor: PedidoEditor | null
  paletaAberta: boolean
  atalhosAbertos: boolean
  lateralRecolhida: boolean
  /** aumenta sempre que o cofre muda, para as listas se recarregarem */
  versao: number
  /** segundos até um valor revelado voltar a ficar oculto (definição do cofre) */
  ocultarSegundos: number
  importarAberto: 'senhas' | 'extrato' | null

  carregar: (e: EstadoApp) => void
  /** Limpa já o ecrã (síncrono) — antes de qualquer animação ou pedido. */
  bloquearLocal: (motivo: string | null) => void
  irPara: (p: Pagina) => void
  mudarArea: (a: Area) => void
  abrirRegisto: (tipo: TipoItem, id: string) => void
  consumirSelecao: () => void
  abrirEditor: (p: PedidoEditor) => void
  fecharEditor: () => void
  definirPaleta: (aberta: boolean) => void
  definirAtalhos: (abertos: boolean) => void
  alternarLateral: () => void
  mudou: () => void
  definirConfig: (c: ConfigApp) => void
  definirBloquearAoMinimizar: (v: boolean) => void
  definirOcultarSegundos: (v: number) => void
  abrirImportar: (q: 'senhas' | 'extrato' | null) => void
}

const ultimaPorArea: Record<Area, Pagina> = { cofre: 'inicio', financeiro: 'financeiro' }

export const useSessao = create<Sessao>((set, get) => ({
  fase: 'a-carregar',
  app: null,
  config: null,
  bloquearAoMinimizar: true,
  motivoBloqueio: null,
  area: 'cofre',
  pagina: 'inicio',
  selecionar: null,
  editor: null,
  paletaAberta: false,
  atalhosAbertos: false,
  lateralRecolhida: false,
  versao: 0,
  ocultarSegundos: 30,
  importarAberto: null,

  carregar: (e) => {
    const antes = get().fase
    const inicial = e.config.paginaInicial ?? 'inicio'
    if (e.desbloqueado && !e.viaRecuperacao && antes !== 'desbloqueado') {
      const pagina: Pagina = inicial === 'gastos' ? 'gastos' : inicial === 'financeiro' ? 'financeiro' : inicial === 'senhas' ? 'senhas' : 'inicio'
      set({ pagina, area: AREA_DA_PAGINA[pagina] ?? 'cofre' })
    }
    set({
      app: e,
      config: e.config,
      bloquearAoMinimizar: e.bloquearAoMinimizar,
      lateralRecolhida: e.config.lateralRecolhida,
      fase: e.erroArranque
        ? 'erro'
        : !e.existeCofre
          ? 'sem-cofre'
          : e.desbloqueado
            ? e.viaRecuperacao
              ? 'nova-senha'
              : 'desbloqueado'
            : 'bloqueado',
    })
  },

  bloquearLocal: (motivo) => {
    novaEpoca()
    ultimaPorArea.cofre = 'inicio'
    ultimaPorArea.financeiro = 'financeiro'
    set({
      fase: get().app?.existeCofre === false ? 'sem-cofre' : 'bloqueado',
      motivoBloqueio: motivo,
      area: 'cofre',
      pagina: 'inicio',
      selecionar: null,
      editor: null,
      paletaAberta: false,
      atalhosAbertos: false,
      importarAberto: null,
    })
  },

  irPara: (pagina) => {
    const area = AREA_DA_PAGINA[pagina] ?? get().area
    ultimaPorArea[area] = pagina
    set({ pagina, area, paletaAberta: false })
  },

  mudarArea: (area) => {
    if (area === get().area) return
    set({ area, pagina: ultimaPorArea[area] })
  },

  abrirRegisto: (tipo, id) => {
    const pagina = PAGINA_DO_TIPO[tipo]
    const area = AREA_DA_PAGINA[pagina] ?? 'cofre'
    ultimaPorArea[area] = pagina
    set({ pagina, area, selecionar: { tipo, id }, paletaAberta: false })
  },

  consumirSelecao: () => set({ selecionar: null }),
  abrirEditor: (editor) => set({ editor, paletaAberta: false }),
  fecharEditor: () => set({ editor: null }),
  definirPaleta: (paletaAberta) => set({ paletaAberta }),
  definirAtalhos: (atalhosAbertos) => set({ atalhosAbertos }),
  alternarLateral: () => set({ lateralRecolhida: !get().lateralRecolhida }),
  mudou: () => set({ versao: get().versao + 1 }),
  definirConfig: (config) => set({ config }),
  definirBloquearAoMinimizar: (bloquearAoMinimizar) => set({ bloquearAoMinimizar }),
  definirOcultarSegundos: (ocultarSegundos) => set({ ocultarSegundos }),
  abrirImportar: (importarAberto) => set({ importarAberto, paletaAberta: false }),
}))
