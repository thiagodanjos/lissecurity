import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, CalendarClock, Check, CreditCard, KeyRound, LockKeyhole, Repeat2, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { api, ErroIpc, descartado, ignorarDescartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import type { Relatorio, Resumo } from '@/lib/tipos'
import { plural } from '@/lib/formatos'
import { cn } from '@/lib/utils'
import { avisar, erroParaTexto } from '@/componentes/avisos'
import { MedidorForca, ROTULOS_FORCA, textoCorForca, useForca } from '@/componentes/forca'
import { MostrarChaveRecuperacao } from '@/componentes/chave-recuperacao'
import { IconeRegisto } from '@/componentes/registo'
import { Aviso, Botao, Cartao, CampoSenha, Etiqueta, Modal, Spinner, TituloSecao } from '@/componentes/ui'

export function Seguranca() {
  const versao = useSessao((s) => s.versao)
  const [r, setR] = useState<Relatorio | null>(null)
  const [modal, setModal] = useState<'senha' | 'ativar' | 'desativar' | null>(null)

  useEffect(() => {
    let vivo = true
    api
      .relatorioSeguranca()
      .then((x) => vivo && setR(x))
      .catch(ignorarDescartado)
      .catch((e) => avisar('erro', erroParaTexto(e)))
    return () => {
      vivo = false
    }
  }, [versao])

  if (!r)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )

  const reutilizadas = r.reutilizadas.reduce((n, g) => n + g.length, 0)
  const resumo = [
    { rotulo: 'Senhas fracas', valor: r.fracas.length, icone: <AlertTriangle /> },
    { rotulo: 'Senhas reutilizadas', valor: r.reutilizadas.length, detalhe: reutilizadas ? `em ${reutilizadas} registos` : undefined, icone: <Repeat2 /> },
    { rotulo: 'Sem mudar há +1 ano', valor: r.antigas.length, icone: <CalendarClock /> },
    { rotulo: 'Cartões a rever', valor: r.cartoesExpirados.length + r.cartoesAExpirar.length, icone: <CreditCard /> },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-10 px-8 py-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="text-brand-gradient">Segurança</span> do cofre
          </h1>
          <p className="mt-1.5 text-sm text-muted">Factos verificáveis sobre o que está guardado — sem pontuações inventadas. Tudo calculado neste computador.</p>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {resumo.map((c, i) => (
              <motion.div key={c.rotulo} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 * i }}>
                <Cartao className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn('rounded-xl p-2.5 [&_svg]:size-[18px]', c.valor > 0 ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent')}>{c.valor > 0 ? c.icone : <Check />}</div>
                    <div className="min-w-0">
                      <p className="text-xl font-extrabold leading-none tabular-nums">{c.valor}</p>
                      <p className="mt-1 truncate text-[11px] text-muted">
                        {c.rotulo}
                        {c.detalhe && <span className="text-faint"> · {c.detalhe}</span>}
                      </p>
                    </div>
                  </div>
                </Cartao>
              </motion.div>
            ))}
          </div>
        </div>

        {r.fracas.length > 0 && (
          <Lista titulo="Senhas fracas" texto="Pontuação estimada pelo zxcvbn (0–4). Troca primeiro as dos serviços mais importantes (e-mail, banco).">
            {r.fracas.map(([x, p]) => (
              <Linha key={x.id} r={x} lado={<span className={cn('text-[12px] font-semibold', textoCorForca(p))}>{ROTULOS_FORCA[p]}</span>} />
            ))}
          </Lista>
        )}

        {r.reutilizadas.length > 0 && (
          <Lista titulo="Senhas reutilizadas" texto="Se um destes serviços for comprometido, os outros com a mesma senha também ficam expostos.">
            {r.reutilizadas.map((g, i) => (
              <div key={i} className="px-4 py-3">
                <p className="mb-2 text-[11px] font-bold tracking-wide text-faint">MESMA SENHA EM {g.length} REGISTOS</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.map((x) => (
                    <button key={x.id} type="button" onClick={() => useSessao.getState().abrirRegisto(x.tipo, x.id)} className="cursor-pointer">
                      <Etiqueta className="hover:border-accent/40 hover:text-accent">{x.titulo}</Etiqueta>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </Lista>
        )}

        {r.antigas.length > 0 && (
          <Lista titulo="Senhas antigas" texto="Sem alteração há mais de um ano. Não é obrigatório mudar — mas vale a pena rever as mais importantes.">
            {r.antigas.map((x) => (
              <Linha key={x.id} r={x} />
            ))}
          </Lista>
        )}

        {(r.cartoesExpirados.length > 0 || r.cartoesAExpirar.length > 0) && (
          <Lista titulo="Cartões">
            {r.cartoesExpirados.map((x) => (
              <Linha key={x.id} r={x} lado={<Etiqueta tom="vermelho">Expirado</Etiqueta>} />
            ))}
            {r.cartoesAExpirar.map((x) => (
              <Linha key={x.id} r={x} lado={<Etiqueta tom="ambar">Expira em breve</Etiqueta>} />
            ))}
          </Lista>
        )}

        {/* proteção do cofre */}
        <section>
          <TituloSecao>Proteção do cofre</TituloSecao>
          <div className="grid gap-4 md:grid-cols-2">
            <Cartao className="p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <LockKeyhole className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] font-bold">Senha mestra</h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                    Derivada com Argon2id ({r.kdfMemoriaMib} MiB, {plural(r.kdfIteracoes, 'iteração', 'iterações')}), calibrado para este computador.
                  </p>
                  <Botao variante="contorno" tamanho="sm" className="mt-3.5" onClick={() => setModal('senha')}>
                    Alterar senha mestra
                  </Botao>
                </div>
              </div>
            </Cartao>
            <Cartao className="p-5">
              <div className="flex items-start gap-3">
                <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', r.temRecuperacao ? 'bg-accent-soft text-accent' : 'bg-warn-soft text-warn')}>
                  <KeyRound className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center gap-2 text-[14px] font-bold">
                    Chave de recuperação {r.temRecuperacao ? <Etiqueta tom="verde">Ativa</Etiqueta> : <Etiqueta tom="ambar">Desativada</Etiqueta>}
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                    {r.temRecuperacao
                      ? 'Abre o cofre se perderes a senha mestra. Quem a tiver também consegue abri-lo.'
                      : 'Sem ela, perder a senha mestra significa perder o acesso ao cofre.'}
                  </p>
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    <Botao variante="contorno" tamanho="sm" onClick={() => setModal('ativar')}>
                      {r.temRecuperacao ? 'Gerar uma chave nova' : 'Criar chave de recuperação'}
                    </Botao>
                    {r.temRecuperacao && (
                      <Botao variante="fantasma" tamanho="sm" onClick={() => setModal('desativar')}>
                        Desativar
                      </Botao>
                    )}
                  </div>
                </div>
              </div>
            </Cartao>
          </div>
        </section>

        {/* limites, sem promessas */}
        <section>
          <TituloSecao>O que o LisSecurity protege — e o que não protege</TituloSecao>
          <div className="grid gap-4 md:grid-cols-2">
            <Cartao className="p-5">
              <h3 className="mb-3 flex items-center gap-2 text-[13.5px] font-bold text-accent">
                <ShieldCheck className="size-4" /> Protege
              </h3>
              <ul className="space-y-2 text-[12.5px] leading-relaxed text-muted">
                <li>Cópia ou roubo do ficheiro do cofre e das cópias de segurança: sem a senha, só se vê texto cifrado.</li>
                <li>Alterações ao ficheiro: qualquer byte mexido é detetado e o cofre não abre com dados adulterados.</li>
                <li>Acesso casual ao computador: bloqueio automático, ao minimizar, ao suspender e com o Windows.</li>
                <li>Fugas acidentais: nada de segredos em registos, temporários, títulos de janela ou notificações.</li>
              </ul>
            </Cartao>
            <Cartao className="p-5">
              <h3 className="mb-3 flex items-center gap-2 text-[13.5px] font-bold text-warn">
                <ShieldAlert className="size-4" /> Não consegue proteger
              </h3>
              <ul className="space-y-2 text-[12.5px] leading-relaxed text-muted">
                <li>Um computador com malware ou um registador de teclas: pode ver a senha mestra enquanto a escreves.</li>
                <li>Uma sessão já desbloqueada: quem estiver ao teclado vê o que tu verias.</li>
                <li>Outros programas podem ler a área de transferência antes de ela ser limpa.</li>
                <li>Uma senha mestra fraca ou reutilizada noutro sítio.</li>
              </ul>
            </Cartao>
          </div>
          <Aviso tom="neutro" icone={<ShieldX />} className="mt-4">
            Nenhum software é «impossível de piratear». Esta é uma primeira versão funcional, testada automaticamente, mas ainda sem revisão de segurança independente.
          </Aviso>
        </section>
      </div>

      <AlterarSenha aberto={modal === 'senha'} aoFechar={() => setModal(null)} />
      <Recuperacao modo={modal === 'ativar' ? 'ativar' : modal === 'desativar' ? 'desativar' : null} aoFechar={() => setModal(null)} />
    </div>
  )
}

function Lista({ titulo, texto, children }: { titulo: string; texto?: string; children: ReactNode }) {
  return (
    <section>
      <TituloSecao>{titulo}</TituloSecao>
      {texto && <p className="-mt-1.5 mb-3 text-[12.5px] text-muted">{texto}</p>}
      <Cartao className="divide-y divide-border/60 overflow-hidden">{children}</Cartao>
    </section>
  )
}

function Linha({ r, lado }: { r: Resumo; lado?: ReactNode }) {
  return (
    <button type="button" onClick={() => useSessao.getState().abrirRegisto(r.tipo, r.id)} className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-card-hover">
      <IconeRegisto tipo={r.tipo} titulo={r.titulo} dominio={r.dominio} tamanho="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{r.titulo}</span>
        {r.subtitulo && <span className="block truncate text-[11.5px] text-muted">{r.subtitulo}</span>}
      </span>
      {lado}
    </button>
  )
}

/** Troca da senha mestra: transacional na camada nativa (grava, verifica e só depois troca). */
export function AlterarSenha({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aGuardar, setAGuardar] = useState(false)
  const [chave, setChave] = useState<string | null>(null)
  const forca = useForca(nova)
  const limpar = () => {
    setAtual('')
    setNova('')
    setConfirmacao('')
    setErro(null)
    setChave(null)
  }
  const fechar = () => {
    limpar()
    aoFechar()
  }
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    if ([...nova].length < 12) return setErro('A senha mestra nova precisa de pelo menos 12 caracteres.')
    if (nova !== confirmacao) return setErro('A senha nova e a confirmação não são iguais.')
    setAGuardar(true)
    setErro(null)
    try {
      const k = await api.alterarSenha(atual, nova)
      setAtual('')
      setNova('')
      setConfirmacao('')
      avisar('sucesso', 'Senha mestra alterada.')
      if (k) setChave(k)
      else fechar()
      useSessao.getState().mudou()
    } catch (err) {
      if (descartado(err)) return
      setErro(err instanceof ErroIpc && err.codigo === 'credencial' ? 'A senha mestra atual não está correta.' : erroParaTexto(err))
    } finally {
      setAGuardar(false)
    }
  }
  return (
    <Modal aberto={aberto} aoFechar={fechar} titulo={chave ? 'Nova chave de recuperação' : 'Alterar a senha mestra'} descricao={chave ? 'A chave antiga deixou de abrir este cofre (continua a abrir as cópias antigas).' : undefined} largura="max-w-md" fecharComFundo={false}>
      {chave ? (
        <MostrarChaveRecuperacao chave={chave} aoConcluir={fechar} textoBotao="Concluir" />
      ) : (
        <form onSubmit={guardar} className="space-y-4">
          <CampoSenha rotulo="Senha mestra atual" value={atual} onChange={(e) => setAtual(e.target.value)} autoFocus />
          <CampoSenha rotulo="Senha mestra nova" value={nova} onChange={(e) => setNova(e.target.value)} />
          <MedidorForca forca={forca} />
          <CampoSenha rotulo="Repetir a senha nova" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
          <Aviso tom="neutro">
            O cofre é cifrado de novo com uma chave nova. As cópias de segurança já feitas continuam a abrir com a senha antiga — faz uma cópia nova depois e apaga as antigas se a senha antiga foi exposta.
          </Aviso>
          {erro && <Aviso tom="vermelho">{erro}</Aviso>}
          <div className="flex justify-end gap-2">
            <Botao variante="fantasma" onClick={fechar}>
              Cancelar
            </Botao>
            <Botao type="submit" carregando={aGuardar}>
              Alterar senha
            </Botao>
          </div>
        </form>
      )}
    </Modal>
  )
}

function Recuperacao({ modo, aoFechar }: { modo: 'ativar' | 'desativar' | null; aoFechar: () => void }) {
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aTrabalhar, setATrabalhar] = useState(false)
  const [chave, setChave] = useState<string | null>(null)
  const fechar = () => {
    setSenha('')
    setErro(null)
    setChave(null)
    aoFechar()
  }
  const executar = async (e: React.FormEvent) => {
    e.preventDefault()
    setATrabalhar(true)
    setErro(null)
    try {
      if (modo === 'ativar') {
        setChave(await api.ativarRecuperacao(senha))
      } else {
        await api.desativarRecuperacao(senha)
        avisar('sucesso', 'Chave de recuperação desativada.')
        fechar()
      }
      setSenha('')
      useSessao.getState().mudou()
    } catch (err) {
      if (descartado(err)) return
      setErro(err instanceof ErroIpc && err.codigo === 'credencial' ? 'A senha mestra não está correta.' : erroParaTexto(err))
    } finally {
      setATrabalhar(false)
    }
  }
  return (
    <Modal aberto={modo !== null} aoFechar={fechar} titulo={chave ? 'Guarda a chave de recuperação' : modo === 'ativar' ? 'Chave de recuperação' : 'Desativar a recuperação'} largura="max-w-md" fecharComFundo={false}>
      {chave ? (
        <MostrarChaveRecuperacao chave={chave} aoConcluir={fechar} textoBotao="Concluir" />
      ) : (
        <form onSubmit={executar} className="space-y-4">
          <p className="text-[13px] leading-relaxed text-muted">
            {modo === 'ativar'
              ? 'É gerada uma chave aleatória nova (e uma chave do cofre nova). Se já havia uma chave de recuperação, deixa de abrir este cofre.'
              : 'Depois disto, só a senha mestra abre o cofre. As cópias de segurança antigas continuam a abrir com a chave de recuperação da altura.'}
          </p>
          <CampoSenha rotulo="Confirma com a senha mestra" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
          {erro && <Aviso tom="vermelho">{erro}</Aviso>}
          <div className="flex justify-end gap-2">
            <Botao variante="fantasma" onClick={fechar}>
              Cancelar
            </Botao>
            <Botao type="submit" variante={modo === 'desativar' ? 'perigo' : 'primario'} carregando={aTrabalhar} disabled={!senha}>
              {modo === 'ativar' ? 'Gerar chave' : 'Desativar'}
            </Botao>
          </div>
        </form>
      )}
    </Modal>
  )
}
