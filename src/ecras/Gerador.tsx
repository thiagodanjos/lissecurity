import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Copy, KeyRound, RefreshCw, Save, Type } from 'lucide-react'
import { api, descartado } from '@/lib/ipc'
import type { Gerada, OpcoesFrase, OpcoesSenha } from '@/lib/tipos'
import { novoRegisto } from '@/lib/acoes'
import { cn } from '@/lib/utils'
import { avisar, erroParaTexto } from '@/componentes/avisos'
import { MedidorForca, useForca } from '@/componentes/forca'
import { Botao, Cartao, Interruptor, Segmentado, TituloSecao } from '@/componentes/ui'

/** Gerador local. As senhas geradas não ficam em histórico nenhum: ao sair da página, desaparecem. */
export function Gerador() {
  const [modo, setModo] = useState<'senha' | 'frase'>('senha')
  const [opSenha, setOpSenha] = useState<OpcoesSenha>({ comprimento: 20, maiusculas: true, minusculas: true, numeros: true, simbolos: true, evitarSemelhantes: false })
  const [opFrase, setOpFrase] = useState<OpcoesFrase>({ palavras: 6, separador: '-', maiusculaInicial: false, incluirNumero: false })
  const [gerada, setGerada] = useState<Gerada | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [rodar, setRodar] = useState(0)
  const forca = useForca(gerada?.valor ?? '')

  // começa com as predefinições guardadas no cofre (Definições > Gerador)
  useEffect(() => {
    api
      .obterDefinicoes()
      .then(({ gerador: g }) => {
        setModo(g.modo)
        setOpSenha({ comprimento: g.comprimento, maiusculas: g.maiusculas, minusculas: g.minusculas, numeros: g.numeros, simbolos: g.simbolos, evitarSemelhantes: g.evitarSemelhantes })
        setOpFrase({ palavras: g.palavras, separador: g.separador, maiusculaInicial: g.maiusculaInicial, incluirNumero: g.incluirNumero })
      })
      .catch(() => {})
  }, [])

  const guardarPredefinicao = async () => {
    try {
      await api.guardarGerador({ modo, ...opSenha, ...opFrase })
      avisar('sucesso', 'Estas opções passam a ser as predefinidas.')
    } catch (e) {
      if (descartado(e)) return
      avisar('erro', erroParaTexto(e))
    }
  }

  const gerar = useCallback(async () => {
    try {
      setErro(null)
      setGerada(modo === 'senha' ? await api.gerarSenha(opSenha) : await api.gerarFrase(opFrase))
      setRodar((r) => r + 1)
    } catch (e) {
      if (descartado(e)) return
      setErro(erroParaTexto(e))
      setGerada(null)
    }
  }, [modo, opSenha, opFrase])

  useEffect(() => {
    void gerar()
  }, [gerar])

  const copiar = async () => {
    if (!gerada) return
    try {
      const s = await api.copiarTexto(gerada.valor)
      avisar('sucesso', `Copiada. A área de transferência é limpa em ${s} s.`)
    } catch (e) {
      if (descartado(e)) return
      avisar('erro', erroParaTexto(e))
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-8 py-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Gerador de <span className="text-brand-gradient">senhas</span>
          </h1>
          <p className="mt-1.5 text-sm text-muted">Gerado neste computador com o gerador criptográfico do sistema. Nada fica guardado até decidires guardar.</p>
        </div>

        <Cartao className="overflow-hidden">
          <div className="relative px-6 pb-5 pt-6">
            <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[480px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgb(30_215_96/0.12),transparent_65%)]" />
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={rodar}
                initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="selecionavel mono relative min-h-[2.6em] break-all text-center text-[22px] font-semibold leading-snug tracking-wide"
                aria-live="polite"
              >
                {gerada ? <Colorida valor={gerada.valor} /> : <span className="text-faint">—</span>}
              </motion.p>
            </AnimatePresence>
            <MedidorForca forca={forca} compacto className="relative mx-auto mt-4 max-w-xs" />
            <p className="relative mt-2 text-center text-[11.5px] text-faint">
              {gerada ? `Entropia estimada: ~${Math.round(gerada.entropiaBits)} bits` : ' '} · estimativa, não uma garantia de inviolabilidade
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border bg-raised/40 px-6 py-3.5">
            <Botao variante="escuro" icone={<RefreshCw />} onClick={() => void gerar()}>
              Gerar outra
            </Botao>
            <Botao icone={<Copy />} onClick={copiar} disabled={!gerada}>
              Copiar
            </Botao>
            <Botao variante="contorno" icone={<Save />} disabled={!gerada} onClick={() => gerada && novoRegisto('login', gerada.valor)}>
              Guardar no cofre
            </Botao>
          </div>
        </Cartao>

        <section>
          <TituloSecao
            acao={
              <button type="button" onClick={guardarPredefinicao} className="cursor-pointer text-[12px] font-semibold text-muted hover:text-accent">
                Guardar como predefinição
              </button>
            }
          >
            Opções
          </TituloSecao>
          <Cartao className="space-y-5 p-5">
            <Segmentado
              rotulo="Tipo"
              idAnimacao="modoGerador"
              valor={modo}
              aoMudar={setModo}
              opcoes={[
                { valor: 'senha', texto: 'Senha aleatória', icone: <KeyRound /> },
                { valor: 'frase', texto: 'Frase-senha', icone: <Type /> },
              ]}
              className="max-w-sm"
            />
            {modo === 'senha' ? (
              <>
                <Deslizador rotulo="Comprimento" min={8} max={64} valor={opSenha.comprimento} aoMudar={(comprimento) => setOpSenha({ ...opSenha, comprimento })} unidade="caracteres" />
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <Interruptor rotulo="Maiúsculas (A–Z)" ligado={opSenha.maiusculas} aoMudar={(maiusculas) => setOpSenha({ ...opSenha, maiusculas })} />
                  <Interruptor rotulo="Minúsculas (a–z)" ligado={opSenha.minusculas} aoMudar={(minusculas) => setOpSenha({ ...opSenha, minusculas })} />
                  <Interruptor rotulo="Números (0–9)" ligado={opSenha.numeros} aoMudar={(numeros) => setOpSenha({ ...opSenha, numeros })} />
                  <Interruptor rotulo="Símbolos (!#$%…)" ligado={opSenha.simbolos} aoMudar={(simbolos) => setOpSenha({ ...opSenha, simbolos })} />
                  <Interruptor rotulo="Evitar caracteres parecidos" descricao="Sem I, l, 1, O, 0… — útil para ler ou ditar." ligado={opSenha.evitarSemelhantes} aoMudar={(evitarSemelhantes) => setOpSenha({ ...opSenha, evitarSemelhantes })} />
                </div>
              </>
            ) : (
              <>
                <Deslizador rotulo="Palavras" min={3} max={12} valor={opFrase.palavras} aoMudar={(palavras) => setOpFrase({ ...opFrase, palavras })} unidade="palavras" />
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-semibold text-text">Separador</span>
                  <div className="flex gap-1.5">
                    {['-', ' ', '.', '_', ''].map((s) => (
                      <button
                        key={s || 'nenhum'}
                        type="button"
                        aria-pressed={opFrase.separador === s}
                        onClick={() => setOpFrase({ ...opFrase, separador: s })}
                        className={cn('mono h-8 min-w-10 cursor-pointer rounded-lg border px-2 text-[13px] transition-colors', opFrase.separador === s ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border bg-raised text-muted hover:text-text')}
                      >
                        {s === ' ' ? 'espaço' : s === '' ? 'nenhum' : s}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <Interruptor rotulo="Maiúscula inicial" ligado={opFrase.maiusculaInicial} aoMudar={(maiusculaInicial) => setOpFrase({ ...opFrase, maiusculaInicial })} />
                  <Interruptor rotulo="Incluir um algarismo" ligado={opFrase.incluirNumero} aoMudar={(incluirNumero) => setOpFrase({ ...opFrase, incluirNumero })} />
                </div>
                <p className="text-[11.5px] text-faint">Palavras de uma lista de 2048 palavras portuguesas sem acentos (11 bits cada).</p>
              </>
            )}
            {erro && <p className="text-[12.5px] text-danger">{erro}</p>}
          </Cartao>
        </section>
      </div>
    </div>
  )
}

function Colorida({ valor }: { valor: string }) {
  return (
    <>
      {[...valor].map((c, i) => (
        <span key={i} className={/\d/.test(c) ? 'text-accent' : /[a-zA-Z]/.test(c) ? 'text-text' : /\s/.test(c) ? '' : 'text-[#7cc4ff]'}>
          {c}
        </span>
      ))}
    </>
  )
}

function Deslizador({ rotulo, min, max, valor, aoMudar, unidade }: { rotulo: string; min: number; max: number; valor: number; aoMudar: (v: number) => void; unidade: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label htmlFor={`desl-${rotulo}`} className="text-[13px] font-semibold text-text">
          {rotulo}
        </label>
        <span className="text-[13px] font-bold tabular-nums text-accent">
          {valor} <span className="font-normal text-faint">{unidade}</span>
        </span>
      </div>
      <input id={`desl-${rotulo}`} type="range" min={min} max={max} value={valor} onChange={(e) => aoMudar(Number(e.target.value))} className="w-full cursor-pointer accent-[var(--color-accent)]" />
    </div>
  )
}
