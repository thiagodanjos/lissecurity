import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Eye, EyeOff, Plus, Star, Trash2, WandSparkles } from 'lucide-react'
import { api, descartado, ignorarDescartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import type { Banco, CampoPersonalizado, Cartao, Conteudo, Item, Login, Nota, Resumo, TipoItem } from '@/lib/tipos'
import {
  BANDEIRAS,
  detetarBandeira,
  formatarValidade,
  MOEDAS,
  PAISES,
  TIPOS_CARTAO,
  TIPOS_CONTA,
  TIPOS_NOTA,
  TIPOS_PIX,
  validarBic,
  validarIban,
  validarNumeroCartao,
  validarPix,
  validarValidade,
} from '@/lib/formatos'
import { cn } from '@/lib/utils'
import { avisar, erroParaTexto } from '@/componentes/avisos'
import { MedidorForca, useForca } from '@/componentes/forca'
import { AcaoLinha, AreaTexto, Aviso, Botao, Campo, CampoSenha, confirmar, Modal, Segmentado, Selecao, Spinner } from '@/componentes/ui'

const NOMES: Record<TipoItem, { novo: string; editar: string }> = {
  login: { novo: 'Nova senha', editar: 'Editar senha' },
  banco: { novo: 'Nova conta bancária', editar: 'Editar conta bancária' },
  cartao: { novo: 'Novo cartão', editar: 'Editar cartão' },
  nota: { novo: 'Nova nota segura', editar: 'Editar nota segura' },
}

function conteudoVazio(tipo: TipoItem, senha = ''): Conteudo {
  switch (tipo) {
    case 'login':
      return { tipo, url: '', utilizador: '', email: '', senha, senhaAlteradaEm: null, historico: [], totp: '' }
    case 'banco':
      return { tipo, banco: '', titular: '', pais: 'PT', moeda: 'EUR', tipoConta: 'corrente', agencia: '', numeroConta: '', iban: '', bic: '', chavesPix: [], idAcesso: '', credencialLigada: null }
    case 'cartao':
      return { tipo, instituicao: '', bandeira: '', titular: '', numero: '', validade: '', tipoCartao: 'credito', contaLigada: null }
    case 'nota':
      return { tipo, tipoNota: 'nota', conteudo: '', codigos: [] }
  }
}

function itemVazio(tipo: TipoItem, senha?: string): Item {
  return { id: '', titulo: '', favorito: false, categoria: '', etiquetas: [], notas: '', campos: [], criadoEm: 0, alteradoEm: 0, eliminadoEm: null, conteudo: conteudoVazio(tipo, senha) }
}

const OPCOES_GERAR = { comprimento: 20, maiusculas: true, minusculas: true, numeros: true, simbolos: true, evitarSemelhantes: true }

/** Editor de registos. O registo completo só existe aqui enquanto o formulário está aberto. */
export function Editor() {
  const pedido = useSessao((s) => s.editor)
  const { fecharEditor, mudou, abrirRegisto } = useSessao.getState()
  const [item, setItem] = useState<Item | null>(null)
  const [original, setOriginal] = useState<string>('')
  const [aGuardar, setAGuardar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    setErro(null)
    if (!pedido) {
      setItem(null)
      setOriginal('')
      return
    }
    if (!pedido.id) {
      const novo = itemVazio(pedido.tipo, pedido.senhaInicial)
      setItem(novo)
      setOriginal(JSON.stringify(itemVazio(pedido.tipo)))
      return
    }
    let vivo = true
    setItem(null)
    api
      .obterItemEdicao(pedido.id)
      .then((i) => {
        if (!vivo) return
        setItem(i)
        setOriginal(JSON.stringify(i))
      })
      .catch(ignorarDescartado)
      .catch((e) => {
        avisar('erro', erroParaTexto(e))
        fecharEditor()
      })
    return () => {
      vivo = false
    }
  }, [pedido, fecharEditor])

  const alterado = item !== null && JSON.stringify(item) !== original

  const fechar = useCallback(async () => {
    if (alterado) {
      const ok = await confirmar({ titulo: 'Descartar as alterações?', texto: 'O que mudaste neste registo ainda não foi guardado.', confirmar: 'Descartar', perigo: true })
      if (!ok) return
    }
    fecharEditor()
  }, [alterado, fecharEditor])

  const guardar = useCallback(async () => {
    if (!item || aGuardar) return
    if (!item.titulo.trim()) {
      setErro('Dá um título ao registo.')
      return
    }
    setAGuardar(true)
    setErro(null)
    try {
      const id = await api.guardarItem(item)
      avisar('sucesso', item.id ? 'Alterações guardadas.' : 'Registo guardado no cofre.')
      fecharEditor()
      mudou()
      abrirRegisto(item.conteudo.tipo, id)
    } catch (e) {
      if (descartado(e)) return
      setErro(erroParaTexto(e))
    } finally {
      setAGuardar(false)
    }
  }, [item, aGuardar, fecharEditor, mudou, abrirRegisto])

  useEffect(() => {
    if (!pedido) return
    const tecla = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void guardar()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [pedido, guardar])

  const tipo = pedido?.tipo ?? 'login'
  const mudar = (parcial: Partial<Item>) => setItem((i) => (i ? { ...i, ...parcial } : i))
  const mudarConteudo = (parcial: Partial<Login & Banco & Cartao & Nota>) => setItem((i) => (i ? { ...i, conteudo: { ...i.conteudo, ...parcial } as Conteudo } : i))

  return (
    <Modal
      aberto={!!pedido}
      aoFechar={() => void fechar()}
      titulo={pedido?.id ? NOMES[tipo].editar : NOMES[tipo].novo}
      largura="max-w-2xl"
      fecharComFundo={false}
      rodape={
        <>
          {erro && <p className="mr-auto max-w-sm text-[12px] text-danger" role="alert">{erro}</p>}
          <Botao variante="fantasma" onClick={() => void fechar()}>
            Cancelar
          </Botao>
          <Botao onClick={() => void guardar()} carregando={aGuardar} disabled={!item}>
            Guardar <span className="text-[11px] font-normal opacity-70">Ctrl+S</span>
          </Botao>
        </>
      }
    >
      {!item ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void guardar()
          }}
          className="space-y-6"
        >
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <Campo
              rotulo={tipo === 'banco' || tipo === 'cartao' ? 'Nome personalizado' : 'Título'}
              value={item.titulo}
              onChange={(e) => mudar({ titulo: e.target.value })}
              placeholder={{ login: 'Ex.: Correio pessoal', banco: 'Ex.: Conta ordenado', cartao: 'Ex.: Cartão de crédito principal', nota: 'Ex.: Códigos do GitHub' }[tipo]}
              maxLength={200}
              data-foco-inicial
            />
            <button
              type="button"
              aria-pressed={item.favorito}
              title={item.favorito ? 'Favorito' : 'Marcar como favorito'}
              onClick={() => mudar({ favorito: !item.favorito })}
              className={cn(
                'flex h-11 cursor-pointer items-center gap-1.5 rounded-xl border px-3.5 text-[12.5px] font-semibold transition-colors',
                item.favorito ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border bg-raised text-muted hover:text-text',
              )}
            >
              <Star className={cn('size-4', item.favorito && 'fill-current')} aria-hidden="true" /> Favorito
            </button>
          </div>

          {item.conteudo.tipo === 'login' && <FormLogin c={item.conteudo} mudar={mudarConteudo} titulo={item.titulo} />}
          {item.conteudo.tipo === 'banco' && <FormBanco c={item.conteudo} mudar={mudarConteudo} />}
          {item.conteudo.tipo === 'cartao' && <FormCartao c={item.conteudo} mudar={mudarConteudo} />}
          {item.conteudo.tipo === 'nota' && <FormNota c={item.conteudo} mudar={mudarConteudo} />}

          <Organizacao item={item} mudar={mudar} />
        </form>
      )}
    </Modal>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 flex items-center gap-2 text-[11px] font-bold tracking-widest text-faint">
        <span className="h-3 w-0.5 rounded-full bg-accent" aria-hidden="true" />
        {titulo.toUpperCase()}
      </legend>
      {children}
    </fieldset>
  )
}

function FormLogin({ c, mudar, titulo }: { c: Login; mudar: (p: Partial<Login>) => void; titulo: string }) {
  const forca = useForca(c.senha, [titulo, c.utilizador, c.email].filter(Boolean))
  const gerar = async () => {
    try {
      const g = await api.gerarSenha(OPCOES_GERAR)
      mudar({ senha: g.valor })
    } catch (e) {
      if (descartado(e)) return
      avisar('erro', erroParaTexto(e))
    }
  }
  return (
    <Secao titulo="Acesso">
      <Campo rotulo="Endereço" opcional value={c.url} onChange={(e) => mudar({ url: e.target.value })} placeholder="https://exemplo.pt" inputMode="url" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Utilizador" opcional value={c.utilizador} onChange={(e) => mudar({ utilizador: e.target.value })} />
        <Campo rotulo="E-mail" opcional value={c.email} onChange={(e) => mudar({ email: e.target.value })} inputMode="email" />
      </div>
      <div>
        <CampoSenha
          rotulo="Senha"
          value={c.senha}
          onChange={(e) => mudar({ senha: e.target.value })}
          acoes={
            <AcaoLinha rotulo="Gerar uma senha forte" onClick={gerar}>
              <WandSparkles />
            </AcaoLinha>
          }
        />
        {c.senha && <MedidorForca forca={forca} className="mt-2.5" />}
        {c.historico.length > 0 && <p className="mt-2 text-[11.5px] text-faint">Ao mudar a senha, a anterior vai para o histórico deste registo.</p>}
      </div>
      <CampoSenha
        rotulo="Chave 2FA (TOTP)"
        opcional
        value={c.totp}
        onChange={(e) => mudar({ totp: e.target.value.trim() })}
        placeholder="JBSW Y3DP … ou otpauth://totp/…"
        className="[&_input]:mono"
        validacao={validarTotp(c.totp)}
        ajuda="A chave secreta (ou o link otpauth://) que o site mostra ao ativar a verificação em 2 passos. Com ela aqui, o LisSecurity mostra o código de 6 dígitos — mas quem abrir o cofre fica com os dois fatores."
      />
    </Secao>
  )
}

/** Verificação rápida do formato (a camada nativa valida a sério ao guardar). */
function validarTotp(v: string) {
  const t = v.trim()
  if (!t) return null
  if (/^otpauth:\/\/totp\//i.test(t)) return /[?&]secret=[A-Za-z2-7= ]{16,}/i.test(t) ? { ok: true as const } : { ok: false as const, erro: 'O link otpauth:// não tem uma chave (secret=…) válida.' }
  return /^[A-Za-z2-7=\s-]{16,}$/.test(t) ? { ok: true as const } : { ok: false as const, erro: 'Uma chave 2FA tem letras A–Z e algarismos 2–7 (pelo menos 16).' }
}

function useOpcoes(tipo: TipoItem) {
  const [lista, setLista] = useState<Resumo[]>([])
  useEffect(() => {
    api
      .listar({ tipo, ordem: 'titulo' })
      .then(setLista)
      .catch(ignorarDescartado)
      .catch(() => {})
  }, [tipo])
  return lista
}

function FormBanco({ c, mudar }: { c: Banco; mudar: (p: Partial<Banco>) => void }) {
  const pais = PAISES.find((p) => p.codigo === c.pais) ?? PAISES[PAISES.length - 1]
  const modelo = pais.modelo
  const credenciais = useOpcoes('login')
  const [mais, setMais] = useState(false)
  const ibanVal = useMemo(() => validarIban(c.iban), [c.iban])
  const bicVal = useMemo(() => validarBic(c.bic), [c.bic])
  return (
    <>
      <Secao titulo="Banco">
        <div className="grid gap-4 sm:grid-cols-2">
          <Selecao
            rotulo="País da conta"
            value={c.pais}
            onChange={(e) => {
              const p = PAISES.find((x) => x.codigo === e.target.value)
              mudar({ pais: e.target.value, moeda: p?.moeda || c.moeda })
            }}
          >
            {PAISES.map((p) => (
              <option key={p.codigo || 'outro'} value={p.codigo}>
                {p.nome}
              </option>
            ))}
          </Selecao>
          <Campo rotulo="Banco" value={c.banco} onChange={(e) => mudar({ banco: e.target.value })} placeholder={modelo === 'br' ? 'Ex.: 001 · Banco do Brasil' : 'Ex.: Caixa Geral de Depósitos'} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo className="sm:col-span-1" rotulo="Titular" value={c.titular} onChange={(e) => mudar({ titular: e.target.value })} />
          <Selecao rotulo="Tipo de conta" value={c.tipoConta} onChange={(e) => mudar({ tipoConta: e.target.value })}>
            {Object.entries(TIPOS_CONTA).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Selecao>
          <Selecao rotulo="Moeda" value={c.moeda} onChange={(e) => mudar({ moeda: e.target.value })}>
            {[...new Set([c.moeda, ...MOEDAS])].filter(Boolean).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Selecao>
        </div>
      </Secao>

      <Secao titulo="Identificação da conta">
        {(modelo === 'iban' || modelo === 'outro' || mais) && (
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Campo rotulo="IBAN" opcional={modelo !== 'iban'} value={c.iban} onChange={(e) => mudar({ iban: e.target.value.toUpperCase() })} validacao={ibanVal} className="[&_input]:mono" placeholder={`${c.pais || 'PT'}00 0000 0000 …`} />
            <Campo rotulo="BIC / SWIFT" opcional value={c.bic} onChange={(e) => mudar({ bic: e.target.value.toUpperCase() })} validacao={bicVal} className="[&_input]:mono" />
          </div>
        )}
        {(modelo === 'br' || modelo === 'us' || modelo === 'outro' || mais) && (
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Campo
              rotulo={modelo === 'us' ? 'Routing number (ABA)' : 'Agência'}
              opcional={modelo !== 'br'}
              value={c.agencia}
              onChange={(e) => mudar({ agencia: e.target.value })}
              className="[&_input]:mono"
              ajuda={modelo === 'br' ? 'Ex.: 1234-5' : undefined}
            />
            <Campo rotulo="Número da conta" opcional={modelo === 'iban'} value={c.numeroConta} onChange={(e) => mudar({ numeroConta: e.target.value })} className="[&_input]:mono" ajuda={modelo === 'br' ? 'Com o dígito, ex.: 12345-6' : undefined} />
          </div>
        )}
        {modelo === 'iban' && !mais && (
          <button type="button" onClick={() => setMais(true)} className="cursor-pointer text-[12px] font-medium text-accent hover:text-accent-hover">
            + Agência e número de conta nacional
          </button>
        )}
        {modelo === 'br' && !mais && (
          <button type="button" onClick={() => setMais(true)} className="cursor-pointer text-[12px] font-medium text-accent hover:text-accent-hover">
            + IBAN e BIC (contas no estrangeiro)
          </button>
        )}
      </Secao>

      {(modelo === 'br' || c.chavesPix.length > 0) && (
        <Secao titulo="Chaves Pix">
          <AnimatePresence initial={false}>
            {c.chavesPix.map((p, i) => (
              <motion.div key={i} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="grid grid-cols-[150px_1fr_auto] items-start gap-2">
                <Selecao aria-label="Tipo de chave Pix" value={p.tipo} onChange={(e) => mudar({ chavesPix: c.chavesPix.map((x, j) => (j === i ? { ...x, tipo: e.target.value } : x)) })}>
                  {Object.entries(TIPOS_PIX).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </Selecao>
                <Campo aria-label="Chave Pix" value={p.valor} onChange={(e) => mudar({ chavesPix: c.chavesPix.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} validacao={validarPix(p.tipo, p.valor)} />
                <button type="button" aria-label="Remover chave" onClick={() => mudar({ chavesPix: c.chavesPix.filter((_, j) => j !== i) })} className="mt-1.5 flex size-8 cursor-pointer items-center justify-center rounded-lg text-faint hover:bg-card-hover hover:text-danger">
                  <Trash2 className="size-4" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          <Botao variante="contorno" tamanho="sm" icone={<Plus />} onClick={() => mudar({ chavesPix: [...c.chavesPix, { tipo: 'cpf', valor: '' }] })}>
            Adicionar chave Pix
          </Botao>
        </Secao>
      )}

      <Secao titulo="Acesso ao banco">
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoSenha rotulo="Identificador de acesso" opcional value={c.idAcesso} onChange={(e) => mudar({ idAcesso: e.target.value })} ajuda="Nº de adesão, utilizador do homebanking…" />
          <Selecao rotulo="Credencial já guardada no cofre" opcional value={c.credencialLigada ?? ''} onChange={(e) => mudar({ credencialLigada: e.target.value || null })} ajuda="A senha não se duplica: fica só no registo ligado.">
            <option value="">— Nenhuma —</option>
            {credenciais.map((r) => (
              <option key={r.id} value={r.id}>
                {r.titulo}
              </option>
            ))}
          </Selecao>
        </div>
      </Secao>
    </>
  )
}

function FormCartao({ c, mudar }: { c: Cartao; mudar: (p: Partial<Cartao>) => void }) {
  const contas = useOpcoes('banco')
  const [visivel, setVisivel] = useState(false)
  const numeroVal = useMemo(() => validarNumeroCartao(c.numero), [c.numero])
  const bandeiraDetetada = detetarBandeira(c.numero)
  return (
    <>
      <Secao titulo="Cartão">
        <Campo
          rotulo="Número do cartão"
          value={visivel ? c.numero : c.numero}
          type={visivel ? 'text' : 'password'}
          inputMode="numeric"
          onChange={(e) => {
            const numero = e.target.value.replace(/[^\d\s-]/g, '')
            const b = detetarBandeira(numero)
            mudar({ numero, ...(b && (!c.bandeira || c.bandeira === bandeiraDetetada) ? { bandeira: b } : {}) })
          }}
          validacao={numeroVal}
          className="[&_input]:mono [&_input]:tracking-wider"
          fim={
            <AcaoLinha rotulo={visivel ? 'Ocultar' : 'Mostrar enquanto escreves'} onClick={() => setVisivel(!visivel)} ativo={visivel}>
              {visivel ? <EyeOff /> : <Eye />}
            </AcaoLinha>
          }
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Validade" value={c.validade} onChange={(e) => mudar({ validade: formatarValidade(e.target.value) })} placeholder="MM/AA" validacao={validarValidade(c.validade)} className="[&_input]:mono" maxLength={5} />
          <Selecao rotulo="Tipo" value={c.tipoCartao} onChange={(e) => mudar({ tipoCartao: e.target.value })}>
            {Object.entries(TIPOS_CARTAO).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Selecao>
          <Selecao rotulo="Bandeira" value={c.bandeira} onChange={(e) => mudar({ bandeira: e.target.value })}>
            <option value="">—</option>
            {BANDEIRAS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Selecao>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Titular" opcional value={c.titular} onChange={(e) => mudar({ titular: e.target.value })} />
          <Campo rotulo="Instituição" opcional value={c.instituicao} onChange={(e) => mudar({ instituicao: e.target.value })} />
        </div>
        <Selecao rotulo="Conta associada" opcional value={c.contaLigada ?? ''} onChange={(e) => mudar({ contaLigada: e.target.value || null })}>
          <option value="">— Nenhuma —</option>
          {contas.map((r) => (
            <option key={r.id} value={r.id}>
              {r.titulo}
            </option>
          ))}
        </Selecao>
        <Aviso tom="neutro">O PIN e o CVV não têm campo próprio de propósito: são os dados que mais facilitam fraudes se forem expostos.</Aviso>
      </Secao>
    </>
  )
}

function FormNota({ c, mudar }: { c: Nota; mudar: (p: Partial<Nota>) => void }) {
  const [codigosTexto, setCodigosTexto] = useState(() => c.codigos.map((x) => x.valor).join('\n'))
  const [visivel, setVisivel] = useState(c.conteudo === '')
  const atualizarCodigos = (texto: string) => {
    setCodigosTexto(texto)
    const usados = new Map(c.codigos.map((x) => [x.valor, x.usado]))
    mudar({
      codigos: texto
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((valor) => ({ valor, usado: usados.get(valor) ?? false })),
    })
  }
  return (
    <Secao titulo="Conteúdo">
      <Segmentado
        rotulo="Tipo de nota"
        idAnimacao="tipoNota"
        valor={c.tipoNota as 'nota' | 'codigos' | 'licenca'}
        aoMudar={(v) => mudar({ tipoNota: v })}
        opcoes={Object.entries(TIPOS_NOTA).map(([valor, texto]) => ({ valor: valor as 'nota' | 'codigos' | 'licenca', texto }))}
      />
      {c.tipoNota === 'codigos' ? (
        <AreaTexto
          rotulo="Códigos (um por linha)"
          value={codigosTexto}
          onChange={(e) => atualizarCodigos(e.target.value)}
          className="[&_textarea]:mono"
          rows={8}
          ajuda="Depois podes marcar cada código como usado. Não são apagados sozinhos."
        />
      ) : c.tipoNota === 'licenca' ? (
        <CampoSenha rotulo="Chave de licença" value={c.conteudo} onChange={(e) => mudar({ conteudo: e.target.value })} className="[&_input]:mono" />
      ) : (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-muted">Texto</span>
            <button type="button" onClick={() => setVisivel(!visivel)} className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] text-faint hover:text-text">
              {visivel ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {visivel ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          {visivel ? (
            <AreaTexto aria-label="Texto da nota" value={c.conteudo} onChange={(e) => mudar({ conteudo: e.target.value })} rows={10} ajuda="Só texto simples: nada é interpretado como HTML ou executado." />
          ) : (
            <button type="button" onClick={() => setVisivel(true)} className="flex h-24 w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-raised text-[12.5px] text-faint hover:text-text">
              Conteúdo oculto — clica para mostrar e editar
            </button>
          )}
        </div>
      )}
    </Secao>
  )
}

function Organizacao({ item, mudar }: { item: Item; mudar: (p: Partial<Item>) => void }) {
  const [etiquetas, setEtiquetas] = useState(item.etiquetas.join(', '))
  const [categorias, setCategorias] = useState<string[]>([])
  const [notasVisiveis, setNotasVisiveis] = useState(item.notas === '')
  useEffect(() => {
    api
      .agrupamentos('')
      .then((a) => setCategorias(a.categorias.map((c) => c.nome)))
      .catch(ignorarDescartado)
      .catch(() => {})
  }, [])
  const mudarCampo = (i: number, p: Partial<CampoPersonalizado>) => mudar({ campos: item.campos.map((c, j) => (j === i ? { ...c, ...p } : c)) })
  return (
    <>
      <Secao titulo="Organização">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Campo rotulo="Categoria" opcional value={item.categoria} onChange={(e) => mudar({ categoria: e.target.value })} list="categorias-cofre" placeholder="Ex.: Pessoal, Trabalho" />
            <datalist id="categorias-cofre">
              {categorias.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <Campo
            rotulo="Etiquetas"
            opcional
            value={etiquetas}
            onChange={(e) => {
              setEtiquetas(e.target.value)
              mudar({ etiquetas: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })
            }}
            placeholder="separadas por vírgulas"
          />
        </div>
      </Secao>

      <Secao titulo="Campos personalizados">
        <AnimatePresence initial={false}>
          {item.campos.map((c, i) => (
            <motion.div key={c.id || `novo-${i}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="grid grid-cols-[1fr_1.4fr_auto_auto] items-start gap-2">
              <Campo aria-label="Nome do campo" placeholder="Nome" value={c.rotulo} onChange={(e) => mudarCampo(i, { rotulo: e.target.value })} />
              <Campo aria-label="Valor do campo" placeholder="Valor" type={c.oculto ? 'password' : 'text'} value={c.valor} onChange={(e) => mudarCampo(i, { valor: e.target.value })} />
              <button
                type="button"
                aria-pressed={c.oculto}
                title={c.oculto ? 'Campo oculto (tratado como segredo)' : 'Campo visível'}
                onClick={() => mudarCampo(i, { oculto: !c.oculto })}
                className={cn('mt-1.5 flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors', c.oculto ? 'bg-accent-soft text-accent' : 'text-faint hover:bg-card-hover hover:text-text')}
              >
                {c.oculto ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              <button type="button" aria-label="Remover campo" onClick={() => mudar({ campos: item.campos.filter((_, j) => j !== i) })} className="mt-1.5 flex size-8 cursor-pointer items-center justify-center rounded-lg text-faint hover:bg-card-hover hover:text-danger">
                <Trash2 className="size-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        <Botao variante="contorno" tamanho="sm" icone={<Plus />} onClick={() => mudar({ campos: [...item.campos, { id: '', rotulo: '', valor: '', oculto: true }] })}>
          Adicionar campo
        </Botao>
      </Secao>

      <Secao titulo="Notas privadas">
        {notasVisiveis ? (
          <AreaTexto aria-label="Notas privadas" value={item.notas} onChange={(e) => mudar({ notas: e.target.value })} rows={4} placeholder="Ficam ocultas no detalhe até pedires para as ver." />
        ) : (
          <button type="button" onClick={() => setNotasVisiveis(true)} className="flex h-16 w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-raised text-[12.5px] text-faint hover:text-text">
            Notas ocultas — clica para mostrar e editar
          </button>
        )}
      </Secao>
    </>
  )
}
