import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  ArchiveRestore,
  ChartColumnBig,
  CreditCard,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Lock,
  NotebookPen,
  LockKeyhole,
  Settings,
  ShieldCheck,
  Wallet,
  WandSparkles,
} from 'lucide-react'
import { api, ignorarDescartado } from '@/lib/ipc'
import { useSessao, type Area, type Pagina } from '@/lib/sessao'
import { bloquearAgora } from '@/lib/acoes'
import { cn, inicial } from '@/lib/utils'
import { Marca, Simbolo } from './ui'

type Chave = 'logins' | 'notas' | 'bancos' | 'cartoes' | 'movimentos'
interface Destino {
  pagina: Pagina
  rotulo: string
  icone: ReactNode
  contagem?: Chave
}

const FERRAMENTAS: Destino[] = [
  { pagina: 'gerador', rotulo: 'Gerador de senhas', icone: <WandSparkles /> },
  { pagina: 'seguranca', rotulo: 'Segurança', icone: <ShieldCheck /> },
  { pagina: 'copias', rotulo: 'Cópias de segurança', icone: <ArchiveRestore /> },
]

const MENU: Record<Area, { titulo: string; itens: Destino[] }[]> = {
  cofre: [
    {
      titulo: 'COFRE',
      itens: [
        { pagina: 'inicio', rotulo: 'Visão geral', icone: <LayoutDashboard /> },
        { pagina: 'senhas', rotulo: 'Senhas', icone: <KeyRound />, contagem: 'logins' },
        { pagina: 'notas', rotulo: 'Notas seguras', icone: <NotebookPen />, contagem: 'notas' },
      ],
    },
    { titulo: 'FERRAMENTAS', itens: FERRAMENTAS },
  ],
  financeiro: [
    {
      titulo: 'FINANCEIRO',
      itens: [
        { pagina: 'financeiro', rotulo: 'Resumo financeiro', icone: <Wallet /> },
        { pagina: 'gastos', rotulo: 'Gastos', icone: <ChartColumnBig />, contagem: 'movimentos' },
        { pagina: 'bancos', rotulo: 'Dados bancários', icone: <Landmark />, contagem: 'bancos' },
        { pagina: 'cartoes', rotulo: 'Cartões', icone: <CreditCard />, contagem: 'cartoes' },
      ],
    },
    { titulo: 'FERRAMENTAS', itens: FERRAMENTAS },
  ],
}

function useJanelaEstreita() {
  const [estreita, setEstreita] = useState(() => window.innerWidth < 1000)
  useEffect(() => {
    const aoMudar = () => setEstreita(window.innerWidth < 1000)
    window.addEventListener('resize', aoMudar)
    return () => window.removeEventListener('resize', aoMudar)
  }, [])
  return estreita
}

export function Lateral() {
  const { area, pagina, versao, lateralRecolhida } = useSessao()
  const contadores = useSessao((s) => s.config?.contadoresLateral ?? true)
  const { irPara, mudarArea } = useSessao.getState()
  const estreita = useJanelaEstreita()
  const icones = lateralRecolhida || estreita
  const [dados, setDados] = useState<{ nome: string; contagens: Record<Chave, number> } | null>(null)

  useEffect(() => {
    let vivo = true
    api
      .visaoGeral()
      .then((v) => vivo && setDados({ nome: v.nome, contagens: { logins: v.logins, notas: v.notas, bancos: v.bancos, cartoes: v.cartoes, movimentos: v.totalMovimentos } }))
      .catch(ignorarDescartado)
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [versao])

  return (
    <aside aria-label="Navegação" className={cn('flex shrink-0 flex-col transition-[width] duration-200', icones ? 'w-[4.75rem]' : 'w-60')}>
      <div className={cn('pb-4 pt-5', icones ? 'flex justify-center px-0' : 'px-6')}>
        <button type="button" onClick={() => irPara('inicio')} aria-label="LisSecurity — visão geral" className="cursor-pointer">
          {icones ? <Simbolo className="h-[18px] w-auto" /> : <Marca tamanho="sm" />}
        </button>
      </div>

      {/* seletor de área: o mesmo cofre cifrado, organizado em duas vistas */}
      <div role="radiogroup" aria-label="Área" className={cn('mb-3 flex rounded-xl border border-border bg-raised p-1', icones ? 'mx-2 flex-col gap-1' : 'mx-3')}>
        {(
          [
            { chave: 'cofre', texto: 'Cofre', Icone: LockKeyhole },
            { chave: 'financeiro', texto: 'Financeiro', Icone: Landmark },
          ] as const
        ).map((s) => {
          const ativa = area === s.chave
          return (
            <button
              key={s.chave}
              type="button"
              role="radio"
              aria-checked={ativa}
              aria-label={s.texto}
              title={s.texto}
              onClick={() => mudarArea(s.chave)}
              className={cn(
                'relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg py-1.5 text-center text-[11.5px] font-bold transition-colors',
                icones && 'min-h-9',
                ativa ? 'text-[#04120a]' : 'text-faint hover:text-text',
              )}
            >
              {ativa && (
                <motion.span
                  layoutId="areaAtiva"
                  className="absolute inset-0 rounded-lg shadow-[0_2px_10px_-2px_rgba(0,0,0,0.5)]"
                  style={{ background: 'linear-gradient(135deg, var(--color-accent-hover) 0%, var(--color-accent) 55%, color-mix(in srgb, var(--color-accent) 78%, black) 100%)' }}
                  transition={{ type: 'spring', bounce: 0.18, duration: 0.4 }}
                />
              )}
              <s.Icone className="relative z-10 size-3.5" aria-hidden="true" />
              {!icones && <span className="relative z-10">{s.texto}</span>}
            </button>
          )
        })}
      </div>

      <nav className={cn('flex-1 space-y-4 overflow-y-auto pb-3', icones ? 'px-2' : 'px-3')}>
        {MENU[area].map((grupo) => (
          <div key={grupo.titulo} className={cn(icones && 'border-t border-border/60 pt-2 first:border-0 first:pt-0')}>
            {!icones && <p className="px-3.5 pb-1.5 pt-2 text-[10px] font-bold tracking-widest text-faint">{grupo.titulo}</p>}
            <div className="space-y-0.5">
              {grupo.itens.map((d) => {
                const ativo = pagina === d.pagina
                const n = d.contagem && dados ? dados.contagens[d.contagem] : undefined
                return (
                  <button
                    key={d.pagina}
                    type="button"
                    onClick={() => irPara(d.pagina)}
                    aria-current={ativo ? 'page' : undefined}
                    aria-label={n !== undefined ? `${d.rotulo}, ${n}` : d.rotulo}
                    title={d.rotulo}
                    className="block w-full cursor-pointer text-left"
                  >
                    <span
                      className={cn(
                        'relative flex items-center gap-3 rounded-xl px-3.5 py-2 text-[13.5px] transition-colors duration-150',
                        icones && 'min-h-10 justify-center px-0',
                        ativo ? 'font-semibold text-accent' : 'text-muted hover:bg-card/60 hover:text-text',
                      )}
                    >
                      {ativo && (
                        <motion.span
                          layoutId="navAtiva"
                          className="absolute inset-0 rounded-xl border border-accent/20 bg-accent-soft"
                          transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                        />
                      )}
                      <span className="relative z-10 [&_svg]:size-[17px] [&_svg]:stroke-[1.75]">{d.icone}</span>
                      {!icones && <span className="relative z-10 flex-1 truncate">{d.rotulo}</span>}
                      {!icones && contadores && n !== undefined && n > 0 && <span className="relative z-10 text-[11px] font-semibold tabular-nums text-faint">{n}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* rodapé: identificação local, definições e bloquear */}
      <div className="border-t border-border/60 p-3">
        <div className={cn('flex items-center gap-2.5 rounded-xl px-2 py-1.5', icones && 'flex-col px-0')}>
          <span
            aria-hidden="true"
            className="flex size-[34px] shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent-soft text-[13px] font-extrabold text-accent"
          >
            {dados?.nome ? inicial(dados.nome) : <Lock className="size-4" />}
          </span>
          {!icones && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-text">{dados?.nome || 'O meu cofre'}</p>
              <p className="truncate text-[10.5px] text-faint">Cofre local cifrado</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => irPara('definicoes')}
            title="Definições"
            aria-label="Definições"
            aria-current={pagina === 'definicoes' ? 'page' : undefined}
            className={cn(
              'cursor-pointer rounded-lg p-1.5 transition-colors hover:bg-card',
              pagina === 'definicoes' ? 'text-accent' : 'text-faint hover:text-text',
            )}
          >
            <Settings className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => bloquearAgora()}
            title="Bloquear o cofre (Ctrl+L)"
            aria-label="Bloquear o cofre"
            className="cursor-pointer rounded-lg p-1.5 text-faint transition-colors hover:bg-card hover:text-accent"
          >
            <Lock className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
