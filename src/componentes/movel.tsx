// Peças da disposição móvel (Android): cabeçalho, navegação em baixo, botão de novo registo,
// folha «Mais» e pesquisa em ecrã inteiro. A lógica é a mesma do computador (as mesmas páginas,
// os mesmos comandos); muda só a forma de lá chegar com o polegar.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArchiveRestore,
  ArrowLeft,
  ChartColumnBig,
  ChevronRight,
  CircleHelp,
  CreditCard,
  House,
  KeyRound,
  Landmark,
  LayoutGrid,
  Lock,
  NotebookPen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  Wallet,
  WandSparkles,
  X,
} from 'lucide-react'
import { api, ignorarDescartado } from '@/lib/ipc'
import { useSessao, type Pagina } from '@/lib/sessao'
import type { Resumo, TipoItem } from '@/lib/tipos'
import { bloquearAgora, novoRegisto } from '@/lib/acoes'
import { mascararIdentificacao } from '@/lib/formatos'
import { useVoltar } from '@/lib/movel'
import { cn } from '@/lib/utils'
import { IconeRegisto } from './registo'
import { Simbolo } from './ui'
import { useAjuda } from './ajuda'

/* ───────────────────────── folha que sobe do fundo ───────────────────────── */

export function Folha({ aberta, aoFechar, titulo, children }: { aberta: boolean; aoFechar: () => void; titulo?: string; children: ReactNode }) {
  useVoltar(aberta, aoFechar)
  return (
    <AnimatePresence>
      {aberta && (
        <motion.div
          className="fixed inset-0 z-[80] flex flex-col justify-end bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={(e) => e.target === e.currentTarget && aoFechar()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={titulo}
            className="max-h-[85%] overflow-y-auto rounded-t-[28px] border-t border-border bg-card pb-[calc(var(--sistema-baixo,0px)+12px)] shadow-sobreposicao"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) aoFechar()
            }}
          >
            <div className="flex justify-center pb-1 pt-3" aria-hidden="true">
              <span className="h-1.5 w-10 rounded-full bg-border-strong" />
            </div>
            {titulo && <h2 className="px-6 pb-2 pt-2 text-[17px] font-bold">{titulo}</h2>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function LinhaFolha({ icone, rotulo, descricao, onClick, perigo, ativo }: { icone: ReactNode; rotulo: string; descricao?: string; onClick: () => void; perigo?: boolean; ativo?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-14 w-full cursor-pointer items-center gap-4 px-6 py-3 text-left transition-colors active:bg-card-hover [&>svg]:size-5 [&>svg]:shrink-0',
        perigo ? 'text-danger' : ativo ? 'text-accent' : 'text-text',
      )}
    >
      {icone}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{rotulo}</span>
        {descricao && <span className="block text-[12.5px] text-muted">{descricao}</span>}
      </span>
      {!perigo && <ChevronRight className="!size-4 text-faint" aria-hidden="true" />}
    </button>
  )
}

/* ───────────────────────── cabeçalho ───────────────────────── */

export function CabecalhoMovel({ aoPesquisar }: { aoPesquisar: () => void }) {
  return (
    <header className="z-20 flex shrink-0 items-center gap-2 border-b border-border/50 bg-sidebar/95 px-4 pb-2 pt-[calc(var(--sistema-topo,0px)+8px)] backdrop-blur">
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <Simbolo className="size-8 shrink-0" brilho={false} />
        <span className="truncate text-[17px] font-extrabold tracking-tight">
          Lis<span className="text-accent">Security</span>
        </span>
      </span>
      <BotaoRedondo rotulo="Procurar no cofre" onClick={aoPesquisar}>
        <Search />
      </BotaoRedondo>
      <BotaoRedondo rotulo="Bloquear o cofre" onClick={() => bloquearAgora('manual')}>
        <Lock />
      </BotaoRedondo>
    </header>
  )
}

function BotaoRedondo({ rotulo, onClick, children }: { rotulo: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors active:bg-card-hover active:text-text [&_svg]:size-[21px]"
    >
      {children}
    </button>
  )
}

/* ───────────────────────── navegação em baixo ───────────────────────── */

const SEPARADORES: { id: string; rotulo: string; icone: ReactNode; pagina?: Pagina; paginas: Pagina[] }[] = [
  { id: 'inicio', rotulo: 'Início', icone: <House />, pagina: 'inicio', paginas: ['inicio'] },
  { id: 'senhas', rotulo: 'Senhas', icone: <KeyRound />, pagina: 'senhas', paginas: ['senhas'] },
  { id: 'financeiro', rotulo: 'Financeiro', icone: <Wallet />, pagina: 'financeiro', paginas: ['financeiro', 'gastos', 'bancos', 'cartoes'] },
  { id: 'gerador', rotulo: 'Gerador', icone: <WandSparkles />, pagina: 'gerador', paginas: ['gerador'] },
  { id: 'mais', rotulo: 'Mais', icone: <LayoutGrid />, paginas: ['notas', 'seguranca', 'copias', 'definicoes'] },
]

export function NavegacaoMovel({ aoAbrirMais }: { aoAbrirMais: () => void }) {
  const pagina = useSessao((s) => s.pagina)
  const irPara = useSessao((s) => s.irPara)
  return (
    <nav aria-label="Secções" className="z-20 flex shrink-0 border-t border-border/60 bg-sidebar/95 pb-[var(--sistema-baixo,0px)] backdrop-blur">
      {SEPARADORES.map((s) => {
        const ativo = s.paginas.includes(pagina)
        return (
          <button
            key={s.id}
            type="button"
            aria-current={ativo ? 'page' : undefined}
            onClick={() => (s.pagina ? irPara(s.pagina) : aoAbrirMais())}
            className={cn('relative flex min-h-16 flex-1 cursor-pointer flex-col items-center justify-center gap-1 pt-1 text-[11.5px] font-semibold transition-colors', ativo ? 'text-accent' : 'text-faint active:text-text')}
          >
            <span className={cn('flex h-8 w-14 items-center justify-center rounded-full transition-colors [&_svg]:size-[21px]', ativo && 'bg-accent-soft')}>{s.icone}</span>
            {s.rotulo}
          </button>
        )
      })}
    </nav>
  )
}

/* ───────────────────────── folha «Mais» ───────────────────────── */

export function FolhaMais({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  const pagina = useSessao((s) => s.pagina)
  const ir = (p: Pagina) => {
    aoFechar()
    useSessao.getState().irPara(p)
  }
  return (
    <Folha aberta={aberta} aoFechar={aoFechar} titulo="Mais">
      <p className="px-6 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-faint">Cofre</p>
      <LinhaFolha icone={<NotebookPen />} rotulo="Notas seguras" descricao="Notas, códigos de recuperação, licenças" onClick={() => ir('notas')} ativo={pagina === 'notas'} />
      <p className="px-6 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-faint">Financeiro</p>
      <LinhaFolha icone={<Landmark />} rotulo="Dados bancários" onClick={() => ir('bancos')} ativo={pagina === 'bancos'} />
      <LinhaFolha icone={<CreditCard />} rotulo="Cartões" onClick={() => ir('cartoes')} ativo={pagina === 'cartoes'} />
      <LinhaFolha icone={<ChartColumnBig />} rotulo="Gastos" descricao="A partir dos extratos que importares" onClick={() => ir('gastos')} ativo={pagina === 'gastos'} />
      <p className="px-6 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-faint">Ferramentas</p>
      <LinhaFolha icone={<ShieldCheck />} rotulo="Segurança" descricao="Senhas fracas, repetidas e antigas" onClick={() => ir('seguranca')} ativo={pagina === 'seguranca'} />
      <LinhaFolha icone={<ArchiveRestore />} rotulo="Cópias de segurança" descricao="Guardar, partilhar e restaurar" onClick={() => ir('copias')} ativo={pagina === 'copias'} />
      <LinhaFolha
        icone={<Upload />}
        rotulo="Importar senhas"
        descricao="CSV do Chrome, Edge, Firefox, Bitwarden…"
        onClick={() => {
          aoFechar()
          useSessao.getState().abrirImportar('senhas')
        }}
      />
      <LinhaFolha icone={<Settings />} rotulo="Definições" onClick={() => ir('definicoes')} ativo={pagina === 'definicoes'} />
      <LinhaFolha
        icone={<CircleHelp />}
        rotulo="Ajuda"
        onClick={() => {
          aoFechar()
          useAjuda.getState().abrir('sobre')
        }}
      />
      <div className="mx-6 my-2 h-px bg-border" />
      <LinhaFolha
        icone={<Lock />}
        rotulo="Bloquear agora"
        perigo
        onClick={() => {
          aoFechar()
          bloquearAgora('manual')
        }}
      />
    </Folha>
  )
}

/* ───────────────────────── botão de novo registo ───────────────────────── */

const TIPO_DA_PAGINA: Partial<Record<Pagina, TipoItem>> = { senhas: 'login', notas: 'nota', bancos: 'banco', cartoes: 'cartao' }
const NOVOS: [TipoItem, string, ReactNode][] = [
  ['login', 'Senha', <KeyRound key="k" />],
  ['banco', 'Conta bancária', <Landmark key="l" />],
  ['cartao', 'Cartão', <CreditCard key="c" />],
  ['nota', 'Nota segura', <NotebookPen key="n" />],
]

export function BotaoNovo() {
  const pagina = useSessao((s) => s.pagina)
  const detalheAberto = useSessao((s) => s.detalheAberto)
  const [menu, setMenu] = useState(false)
  if (detalheAberto || !['inicio', 'senhas', 'notas', 'bancos', 'cartoes', 'financeiro'].includes(pagina)) return null
  const tipo = TIPO_DA_PAGINA[pagina]
  return (
    <>
      <motion.button
        type="button"
        aria-label={tipo ? 'Novo registo' : 'Novo registo (escolher o tipo)'}
        onClick={() => (tipo ? novoRegisto(tipo) : setMenu(true))}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileTap={{ scale: 0.92 }}
        className="absolute bottom-4 right-4 z-30 flex size-[60px] cursor-pointer items-center justify-center rounded-[22px] bg-accent text-black shadow-glow"
      >
        <Plus className="size-7" strokeWidth={2.4} />
      </motion.button>
      <Folha aberta={menu} aoFechar={() => setMenu(false)} titulo="Novo registo">
        {NOVOS.filter(([t]) => pagina !== 'financeiro' || t === 'banco' || t === 'cartao').map(([t, rotulo, icone]) => (
          <LinhaFolha
            key={t}
            icone={icone}
            rotulo={rotulo}
            onClick={() => {
              setMenu(false)
              novoRegisto(t)
            }}
          />
        ))}
      </Folha>
    </>
  )
}

/* ───────────────────────── pesquisa em ecrã inteiro ───────────────────────── */

export function PesquisaMovel({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Resumo[]>([])
  const campo = useRef<HTMLInputElement>(null)
  useVoltar(aberta, aoFechar)

  useEffect(() => {
    if (aberta) {
      setTexto('')
      setResultados([])
      setTimeout(() => campo.current?.focus(), 60)
    }
  }, [aberta])

  useEffect(() => {
    if (!texto.trim()) {
      setResultados([])
      return
    }
    let vivo = true
    const t = setTimeout(() => {
      api
        .listar({ texto, ordem: 'titulo' })
        .then((r) => vivo && setResultados(r.slice(0, 40)))
        .catch(ignorarDescartado)
        .catch(() => {})
    }, 80)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [texto])

  return (
    <AnimatePresence>
      {aberta && (
        <motion.div
          className="fixed inset-0 z-[85] flex flex-col bg-bg"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.18 }}
        >
          <div className="flex items-center gap-2 border-b border-border/60 px-2 pb-2 pt-[calc(var(--sistema-topo,0px)+8px)]">
            <BotaoRedondo rotulo="Voltar" onClick={aoFechar}>
              <ArrowLeft />
            </BotaoRedondo>
            <input
              ref={campo}
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Procurar no cofre…"
              aria-label="Procurar no cofre"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              className="h-12 min-w-0 flex-1 rounded-full border border-border bg-raised px-5 text-[16px] text-text placeholder:text-faint outline-none focus:border-accent/50 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {texto && (
              <BotaoRedondo rotulo="Limpar" onClick={() => setTexto('')}>
                <X />
              </BotaoRedondo>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-[var(--sistema-teclado,0px)]">
            {texto.trim() && resultados.length === 0 && <p className="px-6 py-10 text-center text-[14px] text-muted">Nada encontrado no cofre.</p>}
            {!texto.trim() && <p className="px-6 py-10 text-center text-[13.5px] leading-relaxed text-faint">Procura pelo título, utilizador, site, banco ou instituição. As senhas e os números nunca entram na pesquisa.</p>}
            {resultados.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  aoFechar()
                  useSessao.getState().abrirRegisto(r.tipo, r.id)
                }}
                className="flex min-h-16 w-full cursor-pointer items-center gap-3.5 px-5 py-2.5 text-left active:bg-card-hover"
              >
                <IconeRegisto tipo={r.tipo} titulo={r.titulo} dominio={r.dominio} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{r.titulo}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {r.tipo === 'login' ? mascararIdentificacao(r.subtitulo) || r.dominio : r.fim ? `${r.instituicao ?? ''} •••• ${r.fim}` : r.subtitulo}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
