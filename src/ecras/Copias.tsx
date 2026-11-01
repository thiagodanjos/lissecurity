import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Cloud,
  CloudOff,
  FileLock2,
  FlaskConical,
  FolderOpen,
  HardDriveDownload,
  Info,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { api, descartado, ErroIpc, ignorarDescartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import type { CopiaCriada, EstadoCopias, InfoCopia, PastaNuvem } from '@/lib/tipos'
import { dataHora, haQuanto, plural } from '@/lib/formatos'
import { cn } from '@/lib/utils'
import { avisar, erroParaTexto } from '@/componentes/avisos'
import { Aviso, Botao, Cartao, CampoSenha, confirmar, Etiqueta, Modal, Selecao, Spinner, TituloSecao } from '@/componentes/ui'

const tamanho = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

/** Cópias de segurança cifradas: automáticas (Google Drive), manuais, testar e restaurar. */
export function Copias() {
  const versao = useSessao((s) => s.versao)
  const [estado, setEstado] = useState<EstadoCopias | null>(null)
  const [criada, setCriada] = useState<CopiaCriada | null>(null)
  const [aCriar, setACriar] = useState(false)
  const [modal, setModal] = useState<{ modo: 'testar' | 'restaurar'; caminho?: string } | null>(null)

  const recarregar = useCallback(() => {
    api
      .estadoCopias()
      .then(setEstado)
      .catch(ignorarDescartado)
      .catch((e) => avisar('erro', erroParaTexto(e)))
  }, [])

  useEffect(recarregar, [recarregar, versao])
  useEffect(() => {
    const desligar = listen('lis://copia', () => recarregar())
    return () => void desligar.then((f) => f())
  }, [recarregar])

  const criarManual = async () => {
    setACriar(true)
    try {
      const r = await api.criarCopia()
      if (r) {
        setCriada(r)
        avisar('sucesso', 'Cópia de segurança criada e verificada.')
        useSessao.getState().mudou()
      }
    } catch (e) {
      if (descartado(e)) return
      avisar('erro', erroParaTexto(e))
    } finally {
      setACriar(false)
    }
  }

  if (!estado)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )

  const ultima = Math.max(estado.ultimaAutomatica ?? 0, estado.ultimaManual ?? 0) || null

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-10 px-8 py-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Cópias de <span className="text-brand-gradient">segurança</span>
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Última cópia: <span className="font-semibold text-text">{ultima ? `${haQuanto(ultima)} (${dataHora(ultima)})` : 'nunca'}</span>
            {estado.config.ativo && <span className="text-faint"> · automáticas ligadas</span>}
          </p>
        </div>

        <Automaticas estado={estado} aoMudar={setEstado} aoAbrir={(caminho, modo) => setModal({ modo, caminho })} />

        <section>
          <TituloSecao>Outras ações</TituloSecao>
          <div className="grid gap-4 md:grid-cols-3">
            <Acao icone={<HardDriveDownload />} titulo="Cópia manual" texto="Para uma pen ou outro disco. O ficheiro sai cifrado e é verificado depois de gravado. As manuais nunca são apagadas automaticamente.">
              <Botao largo variante="escuro" onClick={criarManual} carregando={aCriar} icone={<HardDriveDownload />}>
                Criar cópia manual
              </Botao>
            </Acao>
            <Acao icone={<FlaskConical />} titulo="Testar uma cópia" texto="Abre uma cópia com a senha da altura e conta os registos — sem mexer no cofre atual.">
              <Botao largo variante="escuro" onClick={() => setModal({ modo: 'testar' })}>
                Escolher e testar
              </Botao>
            </Acao>
            <Acao icone={<ArchiveRestore />} titulo="Restaurar" texto="Substitui o cofre atual pelo de uma cópia. O atual fica guardado ao lado, cifrado.">
              <Botao largo variante="escuro" onClick={() => setModal({ modo: 'restaurar' })}>
                Escolher e restaurar
              </Botao>
            </Acao>
          </div>
          {criada && (
            <Aviso tom="verde" icone={<CheckCircle2 />} className="mt-4">
              <p className="font-semibold text-text">{criada.nome}</p>
              <p className="mt-0.5 break-all">
                {criada.caminho} · {tamanho(criada.bytes)} · relida e verificada
              </p>
            </Aviso>
          )}
        </section>

        <section>
          <TituloSecao>Como ficam protegidas</TituloSecao>
          <Cartao className="space-y-3 p-5 text-[13px] leading-relaxed text-muted">
            <p className="flex gap-2.5">
              <FileLock2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              Cada cópia é um ficheiro <span className="mono text-text">.lissec</span> totalmente cifrado (XChaCha20-Poly1305, chave derivada da senha mestra com Argon2id). No Google Drive, a Google só vê um ficheiro ilegível — e só o LisSecurity o sabe abrir.
            </p>
            <p className="flex gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              Se perderes o computador: instala o LisSecurity noutro PC, liga o Google Drive e escolhe <strong className="text-text">Restaurar uma cópia de segurança</strong> no primeiro ecrã. Precisas da senha mestra (ou da chave de recuperação) que estava em uso quando a cópia foi feita.
            </p>
            <p className="flex gap-2.5">
              <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              Quem entrar na tua conta Google fica com o ficheiro cifrado, não com os dados: a proteção passa a ser a força da senha mestra. Usa uma frase-senha longa e a verificação em 2 passos na conta Google.
            </p>
            <p className="flex gap-2.5">
              <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              Eliminar um registo tira-o do cofre, mas não das cópias feitas antes. Não há exportação em texto simples.
            </p>
          </Cartao>
        </section>
      </div>
      <TestarRestaurar pedido={modal} aoFechar={() => setModal(null)} />
    </div>
  )
}

function Acao({ icone, titulo, texto, children }: { icone: React.ReactNode; titulo: string; texto: string; children: React.ReactNode }) {
  return (
    <Cartao className="flex flex-col p-5">
      <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent [&_svg]:size-5">{icone}</span>
      <h2 className="text-[14.5px] font-bold">{titulo}</h2>
      <p className="mb-4 mt-1 flex-1 text-[12.5px] leading-relaxed text-muted">{texto}</p>
      {children}
    </Cartao>
  )
}

/** Cartão principal: cópias automáticas para a pasta do Google Drive (ou outra). */
function Automaticas({ estado, aoMudar, aoAbrir }: { estado: EstadoCopias; aoMudar: (e: EstadoCopias) => void; aoAbrir: (caminho: string, modo: 'testar' | 'restaurar') => void }) {
  const [nuvens, setNuvens] = useState<PastaNuvem[] | null>(null)
  const [pasta, setPasta] = useState(estado.config.pasta)
  const [manter, setManter] = useState(estado.config.manter)
  const [aGuardar, setAGuardar] = useState(false)
  const [aCopiar, setACopiar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    api
      .pastasNuvem()
      .then(setNuvens)
      .catch(ignorarDescartado)
      .catch(() => setNuvens([]))
  }, [])
  useEffect(() => {
    setPasta(estado.config.pasta)
    setManter(estado.config.manter)
  }, [estado.config.pasta, estado.config.manter])

  const aplicar = async (ativo: boolean, novaPasta = pasta, novoManter = manter) => {
    setAGuardar(true)
    setErro(null)
    try {
      const e = await api.configurarCopias(ativo, novaPasta, novoManter)
      aoMudar(e)
      if (ativo) avisar('sucesso', 'Cópias automáticas ligadas. A primeira já foi feita e verificada.')
      useSessao.getState().mudou()
    } catch (e) {
      if (descartado(e)) return
      setErro(erroParaTexto(e))
    } finally {
      setAGuardar(false)
    }
  }

  const escolherPasta = async () => {
    try {
      const p = await api.escolherPasta('Escolhe a pasta das cópias (por exemplo, a do Google Drive)')
      if (p) {
        setPasta(p)
        if (estado.config.ativo) await aplicar(true, p)
      }
    } catch (e) {
      if (descartado(e)) return
      setErro(erroParaTexto(e))
    }
  }

  const copiarAgora = async () => {
    setACopiar(true)
    try {
      await api.fazerCopiaAuto()
      avisar('sucesso', 'Cópia feita e verificada.')
      aoMudar(await api.estadoCopias())
    } catch (e) {
      if (descartado(e)) return
      avisar('erro', erroParaTexto(e))
    } finally {
      setACopiar(false)
    }
  }

  const ligado = estado.config.ativo
  const drive = nuvens?.find((n) => n.servico === 'Google Drive')

  return (
    <section>
      <TituloSecao>Cópias automáticas na nuvem</TituloSecao>
      <Cartao className="overflow-hidden">
        <div className={cn('flex flex-wrap items-center gap-4 border-b border-border/70 p-5', ligado && 'bg-[linear-gradient(100deg,#10241a_0%,transparent_70%)]')}>
          <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', ligado ? 'bg-accent-soft text-accent' : 'bg-raised text-faint')}>
            {ligado ? <Cloud className="size-6" /> : <CloudOff className="size-6" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 text-[15px] font-bold">
              {ligado ? 'Ligadas' : 'Desligadas'}
              {ligado && estado.ultimaAutomatica && <Etiqueta tom="verde">Última {haQuanto(estado.ultimaAutomatica)}</Etiqueta>}
            </h3>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {ligado
                ? 'Depois de cada alteração (com 15 s de folga), é gravada uma cópia cifrada na pasta abaixo. O Google Drive para computador envia-a para a nuvem.'
                : 'Liga para guardar uma cópia cifrada sempre que o cofre muda — numa pasta do Google Drive, fica também na nuvem.'}
            </p>
          </div>
          {ligado && (
            <Botao variante="escuro" tamanho="sm" icone={<RefreshCw />} onClick={copiarAgora} carregando={aCopiar}>
              Copiar agora
            </Botao>
          )}
        </div>

        <div className="space-y-4 p-5">
          {estado.ultimoErro && (
            <Aviso tom="vermelho" icone={<AlertTriangle />}>
              A última cópia automática falhou: {estado.ultimoErro}
            </Aviso>
          )}

          <div>
            <p className="mb-2 text-[12px] font-semibold text-muted">Pasta</p>
            {nuvens === null ? (
              <Spinner />
            ) : nuvens.length > 0 ? (
              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                {nuvens.map((n) => (
                  <button
                    key={n.caminho}
                    type="button"
                    aria-pressed={pasta === n.caminho}
                    onClick={() => {
                      setPasta(n.caminho)
                      if (ligado) void aplicar(true, n.caminho)
                    }}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                      pasta === n.caminho ? 'border-accent/45 bg-accent-soft/60' : 'border-border bg-raised hover:border-border-strong',
                    )}
                  >
                    <Cloud className={cn('size-5 shrink-0', pasta === n.caminho ? 'text-accent' : 'text-faint')} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-text">{n.servico}</span>
                      <span className="mono block truncate text-[11px] text-faint" title={n.caminho}>
                        {n.caminho}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <Aviso tom="neutro" icone={<Info />} className="mb-3">
                Não encontrei a pasta do Google Drive. Instala o <strong className="text-text">Google Drive para computador</strong> (drive.google.com/download), entra com a tua conta e volta aqui — ou escolhe outra pasta.
              </Aviso>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Botao variante="contorno" tamanho="sm" icone={<FolderOpen />} onClick={escolherPasta}>
                Escolher outra pasta…
              </Botao>
              {pasta && (
                <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-faint" title={pasta}>
                  {pasta} <span className="text-faint/70">(subpasta LisSecurity)</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <Selecao
              rotulo="Quantas cópias automáticas manter"
              value={manter}
              onChange={(e) => {
                const n = Number(e.target.value)
                setManter(n)
                if (ligado) void aplicar(true, pasta, n)
              }}
              className="w-56"
            >
              {[5, 10, 15, 30, 60, 100].map((n) => (
                <option key={n} value={n}>
                  As {n} mais recentes
                </option>
              ))}
            </Selecao>
            {ligado ? (
              <Botao variante="fantasma" onClick={() => void aplicar(false)} carregando={aGuardar}>
                Desligar cópias automáticas
              </Botao>
            ) : (
              <Botao icone={<Cloud />} disabled={!pasta} carregando={aGuardar} onClick={() => void aplicar(true)}>
                {drive && pasta === drive.caminho ? 'Ligar ao Google Drive' : 'Ligar cópias automáticas'}
              </Botao>
            )}
          </div>
          {erro && <Aviso tom="vermelho">{erro}</Aviso>}
        </div>

        {estado.copias.length > 0 && (
          <div className="border-t border-border/70">
            <p className="px-5 pb-2 pt-4 text-[10px] font-bold tracking-widest text-faint">CÓPIAS NA PASTA ({estado.copias.length})</p>
            <ul className="max-h-72 divide-y divide-border/50 overflow-y-auto">
              {estado.copias.map((c) => (
                <li key={c.caminho} className="group flex items-center gap-3 px-5 py-2.5">
                  <FileLock2 className="size-4 shrink-0 text-faint" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-text">{c.nome}</span>
                    <span className="block text-[11px] text-faint">
                      {dataHora(c.modificado)} · {tamanho(c.bytes)} · {c.automatica ? 'automática' : 'manual'}
                    </span>
                  </span>
                  <span className="flex gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                    <Botao variante="fantasma" tamanho="sm" onClick={() => aoAbrir(c.caminho, 'testar')}>
                      Testar
                    </Botao>
                    <Botao variante="fantasma" tamanho="sm" onClick={() => aoAbrir(c.caminho, 'restaurar')}>
                      Restaurar
                    </Botao>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Cartao>
    </section>
  )
}

function TestarRestaurar({ pedido, aoFechar }: { pedido: { modo: 'testar' | 'restaurar'; caminho?: string } | null; aoFechar: () => void }) {
  const [caminho, setCaminho] = useState<string | null>(null)
  const [senha, setSenha] = useState('')
  const [atual, setAtual] = useState('')
  const [info, setInfo] = useState<InfoCopia | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aTrabalhar, setATrabalhar] = useState(false)
  const modo = pedido?.modo

  useEffect(() => {
    setCaminho(pedido?.caminho ?? null)
    setInfo(null)
    setErro(null)
  }, [pedido])

  const fechar = () => {
    setSenha('')
    setAtual('')
    setInfo(null)
    setErro(null)
    aoFechar()
  }

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

  const executar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!caminho) return
    setErro(null)
    if (modo === 'restaurar') {
      const ok = await confirmar({
        titulo: 'Substituir o cofre atual?',
        texto: 'Todos os registos atuais são trocados pelos da cópia. O cofre atual fica guardado ao lado, cifrado, como «antes-do-restauro».',
        confirmar: 'Restaurar',
        perigo: true,
      })
      if (!ok) return
    }
    setATrabalhar(true)
    try {
      if (modo === 'testar') {
        setInfo(await api.testarCopia(caminho, senha))
      } else {
        const i = await api.restaurarCopia(caminho, senha, atual)
        setSenha('')
        setAtual('')
        avisar('sucesso', `Cópia restaurada: ${plural(i.total, 'registo', 'registos')}.`)
        fechar()
        useSessao.getState().irPara('inicio')
        useSessao.getState().mudou()
      }
    } catch (err) {
      if (descartado(err)) return
      setErro(err instanceof ErroIpc && err.codigo === 'credencial' ? 'Uma das senhas não está correta. Para a cópia, usa a senha mestra que tinhas quando ela foi feita.' : erroParaTexto(err))
    } finally {
      setATrabalhar(false)
    }
  }

  return (
    <Modal aberto={pedido !== null} aoFechar={fechar} titulo={modo === 'testar' ? 'Testar uma cópia de segurança' : 'Restaurar uma cópia de segurança'} largura="max-w-md" fecharComFundo={false}>
      <div className="space-y-4">
        {caminho ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-raised p-3">
            <FileLock2 className="size-4 shrink-0 text-accent" aria-hidden="true" />
            <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-muted" title={caminho}>
              {caminho.split(/[\\/]/).pop()}
            </span>
            <button type="button" onClick={escolher} className="cursor-pointer text-[11.5px] font-semibold text-accent hover:text-accent-hover">
              Outra
            </button>
          </div>
        ) : (
          <Botao variante="escuro" largo icone={<FileLock2 />} onClick={escolher}>
            Escolher o ficheiro .lissec
          </Botao>
        )}
        <AnimatePresence>
          {caminho && (
            <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} onSubmit={executar} className="space-y-4">
              <CampoSenha rotulo="Senha mestra da cópia" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
              {modo === 'restaurar' && <CampoSenha rotulo="Senha mestra atual (confirmação)" value={atual} onChange={(e) => setAtual(e.target.value)} />}
              {info && (
                <Aviso tom="verde" icone={<CheckCircle2 />}>
                  Cópia íntegra, gravada em {dataHora(info.gravadoEm)}: {plural(info.total, 'registo', 'registos')} — {info.logins} senhas, {info.bancos} contas, {info.cartoes} cartões, {info.notas} notas
                  {info.noLixo ? ` (+${info.noLixo} no lixo)` : ''}.{info.mesmoCofre === false && ' É de um cofre diferente do atual.'}
                </Aviso>
              )}
              {erro && <Aviso tom="vermelho">{erro}</Aviso>}
              <Botao type="submit" largo carregando={aTrabalhar} variante={modo === 'restaurar' ? 'perigo' : 'primario'} disabled={!senha || (modo === 'restaurar' && !atual)}>
                {modo === 'testar' ? 'Testar a cópia' : 'Restaurar esta cópia'}
              </Botao>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}
