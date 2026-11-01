import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  MoreHorizontal,
  Repeat,
  Search,
  Trash2,
  TrendingDown,
  Wallet,
} from 'lucide-react'
import { api, descartado, ignorarDescartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import type { Movimento, ResumoGastos } from '@/lib/tipos'
import { plural } from '@/lib/formatos'
import { cn } from '@/lib/utils'
import { avisar, erroParaTexto } from '@/componentes/avisos'
import { FilaComSetas } from '@/componentes/fila'
import { Botao, BotaoIcone, Cartao, confirmar, Spinner, TituloSecao, Vazio } from '@/componentes/ui'

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function useDinheiro(moeda: string) {
  return useMemo(() => {
    const f = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: moeda || 'EUR' })
    const c = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: moeda || 'EUR', maximumFractionDigits: 0 })
    return { completo: (cent: number) => f.format(cent / 100), curto: (cent: number) => c.format(cent / 100) }
  }, [moeda])
}

/** Gastos a partir dos extratos importados. Tudo é calculado na camada nativa, neste PC. */
export function Gastos() {
  const versao = useSessao((s) => s.versao)
  const [periodo, setPeriodo] = useState<{ ano?: number; mes?: number }>({})
  const [moeda, setMoeda] = useState<string | undefined>()
  const [dados, setDados] = useState<ResumoGastos | null>(null)

  useEffect(() => {
    let vivo = true
    api
      .resumoGastos(periodo.ano, periodo.mes, moeda)
      .then((d) => vivo && setDados(d))
      .catch(ignorarDescartado)
      .catch((e) => avisar('erro', erroParaTexto(e)))
    return () => {
      vivo = false
    }
  }, [periodo, moeda, versao])

  if (!dados)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )

  const importar = () => useSessao.getState().abrirImportar('extrato')

  if (dados.totalMovimentos === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-10">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Os teus <span className="text-brand-gradient">gastos</span>
          </h1>
          <Cartao className="mt-8">
            <Vazio
              icone={<Wallet />}
              titulo="Importa o primeiro extrato"
              texto="Exporta o extrato do Revolut (ou de outro banco) em CSV e importa-o. O LisSecurity organiza os gastos por categoria, mostra para onde vai o dinheiro e deteta subscrições — tudo cifrado e sem ligar ao banco."
              acao={
                <Botao icone={<FileSpreadsheet />} onClick={importar}>
                  Importar extrato
                </Botao>
              }
            />
          </Cartao>
        </div>
      </div>
    )
  }

  return <Painel dados={dados} aoMudarPeriodo={setPeriodo} moeda={moeda} aoMudarMoeda={setMoeda} aoImportar={importar} />
}

function Painel({
  dados,
  aoMudarPeriodo,
  aoMudarMoeda,
  aoImportar,
}: {
  dados: ResumoGastos
  aoMudarPeriodo: (p: { ano: number; mes: number }) => void
  moeda?: string
  aoMudarMoeda: (m: string) => void
  aoImportar: () => void
}) {
  const r = dados.resumo
  const din = useDinheiro(r.moeda)
  const nomes = useMemo(() => Object.fromEntries(dados.categorias), [dados.categorias])
  const variacao = r.gastosMesAnterior > 0 ? Math.round(((r.gastos - r.gastosMesAnterior) / r.gastosMesAnterior) * 100) : null
  const chave = (a: number, m: number) => a * 12 + m
  const podeAnterior = dados.primeiro ? chave(r.ano, r.mes) > chave(dados.primeiro[0], dados.primeiro[1]) : false
  const podeSeguinte = dados.ultimo ? chave(r.ano, r.mes) < chave(dados.ultimo[0], dados.ultimo[1]) : false
  const mover = (d: number) => {
    const t = r.ano * 12 + (r.mes - 1) + d
    aoMudarPeriodo({ ano: Math.floor(t / 12), mes: (t % 12) + 1 })
  }
  const recorrenteMensal = dados.recorrentes.reduce((n, x) => n + x.valor, 0)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-10 px-8 py-8">
        {/* cabeçalho */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">
              Os teus <span className="text-brand-gradient">gastos</span>
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              A partir de {plural(dados.totalMovimentos, 'movimento importado', 'movimentos importados')} ({dados.origens.join(', ')}). Para atualizar, importa um extrato mais recente.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dados.moedas.length > 1 && (
              <select
                aria-label="Moeda"
                value={r.moeda}
                onChange={(e) => aoMudarMoeda(e.target.value)}
                className="h-10 cursor-pointer rounded-full border border-border bg-raised px-3.5 text-[13px] font-semibold text-text outline-none focus:border-accent/50"
              >
                {dados.moedas.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            )}
            <Botao icone={<FileSpreadsheet />} onClick={aoImportar}>
              Importar extrato
            </Botao>
            <MenuMovimentos origens={dados.origens} />
          </div>
        </div>

        {/* mês */}
        <div className="flex items-center gap-2">
          <BotaoIcone rotulo="Mês anterior" tamanho="sm" disabled={!podeAnterior} onClick={() => mover(-1)}>
            <ChevronLeft />
          </BotaoIcone>
          <h2 className="min-w-44 text-center text-[17px] font-bold capitalize" aria-live="polite">
            {MESES[r.mes - 1]} {r.ano}
          </h2>
          <BotaoIcone rotulo="Mês seguinte" tamanho="sm" disabled={!podeSeguinte} onClick={() => mover(1)}>
            <ChevronRight />
          </BotaoIcone>
        </div>

        {/* números do mês */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Numero rotulo="Gastos do mês" valor={din.completo(r.gastos)} icone={<TrendingDown />}>
            {variacao !== null && (
              <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-semibold', variacao > 0 ? 'text-warn' : 'text-accent')}>
                {variacao > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                {Math.abs(variacao)}% vs mês anterior
              </span>
            )}
          </Numero>
          <Numero rotulo="Entradas" valor={din.completo(r.entradas)} icone={<ArrowDownRight />} />
          <Numero rotulo="Saldo do mês" valor={din.completo(r.entradas - r.gastos)} icone={<Wallet />} />
          <Numero rotulo="Recorrentes por mês" valor={din.completo(recorrenteMensal)} icone={<Repeat />}>
            <span className="text-[11px] text-faint">{plural(dados.recorrentes.length, 'pagamento', 'pagamentos')}</span>
          </Numero>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <section>
            <TituloSecao>Gasto por dia</TituloSecao>
            <Cartao className="p-5">
              <Colunas
                valores={r.porDia}
                rotulos={r.porDia.map((_, i) => String(i + 1))}
                mostrarRotulo={(i) => i === 0 || (i + 1) % 5 === 0}
                dica={(i, v) => `${i + 1} de ${MESES[r.mes - 1]}: ${din.completo(v)}`}
                formatarEixo={din.curto}
                destaque={-1}
              />
            </Cartao>
          </section>
          <section>
            <TituloSecao>Últimos 6 meses</TituloSecao>
            <Cartao className="p-5">
              <Colunas
                valores={dados.evolucao.map((e) => e.gastos)}
                rotulos={dados.evolucao.map((e) => MESES_CURTOS[e.mes - 1])}
                mostrarRotulo={() => true}
                dica={(i, v) => `${MESES[dados.evolucao[i].mes - 1]} ${dados.evolucao[i].ano}: ${din.completo(v)} gastos`}
                formatarEixo={din.curto}
                destaque={dados.evolucao.length - 1}
              />
            </Cartao>
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <TituloSecao>Por categoria</TituloSecao>
            <Cartao className="space-y-3 p-5">
              {r.porCategoria.length === 0 ? (
                <p className="text-[13px] text-muted">Sem gastos neste mês.</p>
              ) : (
                r.porCategoria.map((c, i) => <Barra key={c.chave} rotulo={nomes[c.chave] ?? c.chave} valor={c.total} total={r.gastos} texto={`${din.completo(c.total)}`} detalhe={plural(c.n, 'movimento', 'movimentos')} i={i} />)
              )}
            </Cartao>
          </section>
          <section>
            <TituloSecao>Onde gastas mais</TituloSecao>
            <Cartao className="divide-y divide-border/60 overflow-hidden">
              {r.comerciantes.length === 0 ? (
                <p className="p-5 text-[13px] text-muted">Sem gastos neste mês.</p>
              ) : (
                r.comerciantes.map((c, i) => (
                  <div key={c.chave} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-5 text-right text-[11px] font-bold tabular-nums text-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold capitalize">{c.chave || '—'}</span>
                    <span className="text-[11px] text-faint">{c.n}×</span>
                    <span className="w-24 text-right text-[13px] font-semibold tabular-nums">{din.completo(c.total)}</span>
                  </div>
                ))
              )}
            </Cartao>
          </section>
        </div>

        {dados.recorrentes.length > 0 && (
          <section>
            <TituloSecao>Pagamentos recorrentes</TituloSecao>
            <p className="-mt-1.5 mb-3 text-[12.5px] text-muted">
              Saídas parecidas para o mesmo sítio em 3 ou mais meses — quase sempre subscrições ou contas fixas. Somam cerca de {din.completo(recorrenteMensal)} por mês ({din.completo(recorrenteMensal * 12)} por ano).
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {dados.recorrentes.map((x) => (
                <Cartao key={x.comerciante} className="flex items-center gap-3 p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <Repeat className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold capitalize">{x.comerciante}</span>
                    <span className="block truncate text-[11.5px] text-muted">
                      {nomes[x.categoria] ?? x.categoria} · há {x.meses} meses
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[14px] font-bold tabular-nums">{din.completo(x.valor)}</span>
                    <span className="block text-[10.5px] text-faint">por mês</span>
                  </span>
                </Cartao>
              ))}
            </div>
          </section>
        )}

        <ListaMovimentos ano={r.ano} mes={r.mes} moeda={r.moeda} nomes={nomes} categorias={dados.categorias} />

        <p className="pb-4 text-center text-[11.5px] text-faint">
          Os movimentos ficam cifrados no cofre (e nas cópias de segurança). Não há ligação ao banco: nada é enviado para lado nenhum.
        </p>
      </div>
    </div>
  )
}

function Numero({ rotulo, valor, icone, children }: { rotulo: string; valor: string; icone: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Cartao className="p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-accent-soft p-2.5 text-accent [&_svg]:size-[18px]">{icone}</div>
        <div className="min-w-0">
          <p className="truncate text-xl font-extrabold leading-none tabular-nums">{valor}</p>
          <p className="mt-1 truncate text-[11px] text-muted">{rotulo}</p>
          {children && <div className="mt-1">{children}</div>}
        </div>
      </div>
    </Cartao>
  )
}

/** Colunas de uma só série (sem legenda: o título diz o que é), com dica ao passar o rato. */
function Colunas({
  valores,
  rotulos,
  mostrarRotulo,
  dica,
  formatarEixo,
  destaque,
}: {
  valores: number[]
  rotulos: string[]
  mostrarRotulo: (i: number) => boolean
  dica: (i: number, v: number) => string
  formatarEixo: (v: number) => string
  destaque: number
}) {
  const [ativo, setAtivo] = useState<number | null>(null)
  const max = Math.max(1, ...valores)
  // eixo arredondado: 0, metade e topo "redondos"
  const passo = Math.pow(10, Math.floor(Math.log10(max)))
  const topo = Math.ceil(max / passo) * passo
  const alturaPx = 160
  return (
    <div className="relative" onMouseLeave={() => setAtivo(null)}>
      <div className="flex">
        <div className="relative mr-2 w-14 shrink-0 text-right text-[10.5px] tabular-nums text-faint" style={{ height: alturaPx }}>
          <span className="absolute right-0 top-0 -translate-y-1/2">{formatarEixo(topo)}</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2">{formatarEixo(topo / 2)}</span>
          <span className="absolute bottom-0 right-0 translate-y-1/2">{formatarEixo(0)}</span>
        </div>
        <div className="relative flex-1" style={{ height: alturaPx }}>
          {/* grelha recessiva */}
          <div className="absolute inset-x-0 top-0 h-px bg-border/70" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-border/70" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-border-strong" />
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {valores.map((v, i) => (
              <div
                key={i}
                className="relative flex h-full flex-1 cursor-default items-end justify-center"
                onMouseEnter={() => setAtivo(i)}
                onFocus={() => setAtivo(i)}
                tabIndex={0}
                role="img"
                aria-label={dica(i, v)}
              >
                <motion.div
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.4, delay: Math.min(i, 30) * 0.012, ease: [0.22, 1, 0.36, 1] }}
                  className="w-full max-w-6 origin-bottom rounded-t-[4px] transition-opacity"
                  style={{
                    height: `${(v / topo) * 100}%`,
                    minHeight: v > 0 ? 2 : 0,
                    background: 'var(--color-accent)',
                    opacity: ativo === null ? (destaque < 0 || destaque === i ? 1 : 0.45) : ativo === i ? 1 : 0.35,
                  }}
                />
              </div>
            ))}
          </div>
          <AnimatePresence>
            {ativo !== null && (
              <motion.div
                key="dica"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-text shadow-card"
                style={{ left: `${((ativo + 0.5) / valores.length) * 100}%` }}
              >
                {dica(ativo, valores[ativo])}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="ml-16 mt-2 flex gap-[2px] text-[10px] text-faint">
        {rotulos.map((rot, i) => (
          <span key={i} className="flex-1 text-center tabular-nums">
            {mostrarRotulo(i) ? rot : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function Barra({ rotulo, valor, total, texto, detalhe, i }: { rotulo: string; valor: number; total: number; texto: string; detalhe: string; i: number }) {
  const pct = total > 0 ? (valor / total) * 100 : 0
  return (
    <div title={`${rotulo}: ${texto} (${Math.round(pct)}%) · ${detalhe}`}>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="truncate font-semibold text-text">{rotulo}</span>
        <span className="shrink-0 tabular-nums text-muted">
          {texto} <span className="text-faint">· {Math.round(pct)}%</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-raised">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
          className="h-full rounded-full bg-accent"
        />
      </div>
    </div>
  )
}

function ListaMovimentos({ ano, mes, moeda, nomes, categorias }: { ano: number; mes: number; moeda: string; nomes: Record<string, string>; categorias: [string, string][] }) {
  const versao = useSessao((s) => s.versao)
  const din = useDinheiro(moeda)
  const [categoria, setCategoria] = useState('')
  const [texto, setTexto] = useState('')
  const [lista, setLista] = useState<Movimento[] | null>(null)
  const [editar, setEditar] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => {
      api
        .listarMovimentos(ano, mes, moeda, categoria || undefined, texto || undefined)
        .then((l) => vivo && setLista(l))
        .catch(ignorarDescartado)
        .catch(() => {})
    }, 80)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [ano, mes, moeda, categoria, texto, versao])

  const mudarCategoria = async (m: Movimento, nova: string, todos: boolean) => {
    setEditar(null)
    try {
      const n = await api.categorizarMovimento(m.id, nova, todos)
      avisar('sucesso', todos ? `${plural(n, 'movimento atualizado', 'movimentos atualizados')}. Os próximos extratos seguem esta regra.` : 'Categoria alterada.')
      useSessao.getState().mudou()
    } catch (e) {
      if (descartado(e)) return
      avisar('erro', erroParaTexto(e))
    }
  }

  return (
    <section>
      <TituloSecao>Movimentos do mês</TituloSecao>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden="true" />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Procurar descrição…"
            aria-label="Procurar movimentos"
            className="h-9 w-full rounded-full border border-border bg-raised pl-10 pr-4 text-[13px] text-text placeholder:text-faint outline-none focus:border-accent/50"
          />
        </div>
        <FilaComSetas rotulo="Filtrar por categoria" className="min-w-0 flex-1">
          {[['', 'Todas'] as [string, string], ...categorias].map(([c, n]) => (
            <button
              key={c || 'todas'}
              type="button"
              aria-pressed={categoria === c}
              onClick={() => setCategoria(c)}
              className={cn(
                'shrink-0 cursor-pointer rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-colors',
                categoria === c ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border text-muted hover:text-text',
              )}
            >
              {n}
            </button>
          ))}
        </FilaComSetas>
      </div>
      <Cartao className="overflow-hidden">
        {lista === null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : lista.length === 0 ? (
          <p className="p-6 text-center text-[13px] text-muted">Nenhum movimento com estes filtros.</p>
        ) : (
          <table className="w-full text-[13px]">
            <caption className="sr-only">Movimentos de {MESES[mes - 1]} de {ano}</caption>
            <thead>
              <tr className="border-b border-border text-left text-[10.5px] font-bold tracking-widest text-faint">
                <th className="px-4 py-2.5 font-bold">DATA</th>
                <th className="px-2 py-2.5 font-bold">DESCRIÇÃO</th>
                <th className="px-2 py-2.5 font-bold">CATEGORIA</th>
                <th className="px-4 py-2.5 text-right font-bold">VALOR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {lista.map((m) => (
                <tr key={m.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">{new Date(m.data).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', timeZone: 'UTC' })}</td>
                  <td className="max-w-0 px-2 py-2.5">
                    <span className="block truncate font-medium text-text" title={m.descricao}>
                      {m.descricao}
                    </span>
                  </td>
                  <td className="relative px-2 py-2.5">
                    <button
                      type="button"
                      onClick={() => setEditar(editar === m.id ? null : m.id)}
                      className="cursor-pointer rounded-full border border-border bg-raised px-2.5 py-0.5 text-[11px] font-semibold text-muted transition-colors hover:border-accent/40 hover:text-accent"
                      title="Mudar a categoria"
                    >
                      {nomes[m.categoria] ?? m.categoria}
                    </button>
                    {editar === m.id && <EscolherCategoria categorias={categorias} atual={m.categoria} aoEscolher={(c, todos) => void mudarCategoria(m, c, todos)} aoFechar={() => setEditar(null)} />}
                  </td>
                  <td className={cn('whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums', m.valor > 0 ? 'text-accent' : 'text-text')}>
                    {m.valor > 0 ? '+' : ''}
                    {din.completo(m.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Cartao>
    </section>
  )
}

function EscolherCategoria({ categorias, atual, aoEscolher, aoFechar }: { categorias: [string, string][]; atual: string; aoEscolher: (c: string, todos: boolean) => void; aoFechar: () => void }) {
  const [todos, setTodos] = useState(true)
  const raiz = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fora = (e: MouseEvent) => !raiz.current?.contains(e.target as Node) && aoFechar()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar()
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aoFechar])
  return (
    <motion.div
      ref={raiz}
      role="menu"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute left-0 top-full z-30 mt-1 w-60 rounded-xl border border-border bg-card p-1.5 shadow-card"
    >
      <label className="mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11.5px] text-muted">
        <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} className="size-3.5 accent-[var(--color-accent)]" />
        Aplicar a todos deste comerciante
      </label>
      <div className="max-h-60 overflow-y-auto">
        {categorias.map(([c, n]) => (
          <button
            key={c}
            type="button"
            role="menuitemradio"
            aria-checked={c === atual}
            onClick={() => aoEscolher(c, todos)}
            className={cn('flex w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-white/10', c === atual ? 'text-accent' : 'text-text')}
          >
            {n}
          </button>
        ))}
      </div>
    </motion.div>
  )
}

function MenuMovimentos({ origens }: { origens: string[] }) {
  const [aberto, setAberto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => !raiz.current?.contains(e.target as Node) && setAberto(false)
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])
  const apagar = async (origem?: string) => {
    setAberto(false)
    const ok = await confirmar({
      titulo: origem ? `Apagar os movimentos de ${origem}?` : 'Apagar todos os movimentos?',
      texto: 'Os movimentos saem do cofre (as regras de categoria ficam). Podes voltar a importar os extratos quando quiseres. As cópias de segurança anteriores continuam a tê-los.',
      confirmar: 'Apagar movimentos',
      perigo: true,
    })
    if (!ok) return
    try {
      const n = await api.eliminarMovimentos(origem)
      avisar('sucesso', `${plural(n, 'movimento apagado', 'movimentos apagados')}.`)
      useSessao.getState().mudou()
    } catch (e) {
      if (descartado(e)) return
      avisar('erro', erroParaTexto(e))
    }
  }
  return (
    <div ref={raiz} className="relative">
      <BotaoIcone rotulo="Mais opções" aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
        <MoreHorizontal />
      </BotaoIcone>
      {aberto && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 min-w-60 rounded-xl border border-border bg-card p-1.5 shadow-card">
          {origens.length > 1 &&
            origens.map((o) => (
              <button key={o} type="button" role="menuitem" onClick={() => void apagar(o)} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-danger hover:bg-white/10">
                <Trash2 className="size-4" /> Apagar movimentos de {o}
              </button>
            ))}
          <button type="button" role="menuitem" onClick={() => void apagar()} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-danger hover:bg-white/10">
            <Trash2 className="size-4" /> Apagar todos os movimentos
          </button>
        </div>
      )}
    </div>
  )
}
