import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, KeyRound, LockKeyhole, ShieldCheck, WifiOff } from 'lucide-react'
import { api, ErroIpc, descartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import { FundoLis } from '@/componentes/fundo'
import { avisar } from '@/componentes/avisos'
import { Aviso, Botao, Campo, CampoSenha, Marca, Simbolo } from '@/componentes/ui'
import { cn } from '@/lib/utils'

const MOTIVOS: Record<string, string> = {
  inatividade: 'Bloqueado por inatividade',
  suspensao: 'Bloqueado porque o computador suspendeu',
  sistema: 'Bloqueado com a sessão do Windows',
  minimizar: 'Bloqueado ao minimizar',
  sessao: 'A sessão do cofre terminou',
}

/** Ecrã de desbloqueio. Antes de desbloquear não aparece nada do cofre: nem nomes, nem contagens. */
export function Desbloqueio() {
  const motivo = useSessao((s) => s.motivoBloqueio)
  const [modo, setModo] = useState<'senha' | 'recuperacao'>('senha')
  const [senha, setSenha] = useState('')
  const [chave, setChave] = useState('')
  const [aAbrir, setAAbrir] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const [capsLock, setCapsLock] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => campo.current?.focus(), 60)
  }, [modo])

  const abrir = async (e: React.FormEvent) => {
    e.preventDefault()
    if (aAbrir) return
    const valor = modo === 'senha' ? senha : chave
    if (!valor) {
      setErro(modo === 'senha' ? 'Escreve a senha mestra.' : 'Escreve a chave de recuperação.')
      setTentativa((t) => t + 1)
      return
    }
    setAAbrir(true)
    setErro(null)
    try {
      const r = modo === 'senha' ? await api.desbloquear(valor) : await api.desbloquearRecuperacao(valor)
      setSenha('')
      setChave('')
      if (r.recuperadoAnterior) {
        avisar('info', 'O ficheiro do cofre estava danificado: foi reposta a versão anterior.', 8000)
      }
      const estado = await api.estadoApp()
      useSessao.getState().carregar(estado)
    } catch (err) {
      if (descartado(err)) {
        setAAbrir(false)
        return
      }
      const codigo = err instanceof ErroIpc ? err.codigo : ''
      setErro(
        codigo === 'credencial'
          ? modo === 'senha'
            ? 'A senha não abre este cofre. Confirma se o Caps Lock está desligado.'
            : 'Esta chave não abre o cofre.'
          : err instanceof Error
            ? err.message
            : 'Não foi possível abrir o cofre.',
      )
      setTentativa((t) => t + 1)
      setAAbrir(false)
      setTimeout(() => campo.current?.select(), 30)
    }
  }

  const tecla = (e: React.KeyboardEvent) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-y-auto bg-bg px-6 py-10">
      <FundoLis />
      <motion.div
        className="relative w-full max-w-[380px]"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-7 flex flex-col items-center text-center">
          <motion.div
            className="mb-5 flex size-[84px] items-center justify-center rounded-[26px] border border-white/[0.07] bg-[radial-gradient(circle_at_35%_40%,#11201a,#0a0d10_70%)] shadow-[0_18px_50px_-12px_rgb(0_0_0/0.8)]"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <Simbolo className="h-9 w-auto" />
          </motion.div>
          <Marca tamanho="lg" className="[&>svg]:hidden" />
          <p className="mt-2.5 text-[13.5px] text-muted">{modo === 'senha' ? 'O teu cofre está bloqueado.' : 'Abrir com a chave de recuperação'}</p>
          <AnimatePresence>
            {motivo && MOTIVOS[motivo] && modo === 'senha' && (
              <motion.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-raised px-3 py-1 text-[11.5px] font-medium text-faint"
              >
                <LockKeyhole className="size-3" aria-hidden="true" /> {MOTIVOS[motivo]}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <form onSubmit={abrir} className={cn('rounded-2xl border border-border bg-card/85 p-6 shadow-sobreposicao backdrop-blur-md', tentativa > 0 && erro && 'abana')} key={tentativa}>
          {modo === 'senha' ? (
            <CampoSenha
              ref={campo}
              rotulo="Senha mestra"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              onKeyDown={tecla}
              onKeyUp={tecla}
              disabled={aAbrir}
              placeholder="A tua frase-senha"
              autoFocus
            />
          ) : (
            <Campo
              ref={campo}
              rotulo="Chave de recuperação"
              value={chave}
              onChange={(e) => setChave(e.target.value.toUpperCase())}
              disabled={aAbrir}
              placeholder="XXXX-XXXX-XXXX-…"
              className="[&_input]:mono [&_input]:tracking-wider"
              ajuda="Depois de abrir, vais definir uma senha mestra nova."
            />
          )}
          {capsLock && modo === 'senha' && !erro && <p className="mt-2 text-[11.5px] font-medium text-warn">O Caps Lock está ligado.</p>}
          <AnimatePresence>
            {erro && (
              <motion.p
                role="alert"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2.5 text-[12.5px] leading-snug text-danger"
              >
                {erro}
              </motion.p>
            )}
          </AnimatePresence>
          <Botao type="submit" largo tamanho="lg" carregando={aAbrir} className="mt-5">
            {aAbrir ? 'A abrir o cofre…' : modo === 'senha' ? 'Desbloquear' : 'Abrir com a chave'}
          </Botao>
          {aAbrir && <p className="mt-2.5 text-center text-[11.5px] text-faint">A derivar a chave com Argon2id — demora cerca de um segundo de propósito.</p>}
        </form>

        <div className="mt-5 text-center">
          {modo === 'senha' ? (
            <button
              type="button"
              onClick={() => {
                setModo('recuperacao')
                setErro(null)
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] font-medium text-faint transition-colors hover:text-accent"
            >
              <KeyRound className="size-3.5" aria-hidden="true" /> Esqueci-me da senha mestra
            </button>
          ) : (
            <div className="space-y-4">
              <Aviso tom="neutro" className="text-left">
                Sem a senha mestra, só a <strong>chave de recuperação</strong> (se a configuraste) abre o cofre. Não existe recuperação por
                e-mail nem nenhuma chave universal — é isso que mantém o cofre só teu.
              </Aviso>
              <button
                type="button"
                onClick={() => {
                  setModo('senha')
                  setErro(null)
                }}
                className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] font-medium text-faint transition-colors hover:text-accent"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" /> Voltar à senha mestra
              </button>
            </div>
          )}
        </div>
      </motion.div>

      <p className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3 text-[11px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" aria-hidden="true" /> Cifrado neste computador
        </span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1.5">
          <WifiOff className="size-3.5" aria-hidden="true" /> Funciona sem internet
        </span>
      </p>
    </div>
  )
}
