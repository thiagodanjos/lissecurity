import { useState } from 'react'
import { motion } from 'framer-motion'
import { KeyRound, LockKeyhole } from 'lucide-react'
import { api, descartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import { FundoLis } from '@/componentes/fundo'
import { MedidorForca, useForca } from '@/componentes/forca'
import { MostrarChaveRecuperacao } from '@/componentes/chave-recuperacao'
import { erroParaTexto } from '@/componentes/avisos'
import { Aviso, Botao, CampoSenha } from '@/componentes/ui'
import { bloquearAgora } from '@/lib/acoes'

/** Depois de abrir com a chave de recuperação: é obrigatório definir uma senha mestra nova. */
export function NovaSenha() {
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aGuardar, setAGuardar] = useState(false)
  const [chave, setChave] = useState<string | null>(null)
  const forca = useForca(senha)

  const entrar = async () => useSessao.getState().carregar(await api.estadoApp())

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    if ([...senha].length < 12) return setErro('A senha mestra precisa de pelo menos 12 caracteres.')
    if (senha !== confirmacao) return setErro('As duas senhas não são iguais.')
    setAGuardar(true)
    setErro(null)
    try {
      const k = await api.alterarSenha(null, senha)
      setSenha('')
      setConfirmacao('')
      if (k) setChave(k)
      else await entrar()
    } catch (err) {
      if (descartado(err)) return
      setErro(erroParaTexto(err))
    } finally {
      setAGuardar(false)
    }
  }

  return (
    <div className="relative flex h-full items-center justify-center overflow-y-auto bg-bg px-6 py-10">
      <FundoLis />
      <motion.div className="relative w-full max-w-[440px]" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="rounded-2xl border border-border bg-card/90 p-6 shadow-sobreposicao backdrop-blur-md">
          <div className="mb-5 flex items-start gap-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent-soft text-accent">
              {chave ? <KeyRound className="size-5" /> : <LockKeyhole className="size-5" />}
            </span>
            <div>
              <h1 className="text-[19px] font-extrabold tracking-tight">{chave ? 'Nova chave de recuperação' : 'Define uma senha mestra nova'}</h1>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                {chave
                  ? 'A chave que usaste deixou de abrir este cofre (continua a abrir as cópias antigas). Guarda esta.'
                  : 'Abriste o cofre com a chave de recuperação. Antes de continuar, escolhe a senha mestra que vais usar daqui em diante.'}
              </p>
            </div>
          </div>
          {chave ? (
            <MostrarChaveRecuperacao chave={chave} aoConcluir={() => void entrar()} textoBotao="Entrar no cofre" />
          ) : (
            <form onSubmit={guardar} className="space-y-4">
              <CampoSenha rotulo="Senha mestra nova" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
              <MedidorForca forca={forca} />
              <CampoSenha rotulo="Repetir a senha mestra nova" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
              {erro && <Aviso tom="vermelho">{erro}</Aviso>}
              <Botao type="submit" largo tamanho="lg" carregando={aGuardar}>
                Guardar a senha nova
              </Botao>
              <button type="button" onClick={() => bloquearAgora()} className="w-full cursor-pointer text-center text-[12.5px] text-faint hover:text-text">
                Cancelar e bloquear
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  )
}
