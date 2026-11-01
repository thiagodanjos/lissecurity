import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { listen } from '@tauri-apps/api/event'
import { Copy, Lock, Minus, PanelLeft, Search, Square, X } from 'lucide-react'
import { api } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import { bloquearAgora, criarCopiaAgora, editar, minimizar, mudarConfig, novoRegisto } from '@/lib/acoes'
import { cn } from '@/lib/utils'
import { Kbd, Simbolo } from './ui'
import { useAjuda } from './ajuda'

type Entrada = { rotulo: string; atalho?: string; aoClicar: () => void; marcado?: boolean } | 'separador'
type Menu = { id: string; rotulo: string; entradas: Entrada[] }

/**
 * Barra de título própria (a moldura do Windows está desligada): símbolo, menus, recolher a
 * lateral, pesquisa de páginas e ações (Ctrl+K), estado do cofre, bloquear e os controlos da
 * janela. Toda a área sem botões arrasta a janela; duplo clique maximiza/restaura.
 */
export function BarraTitulo() {
  const fase = useSessao((s) => s.fase)
  const config = useSessao((s) => s.config)
  const lateralRecolhida = useSessao((s) => s.lateralRecolhida)
  const aberto = fase === 'desbloqueado'
  const { irPara, alternarLateral, definirPaleta, mudarArea } = useSessao.getState()
  const [menuAberto, setMenuAberto] = useState<string | null>(null)
  const raiz = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuAberto) return
    const fora = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setMenuAberto(null)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAberto(null)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [menuAberto])

  // fechar menus quando o cofre bloqueia
  useEffect(() => setMenuAberto(null), [fase])

  const ajuda = useAjuda.getState()
  const sair = () => void api.janelaFechar()

  const menus: Menu[] = aberto
    ? [
        {
          id: 'ficheiro',
          rotulo: 'Ficheiro',
          entradas: [
            { rotulo: 'Nova senha', atalho: 'Ctrl+N', aoClicar: () => novoRegisto('login') },
            { rotulo: 'Nova conta bancária', aoClicar: () => novoRegisto('banco') },
            { rotulo: 'Novo cartão', aoClicar: () => novoRegisto('cartao') },
            { rotulo: 'Nova nota segura', aoClicar: () => novoRegisto('nota') },
            'separador',
            { rotulo: 'Importar senhas (CSV)…', aoClicar: () => useSessao.getState().abrirImportar('senhas') },
            { rotulo: 'Importar extrato bancário (CSV)…', aoClicar: () => useSessao.getState().abrirImportar('extrato') },
            'separador',
            { rotulo: 'Criar cópia de segurança…', aoClicar: () => void criarCopiaAgora() },
            { rotulo: 'Restaurar cópia de segurança…', aoClicar: () => irPara('copias') },
            'separador',
            { rotulo: 'Bloquear o cofre', atalho: 'Ctrl+L', aoClicar: () => bloquearAgora() },
            { rotulo: 'Sair do LisSecurity', atalho: 'Alt+F4', aoClicar: sair },
          ],
        },
        {
          id: 'editar',
          rotulo: 'Editar',
          entradas: [
            { rotulo: 'Desfazer', atalho: 'Ctrl+Z', aoClicar: () => editar('undo') },
            { rotulo: 'Refazer', atalho: 'Ctrl+Y', aoClicar: () => editar('redo') },
            'separador',
            { rotulo: 'Cortar', atalho: 'Ctrl+X', aoClicar: () => editar('cut') },
            { rotulo: 'Copiar', atalho: 'Ctrl+C', aoClicar: () => editar('copy') },
            { rotulo: 'Selecionar tudo', atalho: 'Ctrl+A', aoClicar: () => editar('selectAll') },
            'separador',
            { rotulo: 'Procurar no cofre', atalho: 'Ctrl+F', aoClicar: () => document.getElementById('pesquisa-cofre')?.focus() },
            { rotulo: 'Gerar senha', atalho: 'Ctrl+G', aoClicar: () => irPara('gerador') },
          ],
        },
        {
          id: 'ver',
          rotulo: 'Ver',
          entradas: [
            { rotulo: 'Visão geral', aoClicar: () => irPara('inicio') },
            { rotulo: 'Área Cofre', aoClicar: () => mudarArea('cofre') },
            { rotulo: 'Área Financeiro', aoClicar: () => mudarArea('financeiro') },
            'separador',
            { rotulo: 'Barra lateral', atalho: 'Ctrl+B', marcado: !lateralRecolhida, aoClicar: alternarLateral },
            { rotulo: 'Modo compacto', marcado: config?.densidade === 'compacta', aoClicar: () => void mudarConfig({ densidade: config?.densidade === 'compacta' ? 'confortavel' : 'compacta' }) },
            { rotulo: 'Reduzir animações', marcado: config?.animacoes === 'reduzidas', aoClicar: () => void mudarConfig({ animacoes: config?.animacoes === 'reduzidas' ? 'sistema' : 'reduzidas' }) },
          ],
        },
        {
          id: 'ajuda',
          rotulo: 'Ajuda',
          entradas: [
            { rotulo: 'Atalhos de teclado', atalho: 'F1', aoClicar: () => ajuda.abrir('atalhos') },
            { rotulo: 'Segurança e limites', aoClicar: () => irPara('seguranca') },
            'separador',
            { rotulo: 'Sobre o LisSecurity', aoClicar: () => ajuda.abrir('sobre') },
          ],
        },
      ]
    : [
        { id: 'ficheiro', rotulo: 'Ficheiro', entradas: [{ rotulo: 'Sair do LisSecurity', atalho: 'Alt+F4', aoClicar: sair }] },
        {
          id: 'editar',
          rotulo: 'Editar',
          entradas: [
            { rotulo: 'Desfazer', atalho: 'Ctrl+Z', aoClicar: () => editar('undo') },
            { rotulo: 'Cortar', atalho: 'Ctrl+X', aoClicar: () => editar('cut') },
            { rotulo: 'Selecionar tudo', atalho: 'Ctrl+A', aoClicar: () => editar('selectAll') },
          ],
        },
        {
          id: 'ajuda',
          rotulo: 'Ajuda',
          entradas: [
            { rotulo: 'Atalhos de teclado', atalho: 'F1', aoClicar: () => ajuda.abrir('atalhos') },
            { rotulo: 'Sobre o LisSecurity', aoClicar: () => ajuda.abrir('sobre') },
          ],
        },
      ]

  // clicar num menu não pode tirar o foco do campo onde a pessoa estava (Cortar, Copiar…)
  const manterFoco = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div
      ref={raiz}
      data-tauri-drag-region="deep"
      className="relative z-50 grid h-10 shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,30rem)_minmax(max-content,1fr)] items-center bg-sidebar select-none"
    >
      {/* esquerda: símbolo, menus, lateral */}
      <div className="flex min-w-0 items-center gap-1 pl-3">
        <button
          type="button"
          aria-label="LisSecurity — visão geral"
          title="LisSecurity"
          onClick={() => aberto && irPara('inicio')}
          className="mr-1.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md"
        >
          <Simbolo className="h-[15px] w-auto" brilho={false} />
        </button>

        <nav className="flex items-center" aria-label="Menus">
          {menus.map((menu) => (
            <div key={menu.id} className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuAberto === menu.id}
                onMouseDown={manterFoco}
                onClick={() => setMenuAberto(menuAberto === menu.id ? null : menu.id)}
                onMouseEnter={() => menuAberto && setMenuAberto(menu.id)}
                className={cn(
                  'h-7 cursor-pointer rounded-md px-2.5 text-[13px] transition-colors hover:bg-white/10 hover:text-text max-[860px]:px-1.5',
                  menuAberto === menu.id ? 'bg-white/10 text-text' : 'text-muted',
                )}
              >
                {menu.rotulo}
              </button>
              <AnimatePresence>
                {menuAberto === menu.id && (
                  <motion.div
                    role="menu"
                    aria-label={menu.rotulo}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute left-0 top-full mt-1 min-w-64 rounded-xl border border-border bg-card p-1.5 shadow-card"
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                      e.preventDefault()
                      const itens = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
                      const i = itens.indexOf(document.activeElement as HTMLButtonElement)
                      const prox = e.key === 'ArrowDown' ? (i + 1) % itens.length : (i - 1 + itens.length) % itens.length
                      itens[prox]?.focus()
                    }}
                  >
                    {menu.entradas.map((entrada, i) =>
                      entrada === 'separador' ? (
                        <div key={i} role="separator" className="my-1 h-px bg-border" />
                      ) : (
                        <button
                          key={entrada.rotulo}
                          type="button"
                          role={entrada.marcado === undefined ? 'menuitem' : 'menuitemcheckbox'}
                          aria-checked={entrada.marcado}
                          onMouseDown={manterFoco}
                          onClick={() => {
                            setMenuAberto(null)
                            entrada.aoClicar()
                          }}
                          className="flex w-full cursor-pointer items-center justify-between gap-8 rounded-lg px-3 py-1.5 text-left text-[13px] text-text transition-colors hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                        >
                          <span className="flex items-center gap-2">
                            {entrada.marcado !== undefined && (
                              <span className={cn('size-1.5 rounded-full', entrada.marcado ? 'bg-accent' : 'bg-transparent')} aria-hidden="true" />
                            )}
                            {entrada.rotulo}
                          </span>
                          {entrada.atalho && <span className="text-[11px] text-faint">{entrada.atalho}</span>}
                        </button>
                      ),
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </nav>

        {aberto && (
          <button
            type="button"
            title="Barra lateral (Ctrl+B)"
            aria-label="Mostrar ou ocultar a barra lateral"
            onClick={alternarLateral}
            className="ml-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-faint transition-colors hover:bg-white/10 hover:text-text"
          >
            <PanelLeft className="size-4" />
          </button>
        )}
      </div>

      {/* centro: pesquisa de páginas e ações */}
      <button
        type="button"
        disabled={!aberto}
        onClick={() => definirPaleta(true)}
        className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-raised px-3 text-left text-[12.5px] text-faint transition-colors hover:border-border-strong hover:text-muted disabled:cursor-default disabled:opacity-60 disabled:hover:border-border disabled:hover:text-faint"
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{aberto ? 'Pesquisar páginas e ações…' : 'Desbloqueia o cofre para pesquisar'}</span>
        {aberto && <Kbd className="shrink-0 py-0">Ctrl K</Kbd>}
      </button>

      {/* direita: estado, bloquear, janela */}
      <div className="flex h-full min-w-0 items-center justify-end gap-2 pl-3">
        <EstadoCofre aberto={aberto} />
        {aberto && (
          <button
            type="button"
            onClick={() => bloquearAgora()}
            title="Bloquear o cofre (Ctrl+L)"
            className="toque flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-raised px-2.5 text-[12px] font-semibold text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            <Lock className="size-3.5" aria-hidden="true" />
            <span className="max-[980px]:hidden">Bloquear</span>
          </button>
        )}
        <ControlosJanela />
      </div>
    </div>
  )
}

function EstadoCofre({ aberto }: { aberto: boolean }) {
  return (
    <span
      role="status"
      title={aberto ? 'O cofre está desbloqueado' : 'O cofre está bloqueado'}
      className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-muted max-[760px]:hidden"
    >
      <span className={cn('size-2 shrink-0 rounded-full transition-colors', aberto ? 'bg-accent shadow-glow' : 'bg-faint')} aria-hidden="true" />
      <span className="truncate">{aberto ? 'Cofre aberto' : 'Bloqueado'}</span>
    </span>
  )
}

function ControlosJanela() {
  const [maximizada, setMaximizada] = useState(false)
  useEffect(() => {
    api.janelaMaximizada().then(setMaximizada).catch(() => {})
    const desligar = listen<boolean>('lis://janela', (e) => setMaximizada(e.payload))
    return () => {
      void desligar.then((f) => f())
    }
  }, [])
  const botao =
    'flex h-full w-[46px] cursor-pointer items-center justify-center text-muted transition-colors duration-150 hover:bg-white/10 hover:text-text active:bg-white/15 focus-visible:-outline-offset-2'
  return (
    <div className="flex h-full">
      <button type="button" aria-label="Minimizar" title="Minimizar" onClick={() => void minimizar()} className={botao}>
        <Minus className="size-4" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={maximizada ? 'Restaurar' : 'Maximizar'}
        title={maximizada ? 'Restaurar' : 'Maximizar'}
        onClick={() => api.janelaAlternarMaximizar().then(setMaximizada).catch(() => {})}
        className={botao}
      >
        {maximizada ? <Copy className="size-3.5 -scale-x-100" strokeWidth={1.75} /> : <Square className="size-3" strokeWidth={1.75} />}
      </button>
      <button
        type="button"
        aria-label="Fechar"
        title="Fechar"
        onClick={() => void api.janelaFechar()}
        className="flex h-full w-[46px] cursor-pointer items-center justify-center text-muted transition-colors duration-150 hover:bg-[#e81123] hover:text-white active:bg-[#c50f1f] focus-visible:-outline-offset-2"
      >
        <X className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  )
}
