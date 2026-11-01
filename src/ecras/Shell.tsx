import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CreditCard, KeyRound, Landmark, NotebookPen, Plus, Search, WandSparkles } from 'lucide-react'
import { api, ignorarDescartado } from '@/lib/ipc'
import { useSessao, type Pagina } from '@/lib/sessao'
import type { Resumo } from '@/lib/tipos'
import { novoRegisto } from '@/lib/acoes'
import { mascararIdentificacao } from '@/lib/formatos'
import { cn } from '@/lib/utils'
import { Lateral } from '@/componentes/lateral'
import { IconeRegisto } from '@/componentes/registo'
import { BotaoIcone, Kbd } from '@/componentes/ui'
import { VisaoGeral } from './VisaoGeral'
import { Registos } from './Registos'
import { Financeiro } from './Financeiro'
import { Gerador } from './Gerador'
import { Seguranca } from './Seguranca'
import { Copias } from './Copias'
import { Definicoes } from './Definicoes'
import { Editor } from './Editor'
import { Gastos } from './Gastos'
import { Importar } from '@/componentes/importar'

const INTERVALO_ATIVIDADE_MS = 15_000

/** Avisa a camada nativa de que há gente ao teclado (a contagem do bloqueio é feita lá). */
function useAtividade() {
  useEffect(() => {
    let ultimo = 0
    const aoMexer = () => {
      const agora = Date.now()
      if (agora - ultimo < INTERVALO_ATIVIDADE_MS) return
      ultimo = agora
      api.registarAtividade().catch(() => {})
    }
    const eventos = ['pointerdown', 'keydown', 'wheel', 'pointermove'] as const
    eventos.forEach((e) => window.addEventListener(e, aoMexer, { passive: true }))
    return () => eventos.forEach((e) => window.removeEventListener(e, aoMexer))
  }, [])
}

function Pagina({ pagina }: { pagina: Pagina }) {
  switch (pagina) {
    case 'inicio':
      return <VisaoGeral />
    case 'senhas':
      return <Registos key="login" tipo="login" />
    case 'notas':
      return <Registos key="nota" tipo="nota" />
    case 'bancos':
      return <Registos key="banco" tipo="banco" />
    case 'cartoes':
      return <Registos key="cartao" tipo="cartao" />
    case 'financeiro':
      return <Financeiro />
    case 'gastos':
      return <Gastos />
    case 'gerador':
      return <Gerador />
    case 'seguranca':
      return <Seguranca />
    case 'copias':
      return <Copias />
    case 'definicoes':
      return <Definicoes />
  }
}

/** A janela desbloqueada: lateral à esquerda e o grande painel arredondado à direita. */
export function Shell() {
  const pagina = useSessao((s) => s.pagina)
  useAtividade()
  // preferências do cofre que a interface precisa de ter à mão
  useEffect(() => {
    api
      .obterDefinicoes()
      .then((d) => {
        useSessao.getState().definirOcultarSegundos(d.cofre.ocultarReveladoSegundos)
        useSessao.getState().definirBloquearAoMinimizar(d.cofre.bloquearAoMinimizar)
      })
      .catch(() => {})
  }, [])
  return (
    <div className="flex min-h-0 flex-1">
      <Lateral />
      <main className="flex min-w-0 flex-1 flex-col p-2 pl-0">
        <motion.div
          initial={{ opacity: 0, scale: 0.985, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/50 bg-bg"
        >
          <CabecalhoInterno />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pagina}
              className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <Pagina pagina={pagina} />
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </main>
      <Editor />
      <Importar />
    </div>
  )
}

/** Cabeçalho interno do painel: pesquisa arredondada no cofre e ações em botões circulares. */
function CabecalhoInterno() {
  const pagina = useSessao((s) => s.pagina)
  const { abrirRegisto, irPara } = useSessao.getState()
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Resumo[]>([])
  const [aberto, setAberto] = useState(false)
  const [ativo, setAtivo] = useState(0)
  const [menuNovo, setMenuNovo] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const novo = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (texto.trim().length < 1) {
      setResultados([])
      return
    }
    let vivo = true
    const t = setTimeout(() => {
      api
        .listar({ texto, ordem: 'titulo' })
        .then((r) => {
          if (!vivo) return
          setResultados(r.slice(0, 8))
          setAtivo(0)
        })
        .catch(ignorarDescartado)
        .catch(() => {})
    }, 80)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [texto])

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false)
      if (!novo.current?.contains(e.target as Node)) setMenuNovo(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  const escolher = (r: Resumo | undefined) => {
    if (!r) return
    abrirRegisto(r.tipo, r.id)
    setTexto('')
    setAberto(false)
  }

  const tipoDaPagina = pagina === 'bancos' ? 'banco' : pagina === 'cartoes' ? 'cartao' : pagina === 'notas' ? 'nota' : 'login'

  return (
    <header className="z-20 flex items-center gap-3 border-b border-border/60 px-6 py-3">
      <div ref={raiz} className="relative min-w-0 max-w-md flex-[100_1_0%]">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden="true" />
        <input
          id="pesquisa-cofre"
          type="search"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value)
            setAberto(true)
          }}
          onFocus={() => setAberto(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setAtivo((a) => Math.min(a + 1, resultados.length - 1)))
            if (e.key === 'ArrowUp') (e.preventDefault(), setAtivo((a) => Math.max(a - 1, 0)))
            if (e.key === 'Enter') (e.preventDefault(), escolher(resultados[ativo]))
            if (e.key === 'Escape') {
              setTexto('')
              setAberto(false)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          placeholder="Procurar no cofre…"
          aria-label="Procurar no cofre"
          aria-expanded={aberto && resultados.length > 0}
          aria-controls="resultados-cofre"
          autoComplete="off"
          spellCheck={false}
          className="h-11 w-full rounded-full border border-border bg-raised pl-10 pr-20 text-sm text-text placeholder:text-faint outline-none transition-all focus:border-accent/50 focus:ring-2 focus:ring-accent/15 [&::-webkit-search-cancel-button]:appearance-none"
        />
        <Kbd className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">Ctrl F</Kbd>
        <AnimatePresence>
          {aberto && texto.trim() && (
            <motion.div
              id="resultados-cofre"
              role="listbox"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-sobreposicao"
            >
              {resultados.length === 0 ? (
                <p className="px-3 py-4 text-center text-[12.5px] text-muted">Nada encontrado no cofre.</p>
              ) : (
                resultados.map((r, i) => (
                  <button
                    key={r.id}
                    type="button"
                    role="option"
                    aria-selected={i === ativo}
                    onMouseMove={() => setAtivo(i)}
                    onClick={() => escolher(r)}
                    className={cn('flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors', i === ativo ? 'bg-accent-soft' : 'hover:bg-card-hover')}
                  >
                    <IconeRegisto tipo={r.tipo} titulo={r.titulo} dominio={r.dominio} tamanho="sm" />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[13px] font-semibold', i === ativo && 'text-accent')}>{r.titulo}</span>
                      <span className="block truncate text-[11.5px] text-muted">
                        {r.tipo === 'login' ? mascararIdentificacao(r.subtitulo) || r.dominio : r.fim ? `${r.instituicao ?? ''} •••• ${r.fim}` : r.subtitulo}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="flex-1" />
      <BotaoIcone rotulo="Gerar senha (Ctrl+G)" onClick={() => irPara('gerador')} ativo={pagina === 'gerador'}>
        <WandSparkles />
      </BotaoIcone>
      <div ref={novo} className="relative">
        <BotaoIcone rotulo="Novo registo" aria-haspopup="menu" aria-expanded={menuNovo} onClick={() => setMenuNovo(!menuNovo)} className="!border-accent/40 !bg-accent !text-black hover:!bg-accent-hover hover:shadow-glow">
          <Plus />
        </BotaoIcone>
        <AnimatePresence>
          {menuNovo && (
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 top-full z-40 mt-2 min-w-56 rounded-xl border border-border bg-card p-1.5 shadow-card"
            >
              {(
                [
                  ['login', 'Senha', <KeyRound key="k" />],
                  ['banco', 'Conta bancária', <Landmark key="l" />],
                  ['cartao', 'Cartão', <CreditCard key="c" />],
                  ['nota', 'Nota segura', <NotebookPen key="n" />],
                ] as const
              ).map(([tipo, rotulo, icone]) => (
                <button
                  key={tipo}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuNovo(false)
                    novoRegisto(tipo)
                  }}
                  className={cn('flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/10 [&_svg]:size-4 [&_svg]:text-accent', tipo === tipoDaPagina && 'bg-white/5')}
                >
                  {icone}
                  {rotulo}
                  {tipo === tipoDaPagina && <span className="ml-auto text-[10.5px] text-faint">Ctrl+N</span>}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  )
}
