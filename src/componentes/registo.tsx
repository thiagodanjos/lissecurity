import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, CreditCard, ExternalLink, Eye, EyeOff, Landmark, NotebookPen, Wifi } from 'lucide-react'
import { api, descartado } from '@/lib/ipc'
import type { Mascarado, Resumo, TipoItem } from '@/lib/tipos'
import { agrupar4, estadoValidade } from '@/lib/formatos'
import { cn, inicial, tomDe } from '@/lib/utils'
import { avisar, erroParaTexto } from './avisos'
import { cancelado, comReautenticacao } from './reautenticacao'
import { useSessao } from '@/lib/sessao'
import { AcaoLinha } from './ui'

/** Ícone local de um registo: nada é ido buscar à internet (sem favicons). */
export function IconeRegisto({ tipo, titulo, dominio, tamanho = 'md' }: { tipo: TipoItem; titulo: string; dominio?: string; tamanho?: 'sm' | 'md' | 'lg' }) {
  const t = { sm: 'size-8 rounded-lg text-[13px] [&_svg]:size-4', md: 'size-10 rounded-xl text-[15px] [&_svg]:size-[18px]', lg: 'size-14 rounded-2xl text-[22px] [&_svg]:size-6' }[tamanho]
  if (tipo === 'login') {
    const base = dominio || titulo
    const cor = tomDe(base)
    return (
      <span
        aria-hidden="true"
        className={cn('flex shrink-0 items-center justify-center border font-extrabold', t)}
        style={{ color: cor, background: `color-mix(in srgb, ${cor} 13%, #0b0d10)`, borderColor: `color-mix(in srgb, ${cor} 24%, transparent)` }}
      >
        {inicial(base)}
      </span>
    )
  }
  const icone = tipo === 'banco' ? <Landmark /> : tipo === 'cartao' ? <CreditCard /> : <NotebookPen />
  return (
    <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center border border-accent/20 bg-accent-soft text-accent', t)}>
      {icone}
    </span>
  )
}

const FUNDOS_CARTAO: Record<string, string> = {
  Visa: 'linear-gradient(135deg, #16233d 0%, #0e1526 60%, #0b0f1a 100%)',
  Mastercard: 'linear-gradient(135deg, #2a1a12 0%, #191210 60%, #0f0c0b 100%)',
  'American Express': 'linear-gradient(135deg, #10282b 0%, #0c1a1c 60%, #0a1112 100%)',
  Elo: 'linear-gradient(135deg, #24201a 0%, #15130f 60%, #0d0c0a 100%)',
}

/** Cartão visual. Nunca mostra o número completo — só os últimos 4 algarismos. */
export function CartaoVisual({ resumo, compacto, className }: { resumo: Pick<Resumo, 'titulo' | 'fim' | 'bandeira' | 'validade' | 'instituicao' | 'tipoDetalhe'>; compacto?: boolean; className?: string }) {
  const estado = resumo.validade ? estadoValidade(resumo.validade) : null
  return (
    <div
      className={cn('relative flex aspect-[1.586] w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] text-left shadow-[0_14px_40px_-18px_rgb(0_0_0/0.9)]', compacto ? 'p-3.5' : 'p-5', className)}
      style={{ background: FUNDOS_CARTAO[resumo.bandeira ?? ''] ?? 'linear-gradient(135deg, #142a1e 0%, #0f1a14 55%, #0b100d 100%)' }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 size-48 rounded-full bg-[radial-gradient(circle,rgb(30_215_96/0.16),transparent_65%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_40%,rgb(255_255_255/0.035)_50%,transparent_60%)]" />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('truncate font-bold text-text', compacto ? 'text-[12.5px]' : 'text-[14px]')}>{resumo.titulo}</p>
          {resumo.instituicao && <p className="truncate text-[11px] text-muted">{resumo.instituicao}</p>}
        </div>
        <Wifi className={cn('shrink-0 rotate-90 text-white/40', compacto ? 'size-3.5' : 'size-4')} aria-hidden="true" />
      </div>
      <div className="relative">
        <span aria-hidden="true" className={cn('mb-2 block rounded-md bg-gradient-to-br from-[#d9c27a] to-[#9c8443] opacity-80', compacto ? 'h-5 w-7' : 'h-7 w-10')} />
        <p className={cn('mono font-semibold tracking-[0.14em] text-text', compacto ? 'text-[13px]' : 'text-[17px]')} aria-label={resumo.fim ? `Cartão terminado em ${resumo.fim}` : 'Número não definido'}>
          •••• •••• •••• {resumo.fim ?? '••••'}
        </p>
        <div className="mt-1.5 flex items-end justify-between gap-2 text-[10.5px] text-muted">
          <span className="flex items-center gap-1.5">
            {resumo.validade && <span className="mono">{resumo.validade}</span>}
            {estado === 'expirado' && <span className="rounded-full bg-danger/20 px-1.5 text-[9.5px] font-bold text-danger">EXPIRADO</span>}
            {estado === 'a-expirar' && <span className="rounded-full bg-warn/20 px-1.5 text-[9.5px] font-bold text-warn">EXPIRA EM BREVE</span>}
          </span>
          <span className="font-bold tracking-wide text-text/80">{resumo.bandeira ?? ''}</span>
        </div>
      </div>
    </div>
  )
}

/** Botão de copiar que confirma com um visto (sem nunca mostrar o valor copiado). */
export function BotaoCopiar({ copiar, rotulo = 'Copiar' }: { copiar: () => Promise<number | void>; rotulo?: string }) {
  const [feito, setFeito] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(temporizador.current), [])
  return (
    <AcaoLinha
      rotulo={rotulo}
      ativo={feito}
      onClick={async () => {
        try {
          const s = await comReautenticacao(copiar)
          setFeito(true)
          clearTimeout(temporizador.current)
          temporizador.current = setTimeout(() => setFeito(false), 1400)
          avisar('sucesso', typeof s === 'number' ? `Copiado. A área de transferência é limpa em ${s} s.` : 'Copiado.')
        } catch (e) {
          if (descartado(e) || cancelado(e)) return
          avisar('erro', erroParaTexto(e))
        }
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={feito ? 'ok' : 'copiar'} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.12 }}>
          {feito ? <Check /> : <Copy />}
        </motion.span>
      </AnimatePresence>
    </AcaoLinha>
  )
}

/** Linha de um campo no painel de detalhe. */
export function LinhaCampo({ rotulo, children, acoes, className }: { rotulo: string; children: ReactNode; acoes?: ReactNode; className?: string }) {
  return (
    <div className={cn('campo-detalhe group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]', className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold tracking-wide text-faint">{rotulo}</p>
        <div className="mt-0.5 min-w-0 text-[13.5px] text-text">{children}</div>
      </div>
      {acoes && <div className="flex shrink-0 items-center gap-0.5">{acoes}</div>}
    </div>
  )
}

/** Campo de texto simples (não secreto) com copiar. */
export function CampoTexto({ id, campo, rotulo, valor, abrir }: { id: string; campo: string; rotulo: string; valor: string; abrir?: () => void }) {
  if (!valor) return null
  return (
    <LinhaCampo
      rotulo={rotulo}
      acoes={
        <>
          {abrir && (
            <AcaoLinha rotulo="Abrir no navegador" onClick={abrir}>
              <ExternalLink />
            </AcaoLinha>
          )}
          <BotaoCopiar rotulo={`Copiar ${rotulo.toLowerCase()}`} copiar={() => api.copiarCampo(id, campo)} />
        </>
      }
    >
      <span className="selecionavel block truncate" title={valor}>
        {valor}
      </span>
    </LinhaCampo>
  )
}


/**
 * Campo secreto: mascarado por padrão. "Revelar" pede o valor à camada nativa e volta a
 * escondê-lo ao fim do tempo escolhido nas definições, ao mudar de registo (o componente é recriado) ou ao bloquear
 * (o ecrã inteiro é desmontado).
 */
export function CampoSegredo({
  id,
  campo,
  rotulo,
  mascarado,
  formato,
  multilinha,
  semCopiar,
}: {
  id: string
  campo: string
  rotulo: string
  mascarado: Mascarado
  formato?: 'agrupar'
  multilinha?: boolean
  semCopiar?: boolean
}) {
  const [valor, setValor] = useState<string | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(
    () => () => {
      clearTimeout(temporizador.current)
    },
    [],
  )
  useEffect(() => {
    setValor(null)
  }, [id, campo])
  if (!mascarado.definido) return null

  const alternar = async () => {
    if (valor !== null) {
      setValor(null)
      clearTimeout(temporizador.current)
      return
    }
    try {
      const v = await comReautenticacao(() => api.revelarCampo(id, campo))
      setValor(v)
      clearTimeout(temporizador.current)
      temporizador.current = setTimeout(() => setValor(null), useSessao.getState().ocultarSegundos * 1000)
    } catch (e) {
      if (descartado(e) || cancelado(e)) return
      avisar('erro', erroParaTexto(e))
    }
  }

  const mostrado = valor === null ? null : formato === 'agrupar' ? agrupar4(valor) : valor
  return (
    <LinhaCampo
      rotulo={rotulo}
      acoes={
        <>
          <AcaoLinha rotulo={valor === null ? `Revelar ${rotulo.toLowerCase()}` : `Ocultar ${rotulo.toLowerCase()}`} onClick={alternar} ativo={valor !== null}>
            {valor === null ? <Eye /> : <EyeOff />}
          </AcaoLinha>
          {!semCopiar && <BotaoCopiar rotulo={`Copiar ${rotulo.toLowerCase()}`} copiar={() => api.copiarCampo(id, campo)} />}
        </>
      }
    >
      {mostrado === null ? (
        <span className="mono mascara text-muted" aria-label={`${rotulo} oculto`}>
          {mascarado.fim ? `•••• ${mascarado.fim}` : '••••••••••••'}
        </span>
      ) : multilinha ? (
        <pre className="selecionavel mono mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/25 p-3 text-[12.5px] leading-relaxed">{mostrado}</pre>
      ) : (
        <span className="selecionavel mono block break-all text-text">{mostrado}</span>
      )}
    </LinhaCampo>
  )
}

export function Grupo({ titulo, children, className }: { titulo?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-2xl border border-border bg-card', className)}>
      {titulo && <p className="border-b border-border/70 px-4 pb-2 pt-3 text-[10px] font-bold tracking-widest text-faint">{titulo.toUpperCase()}</p>}
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  )
}
