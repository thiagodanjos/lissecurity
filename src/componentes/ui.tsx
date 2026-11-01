import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, ChevronDown, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { create } from 'zustand'
import { cn } from '@/lib/utils'
import type { Validacao } from '@/lib/formatos'

/* ───────────────────────── marca ───────────────────────── */

/** O símbolo Lis do cofre: o ponto da LisFilms passa a fechadura; as duas barras ficam. */
export function Simbolo({ className, brilho = true }: { className?: string; brilho?: boolean }) {
  return (
    <svg viewBox="134 158 210 196" className={cn('shrink-0', className)} aria-hidden="true">
      <g fill="var(--color-accent)" style={brilho ? { filter: 'drop-shadow(0 0 14px rgb(30 215 96 / 0.55))' } : undefined}>
        <circle cx="170" cy="230" r="34" />
        <path d="M158 250 L149 326 Q148 336 158 336 L182 336 Q192 336 191 326 L182 250 Z" />
      </g>
      <rect x="246" y="160" width="32" height="192" rx="16" fill="var(--color-text)" />
      <rect x="310" y="160" width="32" height="192" rx="16" fill="var(--color-accent)" />
    </svg>
  )
}

export function Marca({ tamanho = 'md', className }: { tamanho?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const t = {
    sm: { simbolo: 'h-[15px]', texto: 'text-lg', gap: 'gap-2' },
    md: { simbolo: 'h-5', texto: 'text-2xl', gap: 'gap-2.5' },
    lg: { simbolo: 'h-[30px]', texto: 'text-4xl', gap: 'gap-3' },
    xl: { simbolo: 'h-10', texto: 'text-5xl', gap: 'gap-4' },
  }[tamanho]
  return (
    <span className={cn('flex items-center select-none', t.gap, className)}>
      <Simbolo className={cn(t.simbolo, 'w-auto')} />
      <span className={cn('font-extrabold leading-none tracking-tight', t.texto)}>
        <span className="text-text">Lis</span>
        <span className="text-accent">Security</span>
      </span>
    </span>
  )
}

/* ───────────────────────── botões ───────────────────────── */

type Variante = 'primario' | 'escuro' | 'fantasma' | 'perigo' | 'contorno'

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-accent text-black font-semibold hover:bg-accent-hover hover:shadow-glow',
  escuro: 'bg-card text-text border border-border hover:bg-card-hover hover:border-border-strong',
  fantasma: 'bg-transparent text-muted hover:text-text hover:bg-card',
  perigo: 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20',
  contorno: 'border border-border text-text hover:border-accent/50 hover:text-accent',
}

interface PropsBotao extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  tamanho?: 'sm' | 'md' | 'lg'
  carregando?: boolean
  icone?: ReactNode
  largo?: boolean
}

export const Botao = forwardRef<HTMLButtonElement, PropsBotao>(function Botao(
  { variante = 'primario', tamanho = 'md', carregando, icone, largo, className, children, disabled, type = 'button', ...resto },
  ref,
) {
  const tam = { sm: 'h-8 px-3.5 text-[12.5px] gap-1.5', md: 'h-10 px-5 text-[13.5px] gap-2', lg: 'h-12 px-6 text-[14.5px] gap-2' }[tamanho]
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || carregando}
      className={cn(
        'toque inline-flex cursor-pointer items-center justify-center rounded-full font-medium whitespace-nowrap transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:shadow-none',
        VARIANTES[variante],
        tam,
        largo && 'w-full',
        className,
      )}
      {...resto}
    >
      {carregando ? <Loader2 className="size-4 roda" aria-hidden="true" /> : icone ? <span className="[&_svg]:size-4">{icone}</span> : null}
      {children}
    </button>
  )
})

/** Botão secundário de ícone numa superfície circular (como na barra da LisFilms). */
export const BotaoIcone = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { rotulo: string; ativo?: boolean; tamanho?: 'sm' | 'md' }>(
  function BotaoIcone({ rotulo, ativo, className, children, tamanho = 'md', type = 'button', ...resto }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={rotulo}
        title={rotulo}
        className={cn(
          'toque relative flex shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
          tamanho === 'md' ? 'size-10 [&_svg]:size-4' : 'size-8 [&_svg]:size-[15px]',
          ativo ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border bg-raised text-muted hover:border-border-strong hover:text-text',
          className,
        )}
        {...resto}
      >
        {children}
      </button>
    )
  },
)

/** Botão de ação pequeno dentro de uma linha (copiar, revelar…), sem superfície própria. */
export function AcaoLinha({ rotulo, onClick, children, ativo, disabled }: { rotulo: string; onClick: () => void; children: ReactNode; ativo?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'toque flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35 [&_svg]:size-[15px]',
        ativo ? 'bg-accent-soft text-accent' : 'text-faint hover:bg-card-hover hover:text-text',
      )}
    >
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('roda size-4 text-accent', className)} aria-hidden="true" />
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('rounded-md border border-border bg-card px-1.5 py-0.5 font-sans text-[10px] font-semibold text-faint', className)}>{children}</kbd>
}

/* ───────────────────────── superfícies ───────────────────────── */

export function Cartao({ className, children, hover }: { className?: string; children: ReactNode; hover?: boolean }) {
  return (
    <div className={cn('rounded-2xl border border-border bg-card', hover && 'transition-all duration-200 hover:border-border-strong hover:bg-card-hover', className)}>
      {children}
    </div>
  )
}

/** Título de secção com o marcador vertical verde da LisFilms. */
export function TituloSecao({ children, acao, id, className }: { children: ReactNode; acao?: ReactNode; id?: string; className?: string }) {
  return (
    <div className={cn('mb-3.5 flex items-center justify-between gap-3', className)}>
      <h2 id={id} className="flex items-center gap-2.5 text-[15px] font-bold">
        <span className="h-4 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        {children}
      </h2>
      {acao}
    </div>
  )
}

export function Etiqueta({ children, tom = 'neutro', className }: { children: ReactNode; tom?: 'neutro' | 'verde' | 'ambar' | 'vermelho'; className?: string }) {
  const tons = {
    neutro: 'border-border bg-raised text-muted',
    verde: 'border-accent/25 bg-accent-soft text-accent',
    ambar: 'border-warn/30 bg-warn-soft text-warn',
    vermelho: 'border-danger/30 bg-danger-soft text-danger',
  }
  return <span className={cn('inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', tons[tom], className)}>{children}</span>
}

export function Vazio({ icone, titulo, texto, acao }: { icone: ReactNode; titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div className="entra flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent-soft text-accent [&_svg]:size-6">{icone}</div>
      <p className="text-[15px] font-bold">{titulo}</p>
      {texto && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{texto}</p>}
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  )
}

export function Aviso({ tom = 'ambar', icone, children, className }: { tom?: 'ambar' | 'verde' | 'vermelho' | 'neutro'; icone?: ReactNode; children: ReactNode; className?: string }) {
  const tons = {
    ambar: 'border-warn/25 bg-warn-soft/60 text-[#f7c97a]',
    verde: 'border-accent/20 bg-accent-soft/70 text-[#9bf0bd]',
    vermelho: 'border-danger/30 bg-danger-soft/70 text-[#ff9a9c]',
    neutro: 'border-border bg-raised text-muted',
  }
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed', tons[tom], className)}>
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icone ?? <AlertTriangle />}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/* ───────────────────────── campos ───────────────────────── */

const estiloCampo =
  'h-11 w-full rounded-xl border border-border bg-raised px-3.5 text-[13.5px] text-text placeholder:text-faint outline-none transition-[border-color,box-shadow] duration-150 focus:border-accent/55 focus:ring-2 focus:ring-accent/15 disabled:opacity-50'

export function Rotulo({ htmlFor, children, opcional }: { htmlFor?: string; children: ReactNode; opcional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
      {children}
      {opcional && <span className="font-normal text-faint">(opcional)</span>}
    </label>
  )
}

function MensagemValidacao({ validacao, ajuda, id }: { validacao?: Validacao; ajuda?: ReactNode; id: string }) {
  if (validacao && !validacao.ok) {
    return (
      <p id={id} className="mt-1.5 text-[11.5px] leading-snug text-danger">
        {validacao.erro}
      </p>
    )
  }
  if (validacao && validacao.ok && validacao.aviso) {
    return (
      <p id={id} className="mt-1.5 flex items-start gap-1 text-[11.5px] leading-snug text-faint">
        <CheckCircle2 className="mt-px size-3.5 shrink-0 text-accent" aria-hidden="true" />
        {validacao.aviso}
      </p>
    )
  }
  if (ajuda) {
    return (
      <p id={id} className="mt-1.5 text-[11.5px] leading-snug text-faint">
        {ajuda}
      </p>
    )
  }
  return null
}

interface PropsCampo extends InputHTMLAttributes<HTMLInputElement> {
  rotulo?: string
  opcional?: boolean
  ajuda?: ReactNode
  validacao?: Validacao
  fim?: ReactNode
  /** quantos botões cabem no fim do campo (para o texto não passar por baixo deles) */
  botoesFim?: 1 | 2
}

export const Campo = forwardRef<HTMLInputElement, PropsCampo>(function Campo({ rotulo, opcional, ajuda, validacao, fim, botoesFim = 1, className, id, ...resto }, ref) {
  const automatico = useId()
  const idCampo = id ?? automatico
  const idAjuda = `${idCampo}-ajuda`
  return (
    <div className={className}>
      {rotulo && (
        <Rotulo htmlFor={idCampo} opcional={opcional}>
          {rotulo}
        </Rotulo>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={idCampo}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={validacao && !validacao.ok ? true : undefined}
          aria-describedby={ajuda || validacao ? idAjuda : undefined}
          className={cn(estiloCampo, !!fim && (botoesFim === 2 ? 'pr-[4.75rem]' : 'pr-11'), validacao && !validacao.ok && 'border-danger/60 focus:border-danger/70 focus:ring-danger/15')}
          {...resto}
        />
        {fim && <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">{fim}</div>}
      </div>
      <MensagemValidacao validacao={validacao} ajuda={ajuda} id={idAjuda} />
    </div>
  )
})

/** Campo para segredos: oculto por padrão, com revelar enquanto se escreve. Nunca guarda nada. */
export const CampoSenha = forwardRef<HTMLInputElement, PropsCampo & { acoes?: ReactNode }>(function CampoSenha({ acoes, ...props }, ref) {
  const [visivel, setVisivel] = useState(false)
  return (
    <Campo
      ref={ref}
      type={visivel ? 'text' : 'password'}
      autoCapitalize="off"
      autoCorrect="off"
      botoesFim={acoes ? 2 : 1}
      {...props}
      fim={
        <>
          {acoes}
          <AcaoLinha rotulo={visivel ? 'Ocultar' : 'Mostrar enquanto escreves'} onClick={() => setVisivel(!visivel)} ativo={visivel}>
            {visivel ? <EyeOff /> : <Eye />}
          </AcaoLinha>
        </>
      }
    />
  )
})

export function AreaTexto({ rotulo, opcional, ajuda, className, id, ...resto }: TextareaHTMLAttributes<HTMLTextAreaElement> & { rotulo?: string; opcional?: boolean; ajuda?: ReactNode }) {
  const automatico = useId()
  const idCampo = id ?? automatico
  return (
    <div className={className}>
      {rotulo && (
        <Rotulo htmlFor={idCampo} opcional={opcional}>
          {rotulo}
        </Rotulo>
      )}
      <textarea
        id={idCampo}
        spellCheck={false}
        autoComplete="off"
        className="min-h-24 w-full resize-y rounded-xl border border-border bg-raised px-3.5 py-3 text-[13.5px] leading-relaxed text-text placeholder:text-faint outline-none transition-[border-color,box-shadow] duration-150 focus:border-accent/55 focus:ring-2 focus:ring-accent/15"
        {...resto}
      />
      {ajuda && <p className="mt-1.5 text-[11.5px] text-faint">{ajuda}</p>}
    </div>
  )
}

export function Selecao({ rotulo, opcional, ajuda, className, id, children, ...resto }: SelectHTMLAttributes<HTMLSelectElement> & { rotulo?: string; opcional?: boolean; ajuda?: ReactNode }) {
  const automatico = useId()
  const idCampo = id ?? automatico
  return (
    <div className={className}>
      {rotulo && (
        <Rotulo htmlFor={idCampo} opcional={opcional}>
          {rotulo}
        </Rotulo>
      )}
      <div className="relative">
        <select id={idCampo} className={cn(estiloCampo, 'cursor-pointer appearance-none pr-9')} {...resto}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden="true" />
      </div>
      {ajuda && <p className="mt-1.5 text-[11.5px] text-faint">{ajuda}</p>}
    </div>
  )
}

export function Interruptor({ ligado, aoMudar, rotulo, descricao, disabled }: { ligado: boolean; aoMudar: (v: boolean) => void; rotulo: string; descricao?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-[13.5px] font-semibold text-text">
          {rotulo}
        </label>
        {descricao && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{descricao}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={ligado}
        disabled={disabled}
        onClick={() => aoMudar(!ligado)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40',
          ligado ? 'border-accent/60 bg-accent' : 'border-border-strong bg-raised',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 600, damping: 36 }}
          className={cn('absolute top-0.5 size-[18px] rounded-full shadow', ligado ? 'right-0.5 bg-black' : 'left-0.5 bg-muted')}
        />
      </button>
    </div>
  )
}

/** Controlo segmentado (o mesmo gesto do seletor LisFilms/LisGames). */
export function Segmentado<T extends string>({
  opcoes,
  valor,
  aoMudar,
  rotulo,
  idAnimacao,
  className,
}: {
  opcoes: { valor: T; texto: string; icone?: ReactNode }[]
  valor: T
  aoMudar: (v: T) => void
  rotulo: string
  idAnimacao: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className={cn('flex rounded-xl border border-border bg-raised p-1', className)}>
      {opcoes.map((o) => {
        const ativo = o.valor === valor
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => aoMudar(o.valor)}
            className={cn(
              'relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors',
              ativo ? 'text-[#04120a]' : 'text-faint hover:text-text',
            )}
          >
            {ativo && (
              <motion.span
                layoutId={idAnimacao}
                className="absolute inset-0 rounded-lg shadow-[0_2px_10px_-2px_rgba(0,0,0,0.5)]"
                style={{ background: 'linear-gradient(135deg, var(--color-accent-hover) 0%, var(--color-accent) 55%, color-mix(in srgb, var(--color-accent) 78%, black) 100%)' }}
                transition={{ type: 'spring', bounce: 0.18, duration: 0.4 }}
              />
            )}
            {o.icone && <span className="relative z-10 [&_svg]:size-3.5">{o.icone}</span>}
            <span className="relative z-10 truncate">{o.texto}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ───────────────────────── janelas sobrepostas ───────────────────────── */

export function Modal({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  largura = 'max-w-lg',
  rodape,
  fecharComFundo = true,
}: {
  aberto: boolean
  aoFechar: () => void
  titulo: string
  descricao?: ReactNode
  children: ReactNode
  largura?: string
  rodape?: ReactNode
  fecharComFundo?: boolean
}) {
  const painel = useRef<HTMLDivElement>(null)
  const idTitulo = useId()
  // `aoFechar` costuma ser uma função nova a cada render: guardada numa referência, o efeito
  // de foco só corre quando a janela abre ou fecha (e não a cada tecla escrita lá dentro).
  const fecharRef = useRef(aoFechar)
  fecharRef.current = aoFechar
  useEffect(() => {
    if (!aberto) return
    const anterior = document.activeElement as HTMLElement | null
    const t = setTimeout(() => {
      const alvo = painel.current?.querySelector<HTMLElement>('[data-foco-inicial], input, textarea, select, button:not([data-fechar])')
      alvo?.focus()
    }, 30)
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        fecharRef.current()
      }
      if (e.key === 'Tab' && painel.current) {
        const focaveis = [...painel.current.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'))
        if (focaveis.length === 0) return
        const [primeiro, ultimo] = [focaveis[0], focaveis[focaveis.length - 1]]
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault()
          ultimo.focus()
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault()
          primeiro.focus()
        }
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', tecla, true)
      anterior?.focus?.()
    }
  }, [aberto])

  return (
    <AnimatePresence>
      {aberto && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 pt-14 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(e) => {
            if (fecharComFundo && e.target === e.currentTarget) aoFechar()
          }}
        >
          <motion.div
            ref={painel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={idTitulo}
            className={cn('flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sobreposicao', largura)}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h2 id={idTitulo} className="text-[16px] font-bold">
                  {titulo}
                </h2>
                {descricao && <div className="mt-1 text-[12.5px] leading-relaxed text-muted">{descricao}</div>}
              </div>
              <button
                type="button"
                data-fechar
                aria-label="Fechar"
                title="Fechar (Esc)"
                onClick={aoFechar}
                className="-mr-1.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-faint transition-colors hover:bg-card-hover hover:text-text"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
            {rodape && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-raised/40 px-5 py-3.5">{rodape}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ───────────────────────── confirmação ───────────────────────── */

interface PedidoConfirmacao {
  titulo: string
  texto: ReactNode
  confirmar: string
  perigo?: boolean
  resolver: (ok: boolean) => void
}

const useConfirmacao = create<{ pedido: PedidoConfirmacao | null; definir: (p: PedidoConfirmacao | null) => void }>((set) => ({
  pedido: null,
  definir: (pedido) => set({ pedido }),
}))

/** Pede confirmação antes de uma ação destrutiva ou difícil de desfazer. */
export function confirmar(opcoes: { titulo: string; texto: ReactNode; confirmar: string; perigo?: boolean }): Promise<boolean> {
  return new Promise((resolver) => useConfirmacao.getState().definir({ ...opcoes, resolver }))
}

export function cancelarConfirmacao() {
  const p = useConfirmacao.getState().pedido
  if (p) {
    p.resolver(false)
    useConfirmacao.getState().definir(null)
  }
}

export function Confirmacao() {
  const { pedido, definir } = useConfirmacao()
  const fechar = (ok: boolean) => {
    pedido?.resolver(ok)
    definir(null)
  }
  return (
    <Modal
      aberto={!!pedido}
      aoFechar={() => fechar(false)}
      titulo={pedido?.titulo ?? ''}
      largura="max-w-md"
      rodape={
        <>
          <Botao variante="fantasma" onClick={() => fechar(false)}>
            Cancelar
          </Botao>
          <Botao variante={pedido?.perigo ? 'perigo' : 'primario'} onClick={() => fechar(true)} data-foco-inicial>
            {pedido?.confirmar}
          </Botao>
        </>
      }
    >
      <div className="text-[13.5px] leading-relaxed text-muted">{pedido?.texto}</div>
    </Modal>
  )
}
