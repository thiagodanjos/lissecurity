import { useEffect, useState } from 'react'
import { api, ignorarDescartado } from '@/lib/ipc'
import type { Forca } from '@/lib/tipos'
import { cn } from '@/lib/utils'

export const ROTULOS_FORCA = ['Muito fraca', 'Fraca', 'Razoável', 'Forte', 'Muito forte']

export function corForca(p: number) {
  return p <= 1 ? 'bg-danger' : p === 2 ? 'bg-warn' : 'bg-accent'
}
export function textoCorForca(p: number) {
  return p <= 1 ? 'text-danger' : p === 2 ? 'text-warn' : 'text-accent'
}

/** Avalia a senha (na camada nativa, com o zxcvbn) com um pequeno atraso enquanto se escreve. */
export function useForca(senha: string, contexto: string[] = []): Forca | null {
  const [forca, setForca] = useState<Forca | null>(null)
  const chaveContexto = contexto.join('\u0000')
  useEffect(() => {
    if (!senha) {
      setForca(null)
      return
    }
    let vivo = true
    const t = setTimeout(() => {
      api
        .avaliarSenha(senha, chaveContexto ? chaveContexto.split('\u0000') : [])
        .then((f) => vivo && setForca(f))
        .catch(ignorarDescartado)
        .catch(() => {})
    }, 160)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [senha, chaveContexto])
  return forca
}

/** Medidor de força: barras + rótulo. Apresentado sempre como estimativa. */
export function MedidorForca({ forca, className, compacto }: { forca: Forca | null; className?: string; compacto?: boolean }) {
  const p = forca?.pontuacao ?? -1
  return (
    <div className={className} aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
            <span
              className={cn('block h-full origin-left rounded-full transition-[transform,background-color] duration-300', p >= 0 ? corForca(p) : 'bg-transparent')}
              style={{ transform: `scaleX(${p > i || (p === 0 && i === 0) ? 1 : 0})` }}
            />
          </span>
        ))}
      </div>
      {!compacto && (
        <p className="mt-1.5 text-[11.5px] text-faint">
          {forca ? (
            <>
              Força estimada: <span className={cn('font-semibold', textoCorForca(p))}>{ROTULOS_FORCA[p]}</span>
              {' · '}é uma estimativa, não uma garantia.
            </>
          ) : (
            'A força é estimada localmente, sem enviar nada para a internet.'
          )}
        </p>
      )}
    </div>
  )
}
