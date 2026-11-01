// Notificações curtas. As mensagens são sempre genéricas ("Senha copiada") — nunca levam o
// valor de um segredo, nem o nome de um registo.

import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, Check, Info } from 'lucide-react'
import { create } from 'zustand'
import { cn } from '@/lib/utils'

type Tom = 'sucesso' | 'erro' | 'info'
interface Notificacao {
  id: number
  tom: Tom
  texto: string
}

const useAvisos = create<{ lista: Notificacao[]; por: (n: Notificacao) => void; tirar: (id: number) => void; limpar: () => void }>((set) => ({
  lista: [],
  por: (n) => set((s) => ({ lista: [...s.lista.slice(-2), n] })),
  tirar: (id) => set((s) => ({ lista: s.lista.filter((x) => x.id !== id) })),
  limpar: () => set({ lista: [] }),
}))

let contador = 0
export function avisar(tom: Tom, texto: string, ms = 3200) {
  const id = ++contador
  useAvisos.getState().por({ id, tom, texto })
  setTimeout(() => useAvisos.getState().tirar(id), ms)
}

export const limparAvisos = () => useAvisos.getState().limpar()

export function erroParaTexto(e: unknown): string {
  return e instanceof Error ? e.message : 'Ocorreu um erro inesperado.'
}

export function Avisos() {
  const lista = useAvisos((s) => s.lista)
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-[120] flex flex-col items-center gap-2 px-4">
      <AnimatePresence initial={false}>
        {lista.map((n) => (
          <motion.div
            key={n.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            role={n.tom === 'erro' ? 'alert' : 'status'}
            className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2.5 text-[13px] font-medium text-text shadow-sobreposicao"
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full [&_svg]:size-3',
                n.tom === 'sucesso' && 'bg-accent text-black',
                n.tom === 'erro' && 'bg-danger text-white',
                n.tom === 'info' && 'bg-raised text-muted',
              )}
            >
              {n.tom === 'sucesso' ? <Check strokeWidth={3} /> : n.tom === 'erro' ? <AlertCircle strokeWidth={2.5} /> : <Info strokeWidth={2.5} />}
            </span>
            {n.texto}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
