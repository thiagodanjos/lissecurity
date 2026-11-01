import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { create } from 'zustand'
import { api, descartado, ErroIpc } from '@/lib/ipc'
import { Aviso, Botao, CampoSenha, Modal } from './ui'

interface Pedido {
  resolver: (ok: boolean) => void
}

const useReautenticacao = create<{ pedido: Pedido | null; definir: (p: Pedido | null) => void }>((set) => ({
  pedido: null,
  definir: (pedido) => set({ pedido }),
}))

/** Pede a senha mestra (a confirmação vale 5 minutos na camada nativa). */
function pedirSenhaMestra(): Promise<boolean> {
  return new Promise((resolver) => useReautenticacao.getState().definir({ resolver }))
}

/**
 * Executa `f`; se a camada nativa responder que precisa da senha mestra (opção "pedir a
 * senha para dados financeiros"), pede-a e tenta outra vez.
 */
export async function comReautenticacao<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e) {
    if (e instanceof ErroIpc && e.codigo === 'reautenticar') {
      if (await pedirSenhaMestra()) return await f()
      throw new ErroIpc('cancelado', 'Cancelado.')
    }
    throw e
  }
}

export const cancelado = (e: unknown) => e instanceof ErroIpc && e.codigo === 'cancelado'

export function Reautenticacao() {
  const { pedido, definir } = useReautenticacao()
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aVerificar, setAVerificar] = useState(false)

  const fechar = (ok: boolean) => {
    pedido?.resolver(ok)
    definir(null)
    setSenha('')
    setErro(null)
  }

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!senha) return
    setAVerificar(true)
    setErro(null)
    try {
      await api.reautenticar(senha)
      setSenha('')
      fechar(true)
    } catch (err) {
      if (descartado(err)) return fechar(false)
      setErro(err instanceof ErroIpc && err.codigo === 'credencial' ? 'A senha mestra não está correta.' : err instanceof Error ? err.message : 'Erro inesperado.')
    } finally {
      setAVerificar(false)
    }
  }

  return (
    <Modal aberto={!!pedido} aoFechar={() => fechar(false)} titulo="Confirma que és tu" largura="max-w-sm">
      <form onSubmit={confirmar} className="space-y-4">
        <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          Para ver ou copiar números de cartões e contas, escreve a senha mestra. Vale durante 5 minutos (ou até bloquear).
        </p>
        <CampoSenha rotulo="Senha mestra" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
        {erro && <Aviso tom="vermelho">{erro}</Aviso>}
        <div className="flex justify-end gap-2">
          <Botao variante="fantasma" onClick={() => fechar(false)}>
            Cancelar
          </Botao>
          <Botao type="submit" carregando={aVerificar} disabled={!senha}>
            Confirmar
          </Botao>
        </div>
      </form>
    </Modal>
  )
}
