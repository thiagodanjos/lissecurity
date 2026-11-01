import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Fila horizontal (categorias, etiquetas…) que nunca esconde opções: quando há mais do que
 * cabe, aparecem setas nas pontas, a roda do rato rola para os lados e as pontas desvanecem
 * para mostrar que há mais. O elemento com foco (teclado) é sempre trazido para a vista.
 */
export function FilaComSetas({ children, rotulo, className }: { children: ReactNode; rotulo: string; className?: string }) {
  const fila = useRef<HTMLDivElement>(null)
  const [esq, setEsq] = useState(false)
  const [dir, setDir] = useState(false)

  const medir = useCallback(() => {
    const f = fila.current
    if (!f) return
    setEsq(f.scrollLeft > 2)
    setDir(f.scrollLeft + f.clientWidth < f.scrollWidth - 2)
  }, [])

  useEffect(() => {
    const f = fila.current
    if (!f) return
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(f)
    for (const filho of Array.from(f.children)) ro.observe(filho)
    return () => ro.disconnect()
  }, [medir, children])

  const rolar = (sentido: 1 | -1) => {
    const f = fila.current
    if (f) f.scrollBy({ left: sentido * Math.max(120, f.clientWidth * 0.7), behavior: 'smooth' })
  }

  const seta = 'absolute top-1/2 z-10 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted shadow-card transition-colors hover:border-accent/40 hover:text-accent'

  return (
    <div className={cn('relative', className)} role="group" aria-label={rotulo}>
      {esq && (
        <button type="button" aria-label="Ver as anteriores" title="Anteriores" onClick={() => rolar(-1)} className={cn(seta, '-left-1')}>
          <ChevronLeft className="size-4" />
        </button>
      )}
      <div
        ref={fila}
        onScroll={medir}
        onWheel={(e) => {
          // roda vertical do rato → rolar na horizontal
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && fila.current) fila.current.scrollLeft += e.deltaY
        }}
        onFocus={(e) => (e.target as HTMLElement).scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
        className="sem-barra flex gap-1.5 overflow-x-auto scroll-smooth py-0.5"
        style={{
          maskImage: `linear-gradient(to right, ${esq ? 'transparent 0, black 36px' : 'black 0'}, black calc(100% - 36px), ${dir ? 'transparent 100%' : 'black 100%'})`,
          WebkitMaskImage: `linear-gradient(to right, ${esq ? 'transparent 0, black 36px' : 'black 0'}, black calc(100% - 36px), ${dir ? 'transparent 100%' : 'black 100%'})`,
        }}
      >
        {children}
      </div>
      {dir && (
        <button type="button" aria-label="Ver as seguintes" title="Seguintes" onClick={() => rolar(1)} className={cn(seta, '-right-1')}>
          <ChevronRight className="size-4" />
        </button>
      )}
    </div>
  )
}
