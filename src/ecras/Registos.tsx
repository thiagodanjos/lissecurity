import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDownUp, ChevronDown, CreditCard, KeyRound, Landmark, MousePointerClick, NotebookPen, Plus, Search, Star, Tag, Trash2, Upload, X } from 'lucide-react'
import { api, descartado, ignorarDescartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import type { Agrupamentos, Consulta, Resumo, TipoItem } from '@/lib/tipos'
import { haQuanto, TIPOS_NOTA } from '@/lib/formatos'
import { cn } from '@/lib/utils'
import { novoRegisto } from '@/lib/acoes'
import { avisar, erroParaTexto } from '@/componentes/avisos'
import { CartaoVisual, IconeRegisto } from '@/componentes/registo'
import { Botao, BotaoIcone, confirmar, Spinner, Vazio } from '@/componentes/ui'
import { FilaComSetas } from '@/componentes/fila'
import { Detalhe } from './Detalhe'

const TEXTOS: Record<TipoItem, { titulo: string; singular: string; novo: string; vazio: string; dica: string; icone: React.ReactNode }> = {
  login: { titulo: 'Senhas', singular: 'senha', novo: 'Nova senha', vazio: 'Ainda não há senhas no cofre', dica: 'Guarda aqui os acessos a sites, aplicações e serviços.', icone: <KeyRound /> },
  banco: { titulo: 'Dados bancários', singular: 'conta', novo: 'Nova conta', vazio: 'Ainda não há contas bancárias', dica: 'IBAN, BIC, agência, chaves Pix e identificadores de acesso — tudo cifrado.', icone: <Landmark /> },
  cartao: { titulo: 'Cartões', singular: 'cartão', novo: 'Novo cartão', vazio: 'Ainda não há cartões', dica: 'Só os últimos 4 algarismos aparecem nas listas. O PIN e o CVV não têm campo próprio.', icone: <CreditCard /> },
  nota: { titulo: 'Notas seguras', singular: 'nota', novo: 'Nova nota', vazio: 'Ainda não há notas seguras', dica: 'Notas privadas, códigos de recuperação e chaves de licença.', icone: <NotebookPen /> },
}

function useLargura() {
  const [l, setL] = useState(window.innerWidth)
  useEffect(() => {
    const f = () => setL(window.innerWidth)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return l
}

export function Registos({ tipo }: { tipo: TipoItem }) {
  const versao = useSessao((s) => s.versao)
  const selecionar = useSessao((s) => s.selecionar)
  const { consumirSelecao, mudou } = useSessao.getState()
  const [consulta, setConsulta] = useState<Consulta>({ texto: '', filtro: 'todos', ordem: 'titulo', categoria: '', etiqueta: '' })
  const [lista, setLista] = useState<Resumo[] | null>(null)
  const [grupos, setGrupos] = useState<Agrupamentos>({ categorias: [], etiquetas: [] })
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const largura = useLargura()
  const sobreposto = largura < 1180
  const t = TEXTOS[tipo]

  // vindo da pesquisa, paleta ou visão geral
  useEffect(() => {
    if (selecionar && selecionar.tipo === tipo) {
      setSelecionado(selecionar.id)
      setConsulta((c) => ({ ...c, filtro: 'todos', texto: '', categoria: '', etiqueta: '' }))
      consumirSelecao()
    }
  }, [selecionar, tipo, consumirSelecao])

  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => {
      api
        .listar({ ...consulta, tipo })
        .then((r) => vivo && setLista(r))
        .catch(ignorarDescartado)
        .catch((e) => avisar('erro', erroParaTexto(e)))
    }, consulta.texto ? 80 : 0)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [consulta, tipo, versao])

  useEffect(() => {
    api
      .agrupamentos(tipo)
      .then(setGrupos)
      .catch(ignorarDescartado)
      .catch(() => {})
  }, [tipo, versao])

  // em janelas largas, abre o primeiro registo para o painel não ficar vazio
  useEffect(() => {
    if (!lista) return
    if (selecionado && !lista.some((r) => r.id === selecionado) && consulta.filtro !== 'lixo') {
      // o registo selecionado saiu da lista (eliminado, filtrado…)
      setSelecionado(sobreposto ? null : lista[0]?.id ?? null)
    } else if (!selecionado && !sobreposto && lista.length > 0) {
      setSelecionado(lista[0].id)
    }
  }, [lista, selecionado, sobreposto, consulta.filtro])

  const mover = (delta: number) => {
    if (!lista?.length) return
    const i = lista.findIndex((r) => r.id === selecionado)
    const prox = lista[Math.max(0, Math.min(lista.length - 1, (i < 0 ? 0 : i + delta)))]
    setSelecionado(prox.id)
    listaRef.current?.querySelector(`[data-id="${prox.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const filtros = useMemo(
    () =>
      [
        { valor: 'todos', texto: 'Todos', icone: null },
        { valor: 'favoritos', texto: 'Favoritos', icone: <Star className="size-3" /> },
        { valor: 'lixo', texto: 'Lixo', icone: <Trash2 className="size-3" /> },
      ] as const,
    [],
  )

  const mostrarDetalhe = !!selecionado
  const total = lista?.length ?? 0

  return (
    <div className="relative flex min-h-0 flex-1">
      {/* lista */}
      <section aria-label={t.titulo} className={cn('flex min-h-0 flex-col border-border/60', sobreposto ? 'w-full' : 'w-[360px] shrink-0 border-r xl:w-[400px]')}>
        <div className="space-y-3 px-5 pb-3 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-extrabold tracking-tight">{t.titulo}</h1>
              <p className="text-[12px] text-muted">{lista ? (consulta.filtro === 'lixo' ? `${total} no lixo` : `${total} ${total === 1 ? 'registo' : 'registos'}`) : ' '}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {tipo === 'login' && (
                <BotaoIcone rotulo="Importar senhas de outro gestor ou navegador (CSV)" tamanho="sm" onClick={() => useSessao.getState().abrirImportar('senhas')}>
                  <Upload />
                </BotaoIcone>
              )}
              <Botao tamanho="sm" icone={<Plus />} onClick={() => novoRegisto(tipo)}>
                {t.novo}
              </Botao>
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden="true" />
            <input
              value={consulta.texto}
              onChange={(e) => setConsulta({ ...consulta, texto: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  mover(1)
                  listaRef.current?.focus()
                }
              }}
              placeholder={`Filtrar ${t.titulo.toLowerCase()}…`}
              aria-label={`Filtrar ${t.titulo.toLowerCase()}`}
              spellCheck={false}
              autoComplete="off"
              className="h-10 w-full rounded-full border border-border bg-raised pl-10 pr-4 text-[13px] text-text placeholder:text-faint outline-none transition-all focus:border-accent/50 focus:ring-2 focus:ring-accent/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {filtros.map((f) => (
              <button
                key={f.valor}
                type="button"
                aria-pressed={consulta.filtro === f.valor}
                onClick={() => {
                  setConsulta({ ...consulta, filtro: f.valor })
                  setSelecionado(null)
                }}
                className={cn(
                  'toque inline-flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-colors',
                  consulta.filtro === f.valor ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border text-muted hover:border-border-strong hover:text-text',
                )}
              >
                {f.icone}
                {f.texto}
              </button>
            ))}
            <span className="flex-1" />
            <span className="relative">
              <ArrowDownUp className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-faint" aria-hidden="true" />
              <select
                aria-label="Ordenar"
                value={consulta.ordem}
                onChange={(e) => setConsulta({ ...consulta, ordem: e.target.value as Consulta['ordem'] })}
                className="h-7 cursor-pointer appearance-none rounded-full border border-border bg-raised pl-7 pr-3 text-[11.5px] font-semibold text-muted outline-none transition-colors hover:border-border-strong hover:text-text focus:border-accent/50"
              >
                <option value="titulo">A–Z</option>
                <option value="alterado">Alterados</option>
                <option value="criado">Mais recentes</option>
              </select>
            </span>
          </div>
          {(grupos.categorias.length > 0 || grupos.etiquetas.length > 0) && consulta.filtro !== 'lixo' && (
            <div className="flex items-center gap-1.5">
            <FilaComSetas rotulo="Filtrar por categoria ou etiqueta" className="min-w-0 flex-1">
              {(consulta.categoria || consulta.etiqueta) && (
                <Fichinha ativa={false} onClick={() => setConsulta({ ...consulta, categoria: '', etiqueta: '' })}>
                  <X className="size-3" aria-hidden="true" /> Limpar
                </Fichinha>
              )}
              {grupos.categorias.map((c) => (
                <Fichinha key={`c-${c.nome}`} ativa={consulta.categoria === c.nome} onClick={() => setConsulta({ ...consulta, categoria: consulta.categoria === c.nome ? '' : c.nome })}>
                  {c.nome} <span className="text-faint">{c.total}</span>
                </Fichinha>
              ))}
              {grupos.etiquetas.map((e) => (
                <Fichinha key={`e-${e.nome}`} ativa={consulta.etiqueta === e.nome} onClick={() => setConsulta({ ...consulta, etiqueta: consulta.etiqueta === e.nome ? '' : e.nome })}>
                  #{e.nome}
                </Fichinha>
              ))}
            </FilaComSetas>
            <MenuTodas
              grupos={grupos}
              categoria={consulta.categoria ?? ''}
              etiqueta={consulta.etiqueta ?? ''}
              aoEscolher={(categoria, etiqueta) => setConsulta({ ...consulta, categoria, etiqueta })}
            />
            </div>
          )}
        </div>

        <div
          ref={listaRef}
          tabIndex={0}
          role="listbox"
          aria-label={`Lista de ${t.titulo.toLowerCase()}`}
          aria-activedescendant={selecionado ? `registo-${selecionado}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), mover(1))
            if (e.key === 'ArrowUp') (e.preventDefault(), mover(-1))
          }}
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
        >
          {lista === null ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : lista.length === 0 ? (
            consulta.filtro === 'lixo' ? (
              <Vazio icone={<Trash2 />} titulo="O lixo está vazio" texto="O que eliminares fica aqui durante o tempo definido nas definições, antes de sair do cofre." />
            ) : consulta.texto || consulta.filtro !== 'todos' || consulta.categoria || consulta.etiqueta ? (
              <Vazio icone={<Search />} titulo="Nada encontrado" texto="Experimenta outras palavras ou limpa os filtros." />
            ) : (
              <Vazio
                icone={t.icone}
                titulo={t.vazio}
                texto={t.dica}
                acao={
                  <Botao icone={<Plus />} onClick={() => novoRegisto(tipo)}>
                    {t.novo}
                  </Botao>
                }
              />
            )
          ) : tipo === 'cartao' ? (
            <div className="grid gap-3 px-2 pt-1">
              {lista.map((r, i) => (
                <button
                  key={r.id}
                  id={`registo-${r.id}`}
                  data-id={r.id}
                  type="button"
                  role="option"
                  aria-selected={selecionado === r.id}
                  onClick={() => setSelecionado(r.id)}
                  className={cn('entra cursor-pointer rounded-[18px] p-0.5 text-left transition-all duration-200', selecionado === r.id ? 'ring-2 ring-accent/70' : 'hover:-translate-y-0.5 hover:ring-1 hover:ring-border-strong')}
                  style={{ ['--atraso' as string]: `${Math.min(i, 8) * 30}ms` }}
                >
                  <CartaoVisual resumo={r} compacto />
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              {lista.map((r, i) => (
                <LinhaRegisto key={r.id} r={r} ativo={selecionado === r.id} indice={i} aoClicar={() => setSelecionado(r.id)} />
              ))}
            </div>
          )}
        </div>
        {consulta.filtro === 'lixo' && total > 0 && (
          <div className="border-t border-border/60 px-5 py-3">
            <Botao
              variante="perigo"
              tamanho="sm"
              largo
              icone={<Trash2 />}
              onClick={async () => {
                const ok = await confirmar({
                  titulo: 'Esvaziar o lixo?',
                  texto: `${total} ${total === 1 ? 'registo sai' : 'registos saem'} do cofre de vez. As cópias de segurança anteriores continuam a tê-los.`,
                  confirmar: 'Esvaziar o lixo',
                  perigo: true,
                })
                if (!ok) return
                try {
                  await api.esvaziarLixo()
                  avisar('sucesso', 'Lixo esvaziado.')
                  mudou()
                } catch (e) {
                  if (descartado(e)) return
                  avisar('erro', erroParaTexto(e))
                }
              }}
            >
              Esvaziar o lixo
            </Botao>
          </div>
        )}
      </section>

      {/* detalhe */}
      {sobreposto ? (
        <AnimatePresence>
          {mostrarDetalhe && (
            <motion.div
              className="absolute inset-0 z-10 overflow-y-auto bg-bg"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <Detalhe key={selecionado} id={selecionado!} aoFechar={() => setSelecionado(null)} aoMudar={mudou} />
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {selecionado ? (
            <Detalhe key={selecionado} id={selecionado} aoMudar={mudou} />
          ) : (
            lista &&
            lista.length > 0 && <Vazio icone={<MousePointerClick />} titulo={`Escolhe ${tipo === 'cartao' ? 'um cartão' : `uma ${t.singular}`}`} texto="Os detalhes aparecem aqui. Os segredos ficam ocultos até pedires para os ver." />
          )}
        </div>
      )}
    </div>
  )
}

function Fichinha({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
        ativa ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border bg-raised text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  )
}

function LinhaRegisto({ r, ativo, indice, aoClicar }: { r: Resumo; ativo: boolean; indice: number; aoClicar: () => void }) {
  const sub =
    r.tipo === 'banco'
      ? [r.subtitulo, r.fim && `•••• ${r.fim}`].filter(Boolean).join(' · ')
      : r.tipo === 'nota'
        ? r.codigosPorUsar !== undefined
          ? `${TIPOS_NOTA[r.tipoDetalhe ?? 'nota']} · ${r.codigosPorUsar} por usar`
          : TIPOS_NOTA[r.tipoDetalhe ?? 'nota']
        : r.subtitulo
  return (
    <button
      id={`registo-${r.id}`}
      data-id={r.id}
      type="button"
      role="option"
      aria-selected={ativo}
      onClick={aoClicar}
      className="entra relative block w-full cursor-pointer text-left"
      style={{ ['--atraso' as string]: `${Math.min(indice, 10) * 18}ms` }}
    >
      {ativo && <motion.span layoutId="registoAtivo" className="absolute inset-0 rounded-xl border border-accent/20 bg-accent-soft" transition={{ type: 'spring', bounce: 0.12, duration: 0.35 }} />}
      <span className={cn('linha-registo relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors', !ativo && 'hover:bg-card/70')}>
        <IconeRegisto tipo={r.tipo} titulo={r.titulo} dominio={r.dominio} />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[13.5px] font-semibold', ativo ? 'text-accent' : 'text-text')}>{r.titulo}</span>
          <span className="block truncate text-[12px] text-muted">{sub || ' '}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {r.favorito && <Star className="size-3.5 fill-accent text-accent" aria-label="Favorito" />}
          <span className="text-[10.5px] text-faint">{haQuanto(r.alteradoEm)}</span>
        </span>
      </span>
    </button>
  )
}

/** Lista completa de categorias e etiquetas num menu (útil quando são muitas). */
function MenuTodas({
  grupos,
  categoria,
  etiqueta,
  aoEscolher,
}: {
  grupos: Agrupamentos
  categoria: string
  etiqueta: string
  aoEscolher: (categoria: string, etiqueta: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => !raiz.current?.contains(e.target as Node) && setAberto(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false)
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto])
  const n = grupos.categorias.length + grupos.etiquetas.length
  const opcao = (ativa: boolean) =>
    cn('flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-white/10', ativa ? 'text-accent' : 'text-text')
  return (
    <div ref={raiz} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={aberto}
        title="Ver todas as categorias e etiquetas"
        onClick={() => setAberto(!aberto)}
        className={cn(
          'inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold transition-colors',
          aberto ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border bg-raised text-muted hover:text-text',
        )}
      >
        <Tag className="size-3" aria-hidden="true" /> Todas ({n}) <ChevronDown className="size-3" aria-hidden="true" />
      </button>
      <AnimatePresence>
        {aberto && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full z-40 mt-1.5 max-h-80 w-60 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-card"
          >
            <button type="button" role="menuitemradio" aria-checked={!categoria && !etiqueta} onClick={() => (aoEscolher('', ''), setAberto(false))} className={opcao(!categoria && !etiqueta)}>
              Todas
            </button>
            {grupos.categorias.length > 0 && <p className="px-3 pb-1 pt-2.5 text-[10px] font-bold tracking-widest text-faint">CATEGORIAS</p>}
            {grupos.categorias.map((c) => (
              <button key={c.nome} type="button" role="menuitemradio" aria-checked={categoria === c.nome} onClick={() => (aoEscolher(c.nome, ''), setAberto(false))} className={opcao(categoria === c.nome)}>
                <span className="truncate">{c.nome}</span>
                <span className="text-[11px] text-faint">{c.total}</span>
              </button>
            ))}
            {grupos.etiquetas.length > 0 && <p className="px-3 pb-1 pt-2.5 text-[10px] font-bold tracking-widest text-faint">ETIQUETAS</p>}
            {grupos.etiquetas.map((e) => (
              <button key={e.nome} type="button" role="menuitemradio" aria-checked={etiqueta === e.nome} onClick={() => (aoEscolher('', e.nome), setAberto(false))} className={opcao(etiqueta === e.nome)}>
                <span className="truncate">#{e.nome}</span>
                <span className="text-[11px] text-faint">{e.total}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
