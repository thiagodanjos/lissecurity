import { useState } from 'react'
import { Copy, KeyRound } from 'lucide-react'
import { api, descartado } from '@/lib/ipc'
import { avisar, erroParaTexto } from './avisos'
import { Aviso, Botao } from './ui'

/**
 * Mostra uma chave de recuperação UMA vez. Não fica guardada em lado nenhum da interface:
 * quando este componente sai do ecrã, o texto desaparece com ele.
 */
export function MostrarChaveRecuperacao({ chave, aoConcluir, textoBotao = 'Continuar' }: { chave: string; aoConcluir: () => void; textoBotao?: string }) {
  const [guardada, setGuardada] = useState(false)
  const grupos = chave.split('-')
  const copiar = async () => {
    try {
      const s = await api.copiarTexto(chave)
      avisar('sucesso', `Chave copiada. A área de transferência é limpa em ${s} s.`)
    } catch (e) {
      if (descartado(e)) return
      avisar('erro', erroParaTexto(e))
    }
  }
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-accent/25 bg-accent-soft/50 p-4">
        <p className="mb-3 flex items-center gap-2 text-[12px] font-bold tracking-wide text-accent">
          <KeyRound className="size-4" aria-hidden="true" /> CHAVE DE RECUPERAÇÃO
        </p>
        <p className="mono selecionavel grid grid-cols-3 gap-x-3 gap-y-1.5 text-center text-[17px] font-semibold tracking-[0.08em] text-text" aria-label={`Chave de recuperação: ${grupos.join(' ')}`}>
          {grupos.map((g, i) => (
            <span key={i} className="rounded-lg bg-black/25 py-1">
              {g}
            </span>
          ))}
        </p>
        <div className="mt-3 flex justify-end">
          <Botao variante="contorno" tamanho="sm" icone={<Copy />} onClick={copiar}>
            Copiar
          </Botao>
        </div>
      </div>
      <Aviso tom="ambar">
        Escreve-a em papel ou guarda-a num sítio seguro <strong>fora deste computador</strong>. Quem tiver esta chave consegue abrir o
        cofre. Não a voltamos a mostrar — se a perderes, podes gerar outra nas definições de segurança (com a senha mestra).
      </Aviso>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-raised px-3.5 py-3 text-[13px] text-text">
        <input type="checkbox" checked={guardada} onChange={(e) => setGuardada(e.target.checked)} className="mt-0.5 size-4 cursor-pointer accent-[var(--color-accent)]" />
        Guardei a chave de recuperação num local seguro.
      </label>
      <Botao largo tamanho="lg" disabled={!guardada} onClick={aoConcluir}>
        {textoBotao}
      </Botao>
    </div>
  )
}
