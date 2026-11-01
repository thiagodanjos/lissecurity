import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowRight,
  CalendarClock,
  ChartColumnBig,
  Cloud,
  Copy,
  CreditCard,
  HardDriveDownload,
  KeyRound,
  Landmark,
  NotebookPen,
  Plus,
  Repeat2,
  ShieldCheck,
  Star,
  WandSparkles,
  X,
} from 'lucide-react'
import { api, descartado, ignorarDescartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import type { Resumo, VisaoGeral as Visao } from '@/lib/tipos'
import { haQuanto, mascararIdentificacao, plural } from '@/lib/formatos'
import { criarCopiaAgora, novoRegisto } from '@/lib/acoes'
import { cn } from '@/lib/utils'
import { avisar, erroParaTexto } from '@/componentes/avisos'
import { IconeRegisto } from '@/componentes/registo'
import { Botao, Cartao, Spinner, TituloSecao } from '@/componentes/ui'

// a faixa da primeira cópia pode ser dispensada nesta sessão (não fica guardado em disco)
let faixaDispensada = false

export function VisaoGeral() {
  const versao = useSessao((s) => s.versao)
  const { irPara, abrirRegisto } = useSessao.getState()
  const [v, setV] = useState<Visao | null>(null)
  const [semFaixa, setSemFaixa] = useState(faixaDispensada)
  const [ultimaAuto, setUltimaAuto] = useState<number | null>(null)
  const [mes, setMes] = useState<{ gastos: number; moeda: string; categoria: string | null; variacao: number | null } | null>(null)

  useEffect(() => {
    let vivo = true
    api
      .visaoGeral()
      .then((r) => {
        if (!vivo) return
        setV(r)
        if (r.copiasAutomaticas)
          api
            .estadoCopias()
            .then((e) => vivo && setUltimaAuto(e.ultimaAutomatica))
            .catch(() => {})
        if (r.totalMovimentos > 0)
          api
            .resumoGastos()
            .then((g) => {
              if (!vivo) return
              const nomes = Object.fromEntries(g.categorias)
              const top = g.resumo.porCategoria[0]
              setMes({
                gastos: g.resumo.gastos,
                moeda: g.resumo.moeda,
                categoria: top ? nomes[top.chave] ?? top.chave : null,
                variacao: g.resumo.gastosMesAnterior > 0 ? Math.round(((g.resumo.gastos - g.resumo.gastosMesAnterior) / g.resumo.gastosMesAnterior) * 100) : null,
              })
            })
            .catch(() => {})
      })
      .catch(ignorarDescartado)
      .catch((e) => avisar('erro', erroParaTexto(e)))
    return () => {
      vivo = false
    }
  }, [versao])

  if (!v)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )

  const ultimaCopia = Math.max(v.ultimoBackup ?? 0, ultimaAuto ?? 0) || null
  const estadoCopia = ultimaCopia ? haQuanto(ultimaCopia) : 'Nunca'
  const cartoes = [
    { rotulo: 'Senhas guardadas', valor: v.logins, icone: <KeyRound />, ir: () => irPara('senhas') },
    { rotulo: 'Favoritos', valor: v.favoritosTotal, icone: <Star />, ir: () => irPara('senhas') },
    { rotulo: 'Contas bancárias', valor: v.bancos, icone: <Landmark />, ir: () => irPara('bancos') },
    { rotulo: 'Última cópia de segurança', valor: estadoCopia, icone: <ArchiveRestore />, ir: () => irPara('copias'), aviso: !ultimaCopia && v.total > 0 },
  ]
  const alertas: { icone: ReactNode; texto: string; tom: 'ambar' | 'vermelho'; ir: () => void }[] = []
  if (v.fracas > 0) alertas.push({ icone: <AlertTriangle />, texto: `${plural(v.fracas, 'senha fraca', 'senhas fracas')}`, tom: 'ambar', ir: () => irPara('seguranca') })
  if (v.gruposReutilizados > 0)
    alertas.push({ icone: <Repeat2 />, texto: `${plural(v.gruposReutilizados, 'senha reutilizada', 'senhas reutilizadas')} em ${v.reutilizadas} registos`, tom: 'ambar', ir: () => irPara('seguranca') })
  if (v.cartoesExpirados > 0) alertas.push({ icone: <CreditCard />, texto: `${plural(v.cartoesExpirados, 'cartão expirado', 'cartões expirados')}`, tom: 'vermelho', ir: () => irPara('cartoes') })
  if (v.cartoesAExpirar > 0) alertas.push({ icone: <CalendarClock />, texto: `${plural(v.cartoesAExpirar, 'cartão expira', 'cartões expiram')} nos próximos meses`, tom: 'ambar', ir: () => irPara('cartoes') })
  if (v.antigas > 0) alertas.push({ icone: <CalendarClock />, texto: `${plural(v.antigas, 'senha sem mudar', 'senhas sem mudar')} há mais de um ano`, tom: 'ambar', ir: () => irPara('seguranca') })

  // lembrete: sem cópias automáticas, e a última cópia não existe ou é mais antiga do que o configurado
  const diasDesde = ultimaCopia ? (Date.now() - ultimaCopia) / 86_400_000 : Infinity
  const mostrarFaixa =
    !semFaixa && v.total > 0 && !v.copiasAutomaticas && v.lembreteCopiaDias > 0 && (ultimaCopia === null || (v.alteracoesPorSalvaguardar && diasDesde > v.lembreteCopiaDias))

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-10 px-8 py-8">
        {/* saudação e números */}
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <h1 className="text-3xl font-extrabold tracking-tight [overflow-wrap:anywhere]">
            Bem-vindo{v.nome ? ', ' : ''}
            {v.nome && <span className="text-brand-gradient">{v.nome}</span>}
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {v.total === 0 ? 'O teu cofre está pronto. Começa por guardar a primeira senha.' : `O teu cofre tem ${plural(v.total, 'registo', 'registos')}. Bloqueia-o sempre que te afastares — Ctrl+L.`}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {cartoes.map((c, i) => (
              <motion.button
                key={c.rotulo}
                type="button"
                onClick={c.ir}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + i * 0.06, duration: 0.3 }}
                whileHover={{ y: -3 }}
                className="cursor-pointer text-left"
              >
                <Cartao hover className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn('rounded-xl p-2.5 [&_svg]:size-[18px]', c.aviso ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent')}>{c.icone}</div>
                    <div className="min-w-0">
                      <p className="truncate text-xl font-extrabold leading-none tabular-nums">{c.valor}</p>
                      <p className="mt-1 truncate text-[11px] text-muted">{c.rotulo}</p>
                    </div>
                  </div>
                </Cartao>
              </motion.button>
            ))}
          </div>
        </motion.div>

        {/* destaque discreto: só quando há uma necessidade real */}
        {mostrarFaixa && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="relative flex flex-wrap items-center gap-4 overflow-hidden rounded-2xl border border-accent/20 bg-[linear-gradient(100deg,#10241a_0%,#0f1613_55%,#0d1012_100%)] p-5"
          >
            <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-[radial-gradient(circle,rgb(30_215_96/0.18),transparent_65%)]" />
            <span className="relative flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <HardDriveDownload className="size-5" />
            </span>
            <div className="relative min-w-0 flex-1">
              <h2 className="text-[15px] font-bold">{ultimaCopia ? 'Há alterações sem cópia de segurança' : 'Protege o cofre com cópias no Google Drive'}</h2>
              <p className="mt-0.5 text-[12.5px] text-muted">
                {ultimaCopia
                  ? `A última cópia é de ${haQuanto(ultimaCopia)}. Liga as cópias automáticas para nunca mais te preocupares com isto.`
                  : 'Se perderes este computador, o cofre vai com ele. Com as cópias automáticas, fica uma cópia cifrada no Google Drive sempre que algo muda.'}
              </p>
            </div>
            <Botao className="relative" icone={<Cloud />} onClick={() => irPara('copias')}>
              Ligar cópias automáticas
            </Botao>
            <Botao className="relative" variante="escuro" icone={<HardDriveDownload />} onClick={() => void criarCopiaAgora()}>
              Cópia manual
            </Botao>
            <button
              type="button"
              aria-label="Dispensar"
              title="Dispensar"
              onClick={() => {
                faixaDispensada = true
                setSemFaixa(true)
              }}
              className="relative flex size-8 cursor-pointer items-center justify-center rounded-full text-faint hover:bg-white/10 hover:text-text"
            >
              <X className="size-4" />
            </button>
          </motion.div>
        )}

        {/* gastos do mês (só com extratos importados) */}
        {mes && (
          <motion.button
            type="button"
            onClick={() => irPara('gastos')}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="group flex w-full cursor-pointer flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-border-strong hover:bg-card-hover"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <ChartColumnBig className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] text-muted">Gastos no último mês importado</span>
              <span className="block text-2xl font-extrabold tabular-nums">
                {new Intl.NumberFormat('pt-PT', { style: 'currency', currency: mes.moeda }).format(mes.gastos / 100)}
              </span>
            </span>
            <span className="text-right text-[12.5px] text-muted">
              {mes.categoria && (
                <span className="block">
                  Mais em <span className="font-semibold text-text">{mes.categoria}</span>
                </span>
              )}
              {mes.variacao !== null && (
                <span className={cn('block font-semibold', mes.variacao > 0 ? 'text-warn' : 'text-accent')}>
                  {mes.variacao > 0 ? '+' : ''}
                  {mes.variacao}% vs mês anterior
                </span>
              )}
            </span>
            <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </motion.button>
        )}

        {/* atalhos */}
        <section>
          <TituloSecao>Atalhos</TituloSecao>
          <div className="grid gap-3 sm:grid-cols-3">
            <Atalho icone={<Plus />} titulo="Adicionar senha" texto="Site, aplicação ou serviço" onClick={() => novoRegisto('login')} />
            <Atalho icone={<Landmark />} titulo="Adicionar conta bancária" texto="IBAN, agência, Pix…" onClick={() => novoRegisto('banco')} />
            <Atalho icone={<WandSparkles />} titulo="Gerar senha" texto="Aleatória e local" onClick={() => irPara('gerador')} />
          </div>
        </section>

        <div className="grid gap-10 xl:grid-cols-[1.4fr_1fr]">
          {/* favoritos */}
          <section>
            <TituloSecao
              acao={
                v.favoritosTotal > v.favoritos.length ? (
                  <button type="button" onClick={() => irPara('senhas')} className="cursor-pointer text-[12px] font-semibold text-muted hover:text-accent">
                    Ver todos
                  </button>
                ) : undefined
              }
            >
              Favoritos
            </TituloSecao>
            {v.favoritos.length === 0 ? (
              <Cartao className="px-5 py-6 text-[13px] text-muted">Marca com a estrela os registos que usas mais — aparecem aqui.</Cartao>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {v.favoritos.map((r, i) => (
                  <CartaoRegisto key={r.id} r={r} i={i} abrir={() => abrirRegisto(r.tipo, r.id)} />
                ))}
              </div>
            )}
          </section>

          <div className="space-y-10">
            {/* alertas concretos */}
            <section>
              <TituloSecao acao={<ShieldCheck className="size-4 text-faint" aria-hidden="true" />}>Alertas</TituloSecao>
              {alertas.length === 0 ? (
                <Cartao className="flex items-center gap-3 px-4 py-4 text-[13px] text-muted">
                  <ShieldCheck className="size-5 shrink-0 text-accent" aria-hidden="true" />
                  {v.logins === 0 ? 'Ainda não há senhas para analisar.' : 'Sem senhas fracas, reutilizadas ou cartões a expirar.'}
                </Cartao>
              ) : (
                <div className="space-y-2">
                  {alertas.map((a) => (
                    <button
                      key={a.texto}
                      type="button"
                      onClick={a.ir}
                      className="group flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-card-hover"
                    >
                      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4', a.tom === 'vermelho' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn')}>{a.icone}</span>
                      <span className="flex-1 text-[13px] font-medium text-text">{a.texto}</span>
                      <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </button>
                  ))}
                  <p className="px-1 pt-1 text-[11px] leading-relaxed text-faint">Análise feita neste computador. Nenhuma senha é enviada para a internet.</p>
                </div>
              )}
            </section>

            {/* recentes */}
            <section>
              <TituloSecao>Alterados recentemente</TituloSecao>
              {v.recentes.length === 0 ? (
                <Cartao className="px-4 py-4 text-[13px] text-muted">Nada por aqui ainda.</Cartao>
              ) : (
                <Cartao className="divide-y divide-border/60 overflow-hidden">
                  {v.recentes.map((r) => (
                    <button key={r.id} type="button" onClick={() => abrirRegisto(r.tipo, r.id)} className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-card-hover">
                      <IconeRegisto tipo={r.tipo} titulo={r.titulo} dominio={r.dominio} tamanho="sm" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.titulo}</span>
                      <span className="shrink-0 text-[11px] text-faint">{haQuanto(r.alteradoEm)}</span>
                    </button>
                  ))}
                </Cartao>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function Atalho({ icone, titulo, texto, onClick }: { icone: ReactNode; titulo: string; texto: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex cursor-pointer items-center gap-3.5 rounded-2xl border border-border bg-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:bg-card-hover">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-raised text-muted transition-colors group-hover:border-accent/40 group-hover:text-accent [&_svg]:size-4">{icone}</span>
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-semibold">{titulo}</span>
        <span className="block truncate text-[11.5px] text-muted">{texto}</span>
      </span>
    </button>
  )
}

function identificacao(r: Resumo): string {
  if (r.tipo === 'login') return mascararIdentificacao(r.subtitulo) || r.dominio || ''
  if (r.tipo === 'banco' || r.tipo === 'cartao') return [r.instituicao, r.fim && `•••• ${r.fim}`].filter(Boolean).join(' · ')
  return r.tipo === 'nota' ? 'Nota segura' : ''
}

/** Cartão de registo na visão geral: ícone, nome, identificação mascarada e ações. */
function CartaoRegisto({ r, i, abrir }: { r: Resumo; i: number; abrir: () => void }) {
  const campo = r.tipo === 'login' ? 'senha' : r.tipo === 'banco' ? 'iban' : r.tipo === 'cartao' ? 'numero' : null
  const rotulo = r.tipo === 'login' ? 'Copiar senha' : r.tipo === 'banco' ? 'Copiar IBAN' : 'Copiar número'
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.04 }} className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 transition-colors hover:border-border-strong hover:bg-card-hover">
      <button type="button" onClick={abrir} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
        <IconeRegisto tipo={r.tipo} titulo={r.titulo} dominio={r.dominio} />
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold">{r.titulo}</span>
          <span className="mono block truncate text-[11.5px] text-muted">{identificacao(r) || ' '}</span>
        </span>
      </button>
      {campo && (
        <button
          type="button"
          title={rotulo}
          aria-label={`${rotulo} de ${r.titulo}`}
          onClick={async () => {
            try {
              const s = await api.copiarCampo(r.id, campo)
              avisar('sucesso', `Copiado. A área de transferência é limpa em ${s} s.`)
            } catch (e) {
              if (descartado(e)) return
              avisar('erro', erroParaTexto(e))
            }
          }}
          className="toque flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-raised text-muted opacity-70 transition-all hover:border-accent/40 hover:text-accent group-hover:opacity-100"
        >
          <Copy className="size-4" />
        </button>
      )}
      {r.tipo === 'nota' && <NotebookPen className="size-4 shrink-0 text-faint" aria-hidden="true" />}
    </motion.div>
  )
}
