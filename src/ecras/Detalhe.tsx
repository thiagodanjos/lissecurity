import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArchiveRestore, ArrowLeft, CopyPlus, History, Link2, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react'
import { api, descartado, ignorarDescartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import type { ItemVista } from '@/lib/tipos'
import { dataHora, estadoValidade, haQuanto, PAISES, TIPOS_CARTAO, TIPOS_CONTA, TIPOS_NOTA, TIPOS_PIX } from '@/lib/formatos'
import { cn } from '@/lib/utils'
import { avisar, erroParaTexto } from '@/componentes/avisos'
import { BotaoCopiar, CampoSegredo, CampoTexto, CartaoVisual, Grupo, IconeRegisto, LinhaCampo } from '@/componentes/registo'
import { CodigoDoisPassos } from '@/componentes/totp'
import { AcaoLinha, Botao, BotaoIcone, confirmar, Etiqueta, Spinner } from '@/componentes/ui'

/** Painel de detalhe de um registo. Recebe só a vista mascarada; os segredos chegam um a um. */
export function Detalhe({ id, aoFechar, aoMudar }: { id: string; aoFechar?: () => void; aoMudar: () => void }) {
  const versao = useSessao((s) => s.versao)
  const [item, setItem] = useState<ItemVista | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setErro(null)
    api
      .obterItem(id)
      .then((i) => vivo && setItem(i))
      .catch(ignorarDescartado)
      .catch((e) => vivo && setErro(erroParaTexto(e)))
    return () => {
      vivo = false
    }
  }, [id, versao])

  if (erro) return <p className="p-8 text-center text-[13px] text-muted">{erro}</p>
  if (!item || item.id !== id)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )

  const c = item.conteudo
  const noLixo = item.eliminadoEm !== null
  const executar = async (f: () => Promise<unknown>, ok: string) => {
    try {
      await f()
      avisar('sucesso', ok)
      aoMudar()
    } catch (e) {
      if (descartado(e)) return
      avisar('erro', erroParaTexto(e))
    }
  }

  const subtitulo =
    c.tipo === 'login'
      ? c.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
      : c.tipo === 'banco'
        ? [c.banco, PAISES.find((p) => p.codigo === c.pais)?.nome].filter(Boolean).join(' · ')
        : c.tipo === 'cartao'
          ? [c.instituicao, TIPOS_CARTAO[c.tipoCartao]].filter(Boolean).join(' · ')
          : TIPOS_NOTA[c.tipoNota] ?? 'Nota'

  return (
    <motion.div key={id} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="mx-auto max-w-2xl px-6 py-6">
      {/* cabeçalho */}
      <div className="mb-6 flex items-start gap-4">
        {aoFechar && (
          <BotaoIcone rotulo="Voltar à lista" tamanho="sm" onClick={aoFechar} className="mt-1">
            <ArrowLeft />
          </BotaoIcone>
        )}
        <IconeRegisto tipo={c.tipo} titulo={item.titulo} dominio={c.tipo === 'login' ? c.url.replace(/^https?:\/\//, '') : undefined} tamanho="lg" />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="selecionavel text-[20px] font-extrabold leading-tight tracking-tight [overflow-wrap:anywhere]">{item.titulo}</h2>
          {subtitulo && <p className="mt-1 truncate text-[12.5px] text-muted">{subtitulo}</p>}
          {(item.categoria || item.etiquetas.length > 0) && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {item.categoria && <Etiqueta tom="verde">{item.categoria}</Etiqueta>}
              {item.etiquetas.map((e) => (
                <Etiqueta key={e}>#{e}</Etiqueta>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {noLixo ? (
            <>
              <Botao variante="escuro" tamanho="sm" icone={<ArchiveRestore />} onClick={() => executar(() => api.restaurarItem(id), 'Registo restaurado.')}>
                Restaurar
              </Botao>
              <BotaoIcone
                rotulo="Eliminar de vez"
                tamanho="sm"
                onClick={async () => {
                  const ok = await confirmar({
                    titulo: 'Eliminar de vez?',
                    texto: 'O registo sai do cofre. As cópias de segurança feitas antes continuam a tê-lo — para o fazer desaparecer de todo, apaga também essas cópias.',
                    confirmar: 'Eliminar de vez',
                    perigo: true,
                  })
                  if (ok) await executar(() => api.eliminarItem(id), 'Registo eliminado.')
                }}
              >
                <Trash2 />
              </BotaoIcone>
            </>
          ) : (
            <>
              <BotaoIcone
                rotulo={item.favorito ? 'Tirar dos favoritos' : 'Marcar como favorito'}
                tamanho="sm"
                ativo={item.favorito}
                onClick={() => executar(() => api.alternarFavorito(id), item.favorito ? 'Tirado dos favoritos.' : 'Marcado como favorito.')}
              >
                <Star className={cn(item.favorito && 'fill-current')} />
              </BotaoIcone>
              <Botao tamanho="sm" icone={<Pencil />} onClick={() => useSessao.getState().abrirEditor({ tipo: c.tipo, id })}>
                Editar
              </Botao>
              <MenuMais
                acoes={[
                  { rotulo: 'Duplicar', icone: <CopyPlus />, aoClicar: () => executar(() => api.duplicarItem(id), 'Registo duplicado.') },
                  {
                    rotulo: 'Mover para o lixo',
                    icone: <Trash2 />,
                    perigo: true,
                    aoClicar: async () => {
                      const ok = await confirmar({ titulo: 'Mover para o lixo?', texto: 'Podes restaurá-lo a partir do filtro «Lixo» enquanto lá estiver.', confirmar: 'Mover para o lixo', perigo: true })
                      if (ok) await executar(() => api.moverParaLixo(id), 'Movido para o lixo.')
                    },
                  },
                ]}
              />
            </>
          )}
        </div>
      </div>

      {noLixo && (
        <p className="mb-4 rounded-xl border border-warn/25 bg-warn-soft/60 px-3.5 py-2.5 text-[12.5px] text-[#f7c97a]">Este registo está no lixo desde {dataHora(item.eliminadoEm!)}.</p>
      )}

      <div className="space-y-4">
        {c.tipo === 'login' && (
          <>
            <Grupo titulo="Acesso">
              <CampoTexto id={id} campo="utilizador" rotulo="Utilizador" valor={c.utilizador} />
              <CampoTexto id={id} campo="email" rotulo="E-mail" valor={c.email} />
              <CampoSegredo id={id} campo="senha" rotulo="Senha" mascarado={c.senha} />
              {c.totp?.definido && <CodigoDoisPassos id={id} />}
              <CampoTexto id={id} campo="url" rotulo="Endereço" valor={c.url} abrir={() => api.abrirEndereco(id).catch((e) => void (descartado(e) || avisar('erro', erroParaTexto(e))))} />
            </Grupo>
            {c.senhaAlteradaEm && <p className="px-1 text-[11.5px] text-faint">Senha alterada {haQuanto(c.senhaAlteradaEm)}.</p>}
            {c.historico.length > 0 && <HistoricoSenhas id={id} historico={c.historico} aoMudar={aoMudar} />}
          </>
        )}

        {c.tipo === 'banco' && (
          <>
            <Grupo titulo="Conta">
              <CampoTexto id={id} campo="banco" rotulo="Banco" valor={c.banco} />
              <CampoTexto id={id} campo="titular" rotulo="Titular" valor={c.titular} />
              <CampoSegredo id={id} campo="iban" rotulo="IBAN" mascarado={c.iban} formato="agrupar" />
              <CampoTexto id={id} campo="bic" rotulo="BIC / SWIFT" valor={c.bic} />
              <CampoTexto id={id} campo="agencia" rotulo={c.pais === 'US' ? 'Routing number (ABA)' : 'Agência'} valor={c.agencia} />
              <CampoSegredo id={id} campo="numeroConta" rotulo="Número da conta" mascarado={c.numeroConta} />
              {(c.tipoConta || c.moeda) && (
                <LinhaCampo rotulo="Tipo e moeda">
                  {[TIPOS_CONTA[c.tipoConta], c.moeda].filter(Boolean).join(' · ')}
                </LinhaCampo>
              )}
            </Grupo>
            {c.chavesPix.length > 0 && (
              <Grupo titulo="Chaves Pix">
                {c.chavesPix.map((p, i) => (
                  <CampoSegredo key={i} id={id} campo={`pix:${i}`} rotulo={TIPOS_PIX[p.tipo] ?? 'Chave'} mascarado={p.valor} />
                ))}
              </Grupo>
            )}
            {(c.idAcesso.definido || c.credencialLigada) && (
              <Grupo titulo="Acesso ao banco">
                <CampoSegredo id={id} campo="idAcesso" rotulo="Identificador de acesso" mascarado={c.idAcesso} />
                {c.credencialLigada && <Ligacao rotulo="Credencial no cofre" ligado={c.credencialLigada} />}
              </Grupo>
            )}
            <p className="px-1 text-[11.5px] leading-relaxed text-faint">O LisSecurity só guarda informação: não faz pagamentos, transferências nem consultas ao banco.</p>
          </>
        )}

        {c.tipo === 'cartao' && (
          <>
            <div className="mx-auto max-w-[360px]">
              <CartaoVisual resumo={{ titulo: item.titulo, fim: c.numero.fim, bandeira: c.bandeira, validade: c.validade, instituicao: c.instituicao, tipoDetalhe: c.tipoCartao }} />
            </div>
            <Grupo titulo="Cartão">
              <CampoSegredo id={id} campo="numero" rotulo="Número" mascarado={c.numero} formato="agrupar" />
              {c.validade && (
                <LinhaCampo
                  rotulo="Validade"
                  acoes={<BotaoCopiar rotulo="Copiar validade" copiar={() => api.copiarCampo(id, 'validade')} />}
                >
                  <span className="mono">{c.validade}</span>
                  {estadoValidade(c.validade) === 'expirado' && <Etiqueta tom="vermelho" className="ml-2">Expirado</Etiqueta>}
                  {estadoValidade(c.validade) === 'a-expirar' && <Etiqueta tom="ambar" className="ml-2">Expira em breve</Etiqueta>}
                </LinhaCampo>
              )}
              <CampoTexto id={id} campo="titular" rotulo="Titular" valor={c.titular} />
              {(c.bandeira || c.tipoCartao) && <LinhaCampo rotulo="Bandeira e tipo">{[c.bandeira, TIPOS_CARTAO[c.tipoCartao]].filter(Boolean).join(' · ')}</LinhaCampo>}
              {c.contaLigada && <Ligacao rotulo="Conta associada" ligado={c.contaLigada} />}
            </Grupo>
            <p className="px-1 text-[11.5px] leading-relaxed text-faint">A validação do número só confirma a estrutura; não diz se o cartão está ativo.</p>
          </>
        )}

        {c.tipo === 'nota' && (
          <>
            {c.conteudo.definido && (
              <Grupo>
                <CampoSegredo id={id} campo="conteudo" rotulo={c.tipoNota === 'licenca' ? 'Chave de licença' : 'Conteúdo'} mascarado={c.conteudo} multilinha={c.tipoNota !== 'licenca'} />
              </Grupo>
            )}
            {c.codigos.length > 0 && <Codigos id={id} codigos={c.codigos} aoMudar={aoMudar} noLixo={noLixo} />}
          </>
        )}

        {item.notas.definido && (
          <Grupo>
            <CampoSegredo id={id} campo="notas" rotulo="Notas privadas" mascarado={item.notas} multilinha />
          </Grupo>
        )}

        {item.campos.length > 0 && (
          <Grupo titulo="Campos personalizados">
            {item.campos.map((f) =>
              f.oculto ? (
                <CampoSegredo key={f.id} id={id} campo={`campo:${f.id}`} rotulo={f.rotulo || 'Campo'} mascarado={f.valor} />
              ) : (
                <CampoTexto key={f.id} id={id} campo={`campo:${f.id}`} rotulo={f.rotulo || 'Campo'} valor={f.valor.texto ?? ''} />
              ),
            )}
          </Grupo>
        )}

        <p className="px-1 pt-2 text-[11px] text-faint">
          Criado em {dataHora(item.criadoEm)} · alterado {haQuanto(item.alteradoEm)}
        </p>
      </div>
    </motion.div>
  )
}

function Ligacao({ rotulo, ligado }: { rotulo: string; ligado: { id: string; titulo: string; tipo: 'login' | 'banco' | 'cartao' | 'nota' } }) {
  return (
    <LinhaCampo
      rotulo={rotulo}
      acoes={
        <AcaoLinha rotulo={`Abrir ${ligado.titulo}`} onClick={() => useSessao.getState().abrirRegisto(ligado.tipo, ligado.id)}>
          <Link2 />
        </AcaoLinha>
      }
    >
      <button type="button" onClick={() => useSessao.getState().abrirRegisto(ligado.tipo, ligado.id)} className="cursor-pointer truncate text-accent hover:underline">
        {ligado.titulo}
      </button>
    </LinhaCampo>
  )
}

function HistoricoSenhas({ id, historico, aoMudar }: { id: string; historico: { substituidaEm: number }[]; aoMudar: () => void }) {
  const [aberto, setAberto] = useState(false)
  return (
    <Grupo>
      <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto} className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left text-[13px] text-muted hover:text-text">
        <History className="size-4" aria-hidden="true" />
        <span className="flex-1">Senhas anteriores ({historico.length})</span>
        <span className="text-[11px] text-faint">{aberto ? 'ocultar' : 'mostrar'}</span>
      </button>
      <AnimatePresence initial={false}>
        {aberto && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="divide-y divide-border/60 border-t border-border/60">
              {historico.map((h, i) => (
                <CampoSegredo key={i} id={id} campo={`historico:${i}`} rotulo={`Substituída ${haQuanto(h.substituidaEm)}`} mascarado={{ definido: true }} />
              ))}
              <div className="px-4 py-2.5">
                <button
                  type="button"
                  className="cursor-pointer text-[12px] text-faint hover:text-danger"
                  onClick={async () => {
                    const ok = await confirmar({ titulo: 'Limpar o histórico?', texto: 'As senhas anteriores deste registo deixam de estar no cofre.', confirmar: 'Limpar histórico', perigo: true })
                    if (!ok) return
                    try {
                      await api.limparHistorico(id)
                      avisar('sucesso', 'Histórico limpo.')
                      aoMudar()
                    } catch (e) {
                      if (descartado(e)) return
                      avisar('erro', erroParaTexto(e))
                    }
                  }}
                >
                  Limpar o histórico de senhas
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Grupo>
  )
}

function Codigos({ id, codigos, aoMudar, noLixo }: { id: string; codigos: { usado: boolean; valor: { definido: boolean } }[]; aoMudar: () => void; noLixo: boolean }) {
  const porUsar = codigos.filter((c) => !c.usado).length
  return (
    <Grupo titulo={`Códigos de recuperação · ${porUsar} por usar`}>
      {codigos.map((c, i) => (
        <div key={i} className={cn('flex items-center', c.usado && 'opacity-55')}>
          <label className="flex cursor-pointer items-center pl-4" title={c.usado ? 'Marcar como por usar' : 'Marcar como usado'}>
            <input
              type="checkbox"
              checked={c.usado}
              disabled={noLixo}
              aria-label={`Código ${i + 1} ${c.usado ? 'usado' : 'por usar'}`}
              className="size-4 cursor-pointer accent-[var(--color-accent)]"
              onChange={async (e) => {
                try {
                  await api.marcarCodigo(id, i, e.target.checked)
                  aoMudar()
                } catch (err) {
                  if (descartado(err)) return
                  avisar('erro', erroParaTexto(err))
                }
              }}
            />
          </label>
          <div className="min-w-0 flex-1">
            <CampoSegredo id={id} campo={`codigo:${i}`} rotulo={`Código ${i + 1}${c.usado ? ' · usado' : ''}`} mascarado={c.valor} />
          </div>
        </div>
      ))}
    </Grupo>
  )
}

function MenuMais({ acoes }: { acoes: { rotulo: string; icone: React.ReactNode; aoClicar: () => void; perigo?: boolean }[] }) {
  const [aberto, setAberto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => !raiz.current?.contains(e.target as Node) && setAberto(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false)
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto])
  return (
    <div ref={raiz} className="relative">
      <BotaoIcone rotulo="Mais ações" tamanho="sm" aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
        <MoreHorizontal />
      </BotaoIcone>
      <AnimatePresence>
        {aberto && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full z-30 mt-1.5 min-w-48 rounded-xl border border-border bg-card p-1.5 shadow-card"
          >
            {acoes.map((a) => (
              <button
                key={a.rotulo}
                type="button"
                role="menuitem"
                onClick={() => {
                  setAberto(false)
                  a.aoClicar()
                }}
                className={cn('flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/10 [&_svg]:size-4', a.perigo ? 'text-danger' : 'text-text')}
              >
                {a.icone}
                {a.rotulo}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
