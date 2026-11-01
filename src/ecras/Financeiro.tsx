import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarClock, CreditCard, Landmark, Plus } from 'lucide-react'
import { api, ignorarDescartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import type { Resumo } from '@/lib/tipos'
import { estadoValidade, PAISES, TIPOS_CONTA } from '@/lib/formatos'
import { novoRegisto } from '@/lib/acoes'
import { cn } from '@/lib/utils'
import { CartaoVisual, IconeRegisto } from '@/componentes/registo'
import { Botao, Cartao, Spinner, TituloSecao, Vazio } from '@/componentes/ui'

/** Resumo da área Financeiro: contas e cartões, sem saldos nem números completos. */
export function Financeiro() {
  const versao = useSessao((s) => s.versao)
  const { abrirRegisto, irPara } = useSessao.getState()
  const [contas, setContas] = useState<Resumo[] | null>(null)
  const [cartoes, setCartoes] = useState<Resumo[] | null>(null)

  useEffect(() => {
    let vivo = true
    Promise.all([api.listar({ tipo: 'banco', ordem: 'titulo' }), api.listar({ tipo: 'cartao', ordem: 'titulo' })])
      .then(([a, b]) => {
        if (!vivo) return
        setContas(a)
        setCartoes(b)
      })
      .catch(ignorarDescartado)
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [versao])

  if (!contas || !cartoes)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )

  const aExpirar = cartoes.filter((c) => c.validade && estadoValidade(c.validade) !== 'valido' && estadoValidade(c.validade) !== null)
  const moedas = [...new Set(contas.map((c) => c.moeda).filter(Boolean))]

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-10 px-8 py-8">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Resumo <span className="text-brand-gradient">financeiro</span>
          </h1>
          <p className="mt-1.5 text-sm text-muted">Contas e cartões guardados no mesmo cofre cifrado. Aqui não há saldos, pagamentos nem ligação aos bancos.</p>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { rotulo: 'Contas bancárias', valor: contas.length, icone: <Landmark /> },
              { rotulo: 'Cartões', valor: cartoes.length, icone: <CreditCard /> },
              { rotulo: 'Cartões a rever', valor: aExpirar.length, icone: <CalendarClock />, aviso: aExpirar.length > 0 },
              { rotulo: moedas.length === 1 ? 'Moeda' : 'Moedas', valor: moedas.join(' · ') || '—', icone: <Landmark /> },
            ].map((c, i) => (
              <motion.div key={c.rotulo} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.06 }}>
                <Cartao className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn('rounded-xl p-2.5 [&_svg]:size-[18px]', c.aviso ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent')}>{c.icone}</div>
                    <div className="min-w-0">
                      <p className="truncate text-xl font-extrabold leading-none tabular-nums">{c.valor}</p>
                      <p className="mt-1 truncate text-[11px] text-muted">{c.rotulo}</p>
                    </div>
                  </div>
                </Cartao>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <section>
          <TituloSecao
            acao={
              <Botao variante="contorno" tamanho="sm" icone={<Plus />} onClick={() => novoRegisto('banco')}>
                Nova conta
              </Botao>
            }
          >
            Contas bancárias
          </TituloSecao>
          {contas.length === 0 ? (
            <Cartao>
              <Vazio icone={<Landmark />} titulo="Sem contas guardadas" texto="Os campos mudam conforme o país: IBAN e BIC na Europa, agência, conta e chaves Pix no Brasil." />
            </Cartao>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {contas.map((c) => (
                <button key={c.id} type="button" onClick={() => abrirRegisto('banco', c.id)} className="flex cursor-pointer items-center gap-3.5 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-border-strong hover:bg-card-hover">
                  <IconeRegisto tipo="banco" titulo={c.titulo} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{c.titulo}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {[c.instituicao, PAISES.find((p) => p.codigo === c.pais)?.nome, TIPOS_CONTA[c.tipoDetalhe ?? '']].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {c.fim && <span className="mono shrink-0 text-[12.5px] text-faint">•••• {c.fim}</span>}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <TituloSecao
            acao={
              cartoes.length > 0 ? (
                <button type="button" onClick={() => irPara('cartoes')} className="cursor-pointer text-[12px] font-semibold text-muted hover:text-accent">
                  Ver todos
                </button>
              ) : (
                <Botao variante="contorno" tamanho="sm" icone={<Plus />} onClick={() => novoRegisto('cartao')}>
                  Novo cartão
                </Botao>
              )
            }
          >
            Cartões
          </TituloSecao>
          {cartoes.length === 0 ? (
            <Cartao>
              <Vazio icone={<CreditCard />} titulo="Sem cartões guardados" texto="Só os últimos 4 algarismos aparecem nas listas; o número completo só se revela a pedido." />
            </Cartao>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cartoes.slice(0, 6).map((c, i) => (
                <motion.button key={c.id} type="button" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.05 }} whileHover={{ y: -4 }} onClick={() => abrirRegisto('cartao', c.id)} className="cursor-pointer">
                  <CartaoVisual resumo={c} />
                </motion.button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
