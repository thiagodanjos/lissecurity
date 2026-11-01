import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArchiveRestore,
  ChartColumnBig,
  FileSpreadsheet,
  Upload,
  CornerDownLeft,
  CreditCard,
  HardDriveDownload,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Lock,
  NotebookPen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Wallet,
  WandSparkles,
} from 'lucide-react'
import { api, ignorarDescartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import { bloquearAgora, criarCopiaAgora, novoRegisto } from '@/lib/acoes'
import type { Resumo, TipoItem } from '@/lib/tipos'
import { normalizar } from '@/lib/texto'
import { cn } from '@/lib/utils'
import { Kbd } from './ui'

interface Opcao {
  id: string
  rotulo: string
  detalhe?: string
  icone: ReactNode
  grupo: 'Ir para' | 'Ações' | 'Registos'
  executar: () => void
}

export const ICONE_TIPO: Record<TipoItem, ReactNode> = {
  login: <KeyRound />,
  banco: <Landmark />,
  cartao: <CreditCard />,
  nota: <NotebookPen />,
}

/**
 * Paleta de comandos (Ctrl+K): páginas, ações e — só com o cofre aberto — registos pelo
 * título. Fecha com Esc; navega com ↑ ↓ e Enter.
 */
export function Paleta() {
  const aberta = useSessao((s) => s.paletaAberta)
  const fase = useSessao((s) => s.fase)
  const { definirPaleta, irPara, abrirRegisto } = useSessao.getState()
  const [texto, setTexto] = useState('')
  const [ativo, setAtivo] = useState(0)
  const [registos, setRegistos] = useState<Resumo[]>([])
  const campo = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (aberta) {
      setTexto('')
      setAtivo(0)
      setRegistos([])
      setTimeout(() => campo.current?.focus(), 20)
    }
  }, [aberta])

  // registos: só a partir de 2 letras, e só títulos/subtítulos (nunca segredos)
  useEffect(() => {
    if (!aberta || fase !== 'desbloqueado' || texto.trim().length < 2) {
      setRegistos([])
      return
    }
    let vivo = true
    const t = setTimeout(() => {
      api
        .listar({ texto, ordem: 'titulo' })
        .then((r) => vivo && setRegistos(r.slice(0, 8)))
        .catch(ignorarDescartado)
        .catch(() => {})
    }, 90)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [texto, aberta, fase])

  const fechar = () => definirPaleta(false)

  const opcoes = useMemo<Opcao[]>(() => {
    const base: Opcao[] = [
      { id: 'p-inicio', grupo: 'Ir para', rotulo: 'Visão geral', icone: <LayoutDashboard />, executar: () => irPara('inicio') },
      { id: 'p-senhas', grupo: 'Ir para', rotulo: 'Ir ao cofre de senhas', icone: <KeyRound />, executar: () => irPara('senhas') },
      { id: 'p-bancos', grupo: 'Ir para', rotulo: 'Abrir dados bancários', icone: <Landmark />, executar: () => irPara('bancos') },
      { id: 'p-cartoes', grupo: 'Ir para', rotulo: 'Abrir cartões', icone: <CreditCard />, executar: () => irPara('cartoes') },
      { id: 'p-notas', grupo: 'Ir para', rotulo: 'Notas seguras', icone: <NotebookPen />, executar: () => irPara('notas') },
      { id: 'p-financeiro', grupo: 'Ir para', rotulo: 'Resumo financeiro', icone: <Wallet />, executar: () => irPara('financeiro') },
      { id: 'p-gastos', grupo: 'Ir para', rotulo: 'Ver os gastos', icone: <ChartColumnBig />, executar: () => irPara('gastos') },
      { id: 'p-seguranca', grupo: 'Ir para', rotulo: 'Segurança', icone: <ShieldCheck />, executar: () => irPara('seguranca') },
      { id: 'p-copias', grupo: 'Ir para', rotulo: 'Abrir cópias de segurança', icone: <ArchiveRestore />, executar: () => irPara('copias') },
      { id: 'p-definicoes', grupo: 'Ir para', rotulo: 'Definições', icone: <Settings />, executar: () => irPara('definicoes') },
      { id: 'a-senha', grupo: 'Ações', rotulo: 'Criar registo de senha', icone: <Plus />, executar: () => novoRegisto('login') },
      { id: 'a-banco', grupo: 'Ações', rotulo: 'Adicionar conta bancária', icone: <Plus />, executar: () => novoRegisto('banco') },
      { id: 'a-cartao', grupo: 'Ações', rotulo: 'Adicionar cartão', icone: <Plus />, executar: () => novoRegisto('cartao') },
      { id: 'a-nota', grupo: 'Ações', rotulo: 'Criar nota segura', icone: <Plus />, executar: () => novoRegisto('nota') },
      { id: 'a-gerar', grupo: 'Ações', rotulo: 'Gerar senha', icone: <WandSparkles />, executar: () => irPara('gerador') },
      { id: 'a-importar-senhas', grupo: 'Ações', rotulo: 'Importar senhas (CSV de outro gestor ou navegador)', icone: <Upload />, executar: () => useSessao.getState().abrirImportar('senhas') },
      { id: 'a-importar-extrato', grupo: 'Ações', rotulo: 'Importar extrato do Revolut (CSV)', icone: <FileSpreadsheet />, executar: () => useSessao.getState().abrirImportar('extrato') },
      { id: 'a-copia', grupo: 'Ações', rotulo: 'Criar cópia de segurança agora', icone: <HardDriveDownload />, executar: () => void criarCopiaAgora() },
      { id: 'a-bloquear', grupo: 'Ações', rotulo: 'Bloquear imediatamente', detalhe: 'Ctrl+L', icone: <Lock />, executar: () => bloquearAgora() },
    ]
    const q = normalizar(texto.trim())
    const filtradas = q ? base.filter((o) => normalizar(o.rotulo).includes(q)) : base
    const regs: Opcao[] = registos.map((r) => ({
      id: `r-${r.id}`,
      grupo: 'Registos',
      rotulo: r.titulo,
      detalhe: r.subtitulo,
      icone: ICONE_TIPO[r.tipo],
      executar: () => abrirRegisto(r.tipo, r.id),
    }))
    return [...regs, ...filtradas]
  }, [texto, registos, irPara, abrirRegisto])

  useEffect(() => setAtivo(0), [opcoes.length])
  useEffect(() => {
    lista.current?.querySelector(`[data-indice="${ativo}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [ativo])

  const executar = (o: Opcao | undefined) => {
    if (!o) return
    fechar()
    o.executar()
  }

  let grupoAnterior = ''
  return (
    <AnimatePresence>
      {aberta && fase === 'desbloqueado' && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onMouseDown={(e) => e.target === e.currentTarget && fechar()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Pesquisar páginas e ações"
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-card"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
              <input
                ref={campo}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Pesquisar páginas, ações e registos…"
                aria-label="Pesquisar"
                aria-controls="paleta-lista"
                aria-activedescendant={opcoes[ativo] ? `paleta-${opcoes[ativo].id}` : undefined}
                autoComplete="off"
                spellCheck={false}
                className="flex-1 bg-transparent text-sm text-text placeholder:text-faint outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setAtivo((a) => Math.min(a + 1, opcoes.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setAtivo((a) => Math.max(a - 1, 0))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    executar(opcoes[ativo])
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    fechar()
                  }
                }}
              />
              <Kbd className="shrink-0">Esc</Kbd>
            </div>
            <div ref={lista} id="paleta-lista" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
              {opcoes.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted">Nada encontrado.</p>
              ) : (
                opcoes.map((o, i) => {
                  const cabecalho = o.grupo !== grupoAnterior ? o.grupo : null
                  grupoAnterior = o.grupo
                  return (
                    <div key={o.id}>
                      {cabecalho && <p className="px-3 pb-1 pt-2.5 text-[10px] font-bold tracking-widest text-faint">{cabecalho.toUpperCase()}</p>}
                      <button
                        id={`paleta-${o.id}`}
                        type="button"
                        role="option"
                        aria-selected={i === ativo}
                        data-indice={i}
                        onClick={() => executar(o)}
                        onMouseMove={() => setAtivo(i)}
                        className={cn(
                          'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors',
                          i === ativo ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text',
                        )}
                      >
                        <span className="shrink-0 [&_svg]:size-4">{o.icone}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {o.rotulo}
                          {o.detalhe && o.grupo === 'Registos' && <span className="ml-2 text-[12px] text-faint">{o.detalhe}</span>}
                        </span>
                        {o.detalhe && o.grupo !== 'Registos' && <span className="text-[11px] text-faint">{o.detalhe}</span>}
                        {i === ativo && <CornerDownLeft className="size-3.5 shrink-0 text-accent/70" aria-hidden="true" />}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
