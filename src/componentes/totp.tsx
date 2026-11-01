import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api, descartado } from '@/lib/ipc'
import type { CodigoTotp } from '@/lib/tipos'
import { cn } from '@/lib/utils'
import { BotaoCopiar, LinhaCampo } from './registo'

/**
 * Código de verificação em 2 passos do momento, com a contagem decrescente num anel.
 * Só pede um código novo à camada nativa quando o período acaba (e esses pedidos não contam
 * como atividade, para não impedirem o bloqueio automático).
 */
export function CodigoDoisPassos({ id }: { id: string }) {
  const [codigo, setCodigo] = useState<CodigoTotp | null>(null)
  const [restante, setRestante] = useState(0)
  const [erro, setErro] = useState(false)
  const pedido = useRef(0)

  const buscar = useRef<() => void>(() => {})

  useEffect(() => {
    let vivo = true
    buscar.current = async () => {
      const n = ++pedido.current
      try {
        const c = await api.codigoTotp(id)
        if (!vivo || n !== pedido.current) return
        setCodigo(c)
        setRestante(c.restante)
        setErro(false)
      } catch (e) {
        if (descartado(e) || !vivo) return
        setErro(true)
      }
    }
    buscar.current()
    const relogio = setInterval(() => setRestante((r) => Math.max(0, r - 1)), 1000)
    return () => {
      vivo = false
      clearInterval(relogio)
    }
  }, [id])

  // o período acabou: pede o código seguinte (uma vez)
  useEffect(() => {
    if (codigo && restante === 0) buscar.current()
  }, [restante, codigo])

  if (erro) {
    return (
      <LinhaCampo rotulo="Código 2FA">
        <span className="text-[12.5px] text-danger">A chave 2FA guardada não é válida. Edita o registo para a corrigir.</span>
      </LinhaCampo>
    )
  }
  const periodo = codigo?.periodo ?? 30
  const fracao = codigo ? restante / periodo : 0
  const urgente = restante <= 5
  const metade = codigo ? Math.ceil(codigo.codigo.length / 2) : 3
  const r = 9
  const perimetro = 2 * Math.PI * r
  return (
    <LinhaCampo
      rotulo={`Código 2FA${codigo?.emissor ? ` · ${codigo.emissor}` : ''}`}
      acoes={<BotaoCopiar rotulo="Copiar código 2FA" copiar={() => api.copiarCodigoTotp(id)} />}
    >
      <div className="flex items-center gap-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={codigo?.codigo ?? 'a-carregar'}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className={cn('mono selecionavel text-[20px] font-bold tracking-[0.14em]', urgente ? 'text-warn' : 'text-accent')}
            aria-live="polite"
          >
            {codigo ? `${codigo.codigo.slice(0, metade)} ${codigo.codigo.slice(metade)}` : '··· ···'}
          </motion.span>
        </AnimatePresence>
        <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-faint" title="Segundos até o código mudar">
          <svg viewBox="0 0 24 24" className="size-5 -rotate-90" aria-hidden="true">
            <circle cx="12" cy="12" r={r} fill="none" stroke="var(--color-border)" strokeWidth="3" />
            <circle
              cx="12"
              cy="12"
              r={r}
              fill="none"
              stroke={urgente ? 'var(--color-warn)' : 'var(--color-accent)'}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={perimetro}
              strokeDashoffset={perimetro * (1 - fracao)}
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          {restante} s
        </span>
      </div>
    </LinhaCampo>
  )
}
