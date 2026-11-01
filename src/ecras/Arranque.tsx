import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Cloud,
  Check,
  FileLock2,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Timer,
  UserRound,
  WifiOff,
} from 'lucide-react'
import { api, ErroIpc, descartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import { FundoLis } from '@/componentes/fundo'
import { MedidorForca, useForca } from '@/componentes/forca'
import { MostrarChaveRecuperacao } from '@/componentes/chave-recuperacao'
import { avisar, erroParaTexto } from '@/componentes/avisos'
import { Aviso, Botao, Campo, CampoSenha, Marca } from '@/componentes/ui'
import { cn } from '@/lib/utils'
import { data, plural } from '@/lib/formatos'
import type { CopiaEncontrada, InfoCopia } from '@/lib/tipos'

type Passo = 'boas-vindas' | 'nome' | 'senha' | 'confirmar' | 'recuperacao' | 'bloqueio' | 'a-criar' | 'chave' | 'restaurar'

const PASSOS_CRIACAO: Passo[] = ['nome', 'senha', 'confirmar', 'recuperacao', 'bloqueio']
const MIN = 12

/** Primeiro uso: criar um cofre novo ou restaurar uma cópia de segurança. */
export function Arranque() {
  const [passo, setPasso] = useState<Passo>('boas-vindas')
  const [direcao, setDirecao] = useState(1)
  const [nome, setNome] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [comRecuperacao, setComRecuperacao] = useState(true)
  const [minutos, setMinutos] = useState(5)
  const [erro, setErro] = useState<string | null>(null)
  const [chave, setChave] = useState<string | null>(null)
  const forca = useForca(senha, nome ? [nome] : [])
  const [aceitarFraca, setAceitarFraca] = useState(false)

  const ir = (p: Passo, d = 1) => {
    setErro(null)
    setDirecao(d)
    setPasso(p)
  }

  const entrar = async () => {
    setSenha('')
    setConfirmacao('')
    setChave(null)
    useSessao.getState().carregar(await api.estadoApp())
  }

  const criar = async () => {
    ir('a-criar')
    try {
      const k = await api.criarCofre(senha, nome.trim(), minutos, comRecuperacao)
      setSenha('')
      setConfirmacao('')
      if (k) {
        setChave(k)
        ir('chave')
      } else {
        await entrar()
      }
    } catch (e) {
      if (descartado(e)) return
      setErro(erroParaTexto(e))
      ir('bloqueio', -1)
    }
  }

  const indice = PASSOS_CRIACAO.indexOf(passo)
  const fraca = (forca?.pontuacao ?? 0) < 3

  return (
    <div className="relative flex h-full items-center justify-center overflow-y-auto bg-bg px-6 py-10">
      <FundoLis />
      <div className="relative w-full max-w-[460px]">
        {indice >= 0 && (
          <div className="mb-6 flex items-center justify-center gap-1.5" aria-label={`Passo ${indice + 1} de ${PASSOS_CRIACAO.length}`}>
            {PASSOS_CRIACAO.map((p, i) => (
              <span key={p} className={cn('h-1.5 rounded-full transition-all duration-300', i === indice ? 'w-6 bg-accent' : i < indice ? 'w-1.5 bg-accent/60' : 'w-1.5 bg-border-strong')} />
            ))}
          </div>
        )}
        <AnimatePresence mode="wait" custom={direcao} initial={false}>
          <motion.div
            key={passo}
            custom={direcao}
            initial={{ opacity: 0, x: 24 * direcao }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 * direcao }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {passo === 'boas-vindas' && (
              <div className="text-center">
                <div className="mb-6 flex justify-center">
                  <Marca tamanho="xl" />
                </div>
                <p className="mx-auto max-w-sm text-[15px] leading-relaxed text-muted">
                  O teu cofre pessoal para senhas, dados bancários, cartões e notas confidenciais — da família <span className="font-semibold text-text">Lis</span>.
                </p>
                <ul className="mx-auto mt-7 grid max-w-sm gap-2.5 text-left">
                  <Ponto icone={<FileLock2 />} titulo="Cifrado neste computador" texto="Argon2id e XChaCha20-Poly1305. O ficheiro do cofre não se lê sem a tua senha." />
                  <Ponto icone={<WifiOff />} titulo="Funciona sem internet" texto="Sem conta online, sem anúncios, sem telemetria, sem sincronização." />
                  <Ponto icone={<KeyRound />} titulo="Só tu tens a chave" texto="Não há senha padrão nem acesso de suporte. Ninguém consegue abrir o cofre por ti." />
                </ul>
                <div className="mt-8 grid gap-2.5">
                  <Botao tamanho="lg" largo icone={<Sparkles />} onClick={() => ir('nome')}>
                    Criar um cofre novo
                  </Botao>
                  <Botao tamanho="lg" largo variante="escuro" icone={<ArchiveRestore />} onClick={() => ir('restaurar')}>
                    Restaurar uma cópia de segurança
                  </Botao>
                </div>
              </div>
            )}

            {passo === 'nome' && (
              <Painel icone={<UserRound />} titulo="Como te chamamos?" texto="Só para a saudação no início. Fica guardado dentro do cofre cifrado, como tudo o resto.">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    ir('senha')
                  }}
                >
                  <Campo rotulo="Nome" opcional value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Ana" maxLength={60} autoFocus />
                  <Navegacao aoVoltar={() => ir('boas-vindas', -1)} />
                </form>
              </Painel>
            )}

            {passo === 'senha' && (
              <Painel icone={<LockKeyhole />} titulo="Define a senha mestra" texto="É a única chave do cofre. Uma frase com 4 ou mais palavras é mais forte e mais fácil de lembrar do que uma senha curta com símbolos.">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if ([...senha].length < MIN) return setErro(`A senha mestra precisa de pelo menos ${MIN} caracteres.`)
                    if (fraca && !aceitarFraca) return setErro('Esta senha parece fácil de adivinhar. Escolhe outra ou confirma que queres usá-la.')
                    ir('confirmar')
                  }}
                >
                  <CampoSenha
                    rotulo="Senha mestra"
                    value={senha}
                    onChange={(e) => {
                      setSenha(e.target.value)
                      setAceitarFraca(false)
                      setErro(null)
                    }}
                    placeholder="Ex.: uma frase só tua, com várias palavras"
                    autoFocus
                    ajuda={`Pelo menos ${MIN} caracteres. Podes colar e usar frases longas — nada é cortado.`}
                  />
                  <MedidorForca forca={forca} className="mt-3" />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const g = await api.gerarFrase({ palavras: 6, separador: '-', maiusculaInicial: false, incluirNumero: false })
                        setSenha(g.valor)
                        avisar('info', 'Frase sugerida. Usa "mostrar" para a ver e decorar.')
                      } catch (e) {
                        if (descartado(e)) return
                      }
                    }}
                    className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] font-medium text-accent hover:text-accent-hover"
                  >
                    <Sparkles className="size-3.5" aria-hidden="true" /> Sugerir uma frase-senha aleatória (6 palavras)
                  </button>
                  {fraca && senha.length >= MIN && forca && (
                    <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[12.5px] text-muted">
                      <input type="checkbox" checked={aceitarFraca} onChange={(e) => setAceitarFraca(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
                      Percebo que esta senha é fraca e quero usá-la na mesma.
                    </label>
                  )}
                  {erro && <p className="mt-3 text-[12.5px] text-danger" role="alert">{erro}</p>}
                  <Navegacao aoVoltar={() => ir('nome', -1)} />
                </form>
              </Painel>
            )}

            {passo === 'confirmar' && (
              <Painel icone={<Check />} titulo="Confirma a senha mestra" texto="Escreve-a outra vez para ter a certeza de que não houve nenhum erro de escrita.">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (confirmacao !== senha) return setErro('As duas senhas não são iguais.')
                    ir('recuperacao')
                  }}
                >
                  <CampoSenha rotulo="Repetir a senha mestra" value={confirmacao} onChange={(e) => (setConfirmacao(e.target.value), setErro(null))} autoFocus />
                  {confirmacao && confirmacao === senha && (
                    <p className="mt-2 flex items-center gap-1.5 text-[12px] text-accent">
                      <Check className="size-3.5" aria-hidden="true" /> As senhas coincidem.
                    </p>
                  )}
                  {erro && <p className="mt-3 text-[12.5px] text-danger" role="alert">{erro}</p>}
                  <Navegacao aoVoltar={() => ir('senha', -1)} />
                </form>
              </Painel>
            )}

            {passo === 'recuperacao' && (
              <Painel icone={<KeyRound />} titulo="Recuperação" texto="Se perderes a senha mestra, o que acontece?">
                <div className="grid gap-2.5">
                  <Opcao
                    ativa={comRecuperacao}
                    aoEscolher={() => setComRecuperacao(true)}
                    titulo="Criar uma chave de recuperação (recomendado)"
                    texto="Uma chave aleatória que também abre o cofre. Vais guardá-la fora do computador (em papel, por exemplo)."
                  />
                  <Opcao
                    ativa={!comRecuperacao}
                    aoEscolher={() => setComRecuperacao(false)}
                    titulo="Sem chave de recuperação"
                    texto="Só a senha mestra abre o cofre. Se a perderes, perdes o acesso a tudo o que está lá dentro."
                  />
                </div>
                {!comRecuperacao && (
                  <Aviso tom="ambar" className="mt-4">
                    Sem chave de recuperação, ninguém — nem tu, nem o criador da app — consegue recuperar o cofre se esqueceres a senha mestra.
                  </Aviso>
                )}
                <Navegacao aoVoltar={() => ir('confirmar', -1)} aoSeguir={() => ir('bloqueio')} />
              </Painel>
            )}

            {passo === 'bloqueio' && (
              <Painel icone={<Timer />} titulo="Bloqueio automático" texto="Depois de quanto tempo sem usar a app o cofre se fecha sozinho? Também bloqueia ao minimizar, ao suspender o computador e ao bloquear o Windows (podes mudar isto nas definições).">
                <div role="radiogroup" aria-label="Minutos até bloquear" className="grid grid-cols-5 gap-2">
                  {[1, 5, 15, 30, 60].map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={minutos === m}
                      onClick={() => setMinutos(m)}
                      className={cn(
                        'toque cursor-pointer rounded-xl border py-3 text-center transition-colors',
                        minutos === m ? 'border-accent/50 bg-accent-soft text-accent' : 'border-border bg-raised text-muted hover:border-border-strong hover:text-text',
                      )}
                    >
                      <span className="block text-[17px] font-extrabold">{m}</span>
                      <span className="text-[10.5px]">min</span>
                    </button>
                  ))}
                </div>
                {erro && (
                  <Aviso tom="vermelho" className="mt-4">
                    {erro}
                  </Aviso>
                )}
                <Navegacao aoVoltar={() => ir('recuperacao', -1)} aoSeguir={criar} textoSeguir="Criar o cofre" />
              </Painel>
            )}

            {passo === 'a-criar' && (
              <Painel icone={<ShieldCheck />} titulo="A criar o teu cofre…" texto="A medir este computador para calibrar a proteção da senha (Argon2id) e a gerar as chaves. Demora alguns segundos.">
                <div className="flex justify-center py-6">
                  <span className="size-10 rounded-full border-2 border-border border-t-accent roda" aria-label="A trabalhar" />
                </div>
              </Painel>
            )}

            {passo === 'chave' && chave && (
              <Painel icone={<KeyRound />} titulo="Guarda a tua chave de recuperação" texto="O cofre está criado. Esta é a única vez que esta chave aparece.">
                <MostrarChaveRecuperacao chave={chave} aoConcluir={() => void entrar()} textoBotao="Entrar no cofre" />
              </Painel>
            )}

            {passo === 'restaurar' && <Restaurar aoVoltar={() => ir('boas-vindas', -1)} aoConcluir={() => void entrar()} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function Ponto({ icone, titulo, texto }: { icone: ReactNode; titulo: string; texto: string }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-card/70 p-3.5 backdrop-blur-sm">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent [&_svg]:size-4">{icone}</span>
      <span>
        <span className="block text-[13.5px] font-semibold text-text">{titulo}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{texto}</span>
      </span>
    </li>
  )
}

function Painel({ icone, titulo, texto, children }: { icone: ReactNode; titulo: string; texto?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/90 p-6 shadow-sobreposicao backdrop-blur-md">
      <div className="mb-5 flex items-start gap-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent-soft text-accent [&_svg]:size-5">{icone}</span>
        <div>
          <h1 className="text-[19px] font-extrabold tracking-tight">{titulo}</h1>
          {texto && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{texto}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

function Navegacao({ aoVoltar, aoSeguir, textoSeguir = 'Continuar' }: { aoVoltar: () => void; aoSeguir?: () => void; textoSeguir?: string }) {
  return (
    <div className="mt-6 flex items-center justify-between gap-3">
      <Botao variante="fantasma" icone={<ArrowLeft />} onClick={aoVoltar}>
        Voltar
      </Botao>
      <Botao type={aoSeguir ? 'button' : 'submit'} onClick={aoSeguir}>
        {textoSeguir} <ArrowRight className="size-4" aria-hidden="true" />
      </Botao>
    </div>
  )
}

function Opcao({ ativa, aoEscolher, titulo, texto }: { ativa: boolean; aoEscolher: () => void; titulo: string; texto: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativa}
      onClick={aoEscolher}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-left transition-colors',
        ativa ? 'border-accent/45 bg-accent-soft/60' : 'border-border bg-raised hover:border-border-strong',
      )}
    >
      <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2', ativa ? 'border-accent' : 'border-border-strong')}>
        {ativa && <span className="size-1.5 rounded-full bg-accent" />}
      </span>
      <span>
        <span className="block text-[13.5px] font-semibold text-text">{titulo}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{texto}</span>
      </span>
    </button>
  )
}

/** Restaurar no primeiro uso: escolher o ficheiro, testar com a senha da altura, restaurar. */
function Restaurar({ aoVoltar, aoConcluir }: { aoVoltar: () => void; aoConcluir: () => void }) {
  const [caminho, setCaminho] = useState<string | null>(null)
  const [senha, setSenha] = useState('')
  const [info, setInfo] = useState<InfoCopia | null>(null)
  const [aTrabalhar, setATrabalhar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)
  const [naNuvem, setNaNuvem] = useState<(CopiaEncontrada & { servico: string })[] | null>(null)
  useEffect(() => {
    if (caminho) campo.current?.focus()
  }, [caminho])

  // num PC novo: procurar cópias na pasta do Google Drive (e OneDrive/Dropbox)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const pastas = await api.pastasNuvem()
        const listas = await Promise.all(pastas.map(async (p) => (await api.listarCopias(p.caminho)).map((c) => ({ ...c, servico: p.servico }))))
        if (vivo) setNaNuvem(listas.flat().sort((a, b) => b.modificado - a.modificado).slice(0, 6))
      } catch {
        if (vivo) setNaNuvem([])
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  const escolher = async () => {
    try {
      const c = await api.escolherCopia()
      if (c) {
        setCaminho(c)
        setInfo(null)
        setErro(null)
      }
    } catch (e) {
      if (descartado(e)) return
      setErro(erroParaTexto(e))
    }
  }

  const testar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!caminho || !senha) return
    setATrabalhar(true)
    setErro(null)
    try {
      setInfo(await api.testarCopia(caminho, senha))
    } catch (err) {
      if (descartado(err)) return
      setErro(err instanceof ErroIpc && err.codigo === 'credencial' ? 'A senha não abre esta cópia. Usa a senha mestra que tinhas quando a cópia foi feita.' : erroParaTexto(err))
    } finally {
      setATrabalhar(false)
    }
  }

  const restaurar = async () => {
    if (!caminho) return
    setATrabalhar(true)
    try {
      await api.restaurarCopia(caminho, senha, null)
      setSenha('')
      aoConcluir()
    } catch (err) {
      if (descartado(err)) return
      setErro(erroParaTexto(err))
      setATrabalhar(false)
    }
  }

  return (
    <Painel icone={<ArchiveRestore />} titulo="Restaurar uma cópia de segurança" texto="Escolhe um ficheiro .lissec criado pelo LisSecurity. Abre com a senha mestra (ou a chave de recuperação) que estava em uso quando a cópia foi feita.">
      {naNuvem && naNuvem.length > 0 && !caminho && (
        <div className="mb-4">
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
            <Cloud className="size-3.5 text-accent" aria-hidden="true" /> Encontrei estas cópias na nuvem
          </p>
          <ul className="space-y-1.5">
            {naNuvem.map((c) => (
              <li key={c.caminho}>
                <button
                  type="button"
                  onClick={() => {
                    setCaminho(c.caminho)
                    setInfo(null)
                    setErro(null)
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-raised px-3.5 py-2.5 text-left transition-colors hover:border-accent/40"
                >
                  <FileLock2 className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-text">{c.nome}</span>
                    <span className="block text-[11px] text-faint">
                      {c.servico} · {data(c.modificado)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Botao variante="escuro" largo onClick={escolher} icone={<FileLock2 />}>
        {caminho ? 'Escolher outro ficheiro' : naNuvem && naNuvem.length > 0 ? 'Escolher outro ficheiro…' : 'Escolher o ficheiro da cópia'}
      </Botao>
      {caminho && <p className="mt-2 truncate text-[11.5px] text-faint" title={caminho}>{caminho}</p>}
      {caminho && !info && (
        <form onSubmit={testar} className="mt-4">
          <CampoSenha ref={campo} rotulo="Senha mestra da cópia" value={senha} onChange={(e) => setSenha(e.target.value)} />
          <Botao type="submit" largo className="mt-4" carregando={aTrabalhar}>
            Verificar a cópia
          </Botao>
        </form>
      )}
      {info && (
        <div className="mt-4 space-y-4">
          <Aviso tom="verde" icone={<Check />}>
            Cópia íntegra de {data(info.gravadoEm)}: {plural(info.total, 'registo', 'registos')} ({info.logins} senhas, {info.bancos} contas, {info.cartoes} cartões, {info.notas} notas).
          </Aviso>
          <Botao largo tamanho="lg" onClick={restaurar} carregando={aTrabalhar}>
            Restaurar e abrir o cofre
          </Botao>
        </div>
      )}
      {erro && (
        <Aviso tom="vermelho" className="mt-4">
          {erro}
        </Aviso>
      )}
      <div className="mt-6">
        <Botao variante="fantasma" icone={<ArrowLeft />} onClick={aoVoltar}>
          Voltar
        </Botao>
      </div>
    </Painel>
  )
}
