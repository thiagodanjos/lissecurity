import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  Cloud,
  Database,
  FileSpreadsheet,
  FolderOpen,
  Gauge,
  Info,
  KeyRound,
  Keyboard,
  LockKeyhole,
  Monitor,
  Palette,
  ShieldCheck,
  Upload,
  UserRound,
  WandSparkles,
} from 'lucide-react'
import { api, descartado, ErroIpc, ignorarDescartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import type { Definicoes as Defs, DefinicoesVista, EstadoCopias, PreferenciasGerador } from '@/lib/tipos'
import { mudarConfig } from '@/lib/acoes'
import { haQuanto } from '@/lib/formatos'
import { cn } from '@/lib/utils'
import { avisar, erroParaTexto } from '@/componentes/avisos'
import { MostrarChaveRecuperacao } from '@/componentes/chave-recuperacao'
import { useAjuda } from '@/componentes/ajuda'
import { Aviso, Botao, Campo, Cartao, CampoSenha, Interruptor, Modal, Segmentado, Selecao, Spinner } from '@/componentes/ui'
import { AlterarSenha } from './Seguranca'

const SECOES = [
  { id: 'aparencia', titulo: 'Aparência', icone: <Palette /> },
  { id: 'seguranca', titulo: 'Segurança', icone: <LockKeyhole /> },
  { id: 'gerador', titulo: 'Gerador', icone: <WandSparkles /> },
  { id: 'copias', titulo: 'Cópias de segurança', icone: <Cloud /> },
  { id: 'dados', titulo: 'Dados', icone: <Database /> },
  { id: 'aplicacao', titulo: 'Aplicação', icone: <Monitor /> },
] as const

export function Definicoes() {
  const versao = useSessao((s) => s.versao)
  const config = useSessao((s) => s.config)
  const [d, setD] = useState<DefinicoesVista | null>(null)
  const [copias, setCopias] = useState<EstadoCopias | null>(null)
  const [nome, setNome] = useState('')
  const [modal, setModal] = useState<'senha' | 'reforcar' | null>(null)
  const [ativa, setAtiva] = useState<string>('aparencia')
  const corpo = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api
      .obterDefinicoes()
      .then((x) => {
        setD(x)
        setNome(x.nome)
      })
      .catch(ignorarDescartado)
      .catch((e) => avisar('erro', erroParaTexto(e)))
    api
      .estadoCopias()
      .then(setCopias)
      .catch(ignorarDescartado)
      .catch(() => {})
  }, [versao])

  // destaca na navegação a secção que está à vista
  useEffect(() => {
    const raiz = corpo.current
    if (!raiz || !d) return
    const obs = new IntersectionObserver(
      (entradas) => {
        const vis = entradas.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (vis[0]) setAtiva(vis[0].target.id.replace('def-', ''))
      },
      { root: raiz, rootMargin: '0px 0px -65% 0px' },
    )
    raiz.querySelectorAll('section[id^="def-"]').forEach((s) => obs.observe(s))
    return () => obs.disconnect()
  }, [d])

  if (!d || !config)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )

  const guardarCofre = async (parcial: Partial<Defs>, novoNome = nome) => {
    const novas = { ...d.cofre, ...parcial }
    const antes = d
    setD({ ...d, cofre: novas, nome: novoNome })
    try {
      await api.guardarDefinicoes(novas, novoNome)
      useSessao.getState().definirBloquearAoMinimizar(novas.bloquearAoMinimizar)
      useSessao.getState().definirOcultarSegundos(novas.ocultarReveladoSegundos)
      useSessao.getState().mudou()
    } catch (e) {
      if (descartado(e)) return
      avisar('erro', erroParaTexto(e))
      setD(antes)
    }
  }

  const guardarGerador = async (parcial: Partial<PreferenciasGerador>) => {
    const novo = { ...d.gerador, ...parcial }
    const antes = d
    setD({ ...d, gerador: novo })
    try {
      await api.guardarGerador(novo)
    } catch (e) {
      if (descartado(e)) return
      avisar('erro', erroParaTexto(e))
      setD(antes)
    }
  }

  const irA = (id: string) => {
    setAtiva(id)
    corpo.current?.querySelector(`#def-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* navegação das secções */}
      <nav aria-label="Secções das definições" className="hidden w-56 shrink-0 border-r border-border/60 px-4 py-8 lg:block">
        <h1 className="mb-5 px-3 text-[22px] font-extrabold tracking-tight">Definições</h1>
        <ul className="space-y-0.5">
          {SECOES.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => irA(s.id)}
                aria-current={ativa === s.id ? 'true' : undefined}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors [&_svg]:size-4',
                  ativa === s.id ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:bg-card/70 hover:text-text',
                )}
              >
                {s.icone}
                {s.titulo}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div ref={corpo} className="min-w-0 flex-1 overflow-y-auto scroll-smooth">
        <div className="mx-auto max-w-3xl space-y-10 px-8 py-8">
          <h1 className="text-3xl font-extrabold tracking-tight lg:hidden">Definições</h1>

          <Grupo id="aparencia" icone={<Palette />} titulo="Aparência">
            <Linha rotulo="Tema" descricao="Os dois são escuros, como a LisFilms.">
              <Segmentado rotulo="Tema" idAnimacao="tema" valor={config.tema} aoMudar={(tema) => void mudarConfig({ tema })} opcoes={[{ valor: 'grafite', texto: 'Grafite' }, { valor: 'preto', texto: 'Preto absoluto' }]} className="w-64" />
            </Linha>
            <Linha rotulo="Cor de destaque" descricao="O verde da LisFilms ou o azul do LisGames.">
              <div className="flex gap-2" role="radiogroup" aria-label="Cor de destaque">
                {(
                  [
                    ['verde', '#1ed760', 'Verde LisFilms'],
                    ['azul', '#22a7ff', 'Azul LisGames'],
                  ] as const
                ).map(([v, cor, texto]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={config.cor === v}
                    onClick={() => void mudarConfig({ cor: v })}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
                      config.cor === v ? 'border-text/40 bg-raised text-text' : 'border-border text-muted hover:text-text',
                    )}
                  >
                    <span className="size-3.5 rounded-full" style={{ background: cor, boxShadow: config.cor === v ? `0 0 10px ${cor}` : undefined }} />
                    {texto}
                  </button>
                ))}
              </div>
            </Linha>
            <Linha rotulo="Tamanho de tudo" descricao="Aumenta texto, botões e ícones de uma vez (como o zoom de um navegador).">
              <div className="flex w-64 items-center gap-3">
                <input
                  type="range"
                  min={80}
                  max={150}
                  step={5}
                  value={Math.round(config.zoom * 100)}
                  onChange={(e) => void mudarConfig({ zoom: Number(e.target.value) / 100 })}
                  aria-label="Tamanho"
                  className="flex-1 cursor-pointer accent-[var(--color-accent)]"
                />
                <span className="w-12 text-right text-[13px] font-bold tabular-nums text-accent">{Math.round(config.zoom * 100)}%</span>
              </div>
            </Linha>
            <Linha rotulo="Densidade">
              <Segmentado rotulo="Densidade" idAnimacao="densidade" valor={config.densidade} aoMudar={(densidade) => void mudarConfig({ densidade })} opcoes={[{ valor: 'confortavel', texto: 'Confortável' }, { valor: 'compacta', texto: 'Compacta' }]} className="w-64" />
            </Linha>
            <Linha rotulo="Animações" descricao="«Sistema» segue a preferência de movimento reduzido do Windows.">
              <Segmentado
                rotulo="Animações"
                idAnimacao="animacoes"
                valor={config.animacoes}
                aoMudar={(animacoes) => void mudarConfig({ animacoes })}
                opcoes={[
                  { valor: 'sistema', texto: 'Sistema' },
                  { valor: 'reduzidas', texto: 'Reduzidas' },
                  { valor: 'completas', texto: 'Completas' },
                ]}
                className="w-80"
              />
            </Linha>
            <Linha rotulo="Página ao abrir o cofre">
              <Selecao aria-label="Página ao abrir" value={config.paginaInicial} onChange={(e) => void mudarConfig({ paginaInicial: e.target.value as typeof config.paginaInicial })} className="w-52">
                <option value="inicio">Visão geral</option>
                <option value="senhas">Senhas</option>
                <option value="financeiro">Resumo financeiro</option>
                <option value="gastos">Gastos</option>
              </Selecao>
            </Linha>
            <Interruptor rotulo="Mostrar contagens na barra lateral" ligado={config.contadoresLateral} aoMudar={(v) => void mudarConfig({ contadoresLateral: v })} />
            <form
              className="flex items-end gap-3 py-3"
              onSubmit={(e) => {
                e.preventDefault()
                void guardarCofre({}, nome.trim()).then(() => avisar('sucesso', 'Nome guardado.'))
              }}
            >
              <Campo className="flex-1" rotulo="O teu nome (para a saudação)" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} ajuda="Guardado dentro do cofre cifrado." />
              <Botao type="submit" variante="escuro" icone={<UserRound />} disabled={nome.trim() === d.nome}>
                Guardar
              </Botao>
            </form>
          </Grupo>

          <Grupo id="seguranca" icone={<LockKeyhole />} titulo="Segurança">
            <Linha rotulo="Bloquear depois de" descricao="Minutos sem usar a aplicação.">
              <Selecao aria-label="Minutos até bloquear" value={d.cofre.bloqueioMinutos} onChange={(e) => void guardarCofre({ bloqueioMinutos: Number(e.target.value) })} className="w-40">
                {[1, 2, 5, 10, 15, 30, 60, 120, 240].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </Selecao>
            </Linha>
            <Interruptor rotulo="Bloquear ao minimizar" descricao="O conteúdo sai do ecrã antes de a janela minimizar. O que copiaste continua disponível para colar." ligado={d.cofre.bloquearAoMinimizar} aoMudar={(v) => void guardarCofre({ bloquearAoMinimizar: v })} />
            <Interruptor rotulo="Bloquear ao suspender o computador" ligado={d.cofre.bloquearAoSuspender} aoMudar={(v) => void guardarCofre({ bloquearAoSuspender: v })} />
            <Interruptor rotulo="Bloquear com a sessão do Windows" descricao="Win+L, trocar de utilizador ou terminar sessão." ligado={d.cofre.bloquearComSistema} aoMudar={(v) => void guardarCofre({ bloquearComSistema: v })} />
            <Interruptor
              rotulo="Pedir a senha mestra para dados financeiros"
              descricao="Antes de revelar ou copiar números de cartões, IBAN, contas e chaves Pix. A confirmação vale 5 minutos."
              ligado={d.cofre.reautenticarFinanceiro}
              aoMudar={(v) => void guardarCofre({ reautenticarFinanceiro: v })}
            />
            <Linha rotulo="Voltar a ocultar um valor revelado" descricao="Senhas, números e notas que mostraste ficam visíveis só este tempo.">
              <Selecao aria-label="Segundos até ocultar" value={d.cofre.ocultarReveladoSegundos} onChange={(e) => void guardarCofre({ ocultarReveladoSegundos: Number(e.target.value) })} className="w-40">
                {[10, 20, 30, 60, 120, 300].map((s) => (
                  <option key={s} value={s}>
                    {s < 60 ? `${s} s` : `${s / 60} min`}
                  </option>
                ))}
              </Selecao>
            </Linha>
            <Linha rotulo="Limpar a área de transferência" descricao="Só limpa se ainda lá estiver o que o LisSecurity copiou.">
              <Selecao aria-label="Segundos até limpar" value={d.cofre.limparCopiaSegundos} onChange={(e) => void guardarCofre({ limparCopiaSegundos: Number(e.target.value) })} className="w-40">
                {[10, 20, 30, 45, 60, 90, 120, 300].map((s) => (
                  <option key={s} value={s}>
                    {s < 60 ? `${s} s` : `${s / 60} min`}
                  </option>
                ))}
              </Selecao>
            </Linha>
            <Interruptor
              rotulo="Limpar também ao bloquear"
              descricao="Desligado por padrão: copiar e minimizar para colar noutro sítio tem de funcionar. Ao sair da app limpa-se sempre."
              ligado={d.cofre.limparAoBloquear}
              aoMudar={(v) => void guardarCofre({ limparAoBloquear: v })}
            />
            <Interruptor rotulo="Proteger contra capturas de ecrã" descricao="Pede ao Windows para excluir esta janela de capturas e partilhas de ecrã." ligado={config.protegerCaptura} aoMudar={(v) => void mudarConfig({ protegerCaptura: v })} />
            <Linha rotulo="Proteção da senha mestra" descricao={`Argon2id · ${d.kdfMemoriaMib} MiB · ${d.kdfIteracoes} iterações · XChaCha20-Poly1305`}>
              <Botao variante="contorno" tamanho="sm" icone={<Gauge />} onClick={() => setModal('reforcar')}>
                Reforçar
              </Botao>
            </Linha>
            <div className="flex flex-wrap gap-2 py-3">
              <Botao variante="contorno" tamanho="sm" icone={<KeyRound />} onClick={() => setModal('senha')}>
                Alterar senha mestra
              </Botao>
              <Botao variante="fantasma" tamanho="sm" icone={<ShieldCheck />} onClick={() => useSessao.getState().irPara('seguranca')}>
                Chave de recuperação {d.temRecuperacao ? '(ativa)' : '(desativada)'}
              </Botao>
            </div>
          </Grupo>

          <Grupo id="gerador" icone={<WandSparkles />} titulo="Gerador (predefinições)">
            <Linha rotulo="Tipo por defeito">
              <Segmentado rotulo="Tipo" idAnimacao="modoPredefinido" valor={d.gerador.modo} aoMudar={(modo) => void guardarGerador({ modo })} opcoes={[{ valor: 'senha', texto: 'Senha aleatória' }, { valor: 'frase', texto: 'Frase-senha' }]} className="w-72" />
            </Linha>
            <Linha rotulo="Comprimento da senha">
              <div className="flex w-64 items-center gap-3">
                <input type="range" min={8} max={64} value={d.gerador.comprimento} onChange={(e) => void guardarGerador({ comprimento: Number(e.target.value) })} aria-label="Comprimento" className="flex-1 cursor-pointer accent-[var(--color-accent)]" />
                <span className="w-8 text-right text-[13px] font-bold tabular-nums text-accent">{d.gerador.comprimento}</span>
              </div>
            </Linha>
            <div className="grid gap-x-8 sm:grid-cols-2">
              <Interruptor rotulo="Maiúsculas" ligado={d.gerador.maiusculas} aoMudar={(v) => void guardarGerador({ maiusculas: v })} />
              <Interruptor rotulo="Minúsculas" ligado={d.gerador.minusculas} aoMudar={(v) => void guardarGerador({ minusculas: v })} />
              <Interruptor rotulo="Números" ligado={d.gerador.numeros} aoMudar={(v) => void guardarGerador({ numeros: v })} />
              <Interruptor rotulo="Símbolos" ligado={d.gerador.simbolos} aoMudar={(v) => void guardarGerador({ simbolos: v })} />
              <Interruptor rotulo="Evitar caracteres parecidos" ligado={d.gerador.evitarSemelhantes} aoMudar={(v) => void guardarGerador({ evitarSemelhantes: v })} />
            </div>
            <Linha rotulo="Palavras na frase-senha">
              <div className="flex w-64 items-center gap-3">
                <input type="range" min={3} max={12} value={d.gerador.palavras} onChange={(e) => void guardarGerador({ palavras: Number(e.target.value) })} aria-label="Palavras" className="flex-1 cursor-pointer accent-[var(--color-accent)]" />
                <span className="w-8 text-right text-[13px] font-bold tabular-nums text-accent">{d.gerador.palavras}</span>
              </div>
            </Linha>
            <div className="grid gap-x-8 sm:grid-cols-2">
              <Interruptor rotulo="Maiúscula inicial nas palavras" ligado={d.gerador.maiusculaInicial} aoMudar={(v) => void guardarGerador({ maiusculaInicial: v })} />
              <Interruptor rotulo="Incluir um algarismo" ligado={d.gerador.incluirNumero} aoMudar={(v) => void guardarGerador({ incluirNumero: v })} />
            </div>
          </Grupo>

          <Grupo id="copias" icone={<Cloud />} titulo="Cópias de segurança">
            <Linha
              rotulo="Cópias automáticas"
              descricao={
                copias?.config.ativo
                  ? `Ligadas · ${copias.config.pasta} · última ${copias.ultimaAutomatica ? haQuanto(copias.ultimaAutomatica) : '—'}`
                  : 'Desligadas. Liga-as para guardar uma cópia cifrada no Google Drive sempre que o cofre muda.'
              }
            >
              <Botao variante={copias?.config.ativo ? 'escuro' : 'primario'} tamanho="sm" icone={<Cloud />} onClick={() => useSessao.getState().irPara('copias')}>
                {copias?.config.ativo ? 'Gerir' : 'Configurar'}
              </Botao>
            </Linha>
            <Linha rotulo="Lembrete" descricao="Avisa na visão geral quando a última cópia for mais antiga do que isto.">
              <Selecao aria-label="Dias até lembrar" value={d.cofre.lembreteCopiaDias} onChange={(e) => void guardarCofre({ lembreteCopiaDias: Number(e.target.value) })} className="w-44">
                {[1, 3, 7, 14, 30].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? '1 dia' : `${n} dias`}
                  </option>
                ))}
                <option value={0}>Nunca lembrar</option>
              </Selecao>
            </Linha>
          </Grupo>

          <Grupo id="dados" icone={<Database />} titulo="Dados">
            <Linha rotulo="Local do cofre" descricao={<span className="mono break-all text-[11.5px]">{d.caminhoCofre}</span>}>
              <Botao variante="escuro" tamanho="sm" icone={<FolderOpen />} onClick={() => api.abrirPastaCofre().catch((e) => void (descartado(e) || avisar('erro', erroParaTexto(e))))}>
                Abrir pasta
              </Botao>
            </Linha>
            <Linha rotulo="Importar senhas" descricao="De Chrome, Edge, Brave, Firefox, Bitwarden, LastPass, 1Password ou KeePass (CSV).">
              <Botao variante="escuro" tamanho="sm" icone={<Upload />} onClick={() => useSessao.getState().abrirImportar('senhas')}>
                Importar
              </Botao>
            </Linha>
            <Linha rotulo="Importar extrato bancário" descricao="Revolut ou outro banco (CSV), para a página Gastos.">
              <Botao variante="escuro" tamanho="sm" icone={<FileSpreadsheet />} onClick={() => useSessao.getState().abrirImportar('extrato')}>
                Importar
              </Botao>
            </Linha>
            <Linha rotulo="Lixo" descricao="Tempo até um registo eliminado sair do cofre.">
              <Selecao aria-label="Dias no lixo" value={d.cofre.diasLixo} onChange={(e) => void guardarCofre({ diasLixo: Number(e.target.value) })} className="w-44">
                {[7, 30, 90, 365].map((n) => (
                  <option key={n} value={n}>
                    {n} dias
                  </option>
                ))}
                <option value={0}>Até esvaziar à mão</option>
              </Selecao>
            </Linha>
            <Linha rotulo="Histórico de senhas" descricao="Senhas anteriores guardadas por registo (cifradas como tudo o resto).">
              <Selecao aria-label="Senhas anteriores" value={d.cofre.maxHistorico} onChange={(e) => void guardarCofre({ maxHistorico: Number(e.target.value) })} className="w-40">
                {[0, 3, 5, 10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'Não guardar' : `${n} anteriores`}
                  </option>
                ))}
              </Selecao>
            </Linha>
          </Grupo>

          <Grupo id="aplicacao" icone={<Monitor />} titulo="Aplicação">
            <Linha rotulo="Ao fechar a janela" descricao="Em ambos os casos o cofre fica bloqueado.">
              <Segmentado rotulo="Ao fechar" idAnimacao="aoFechar" valor={config.aoFechar} aoMudar={(aoFechar) => void mudarConfig({ aoFechar })} opcoes={[{ valor: 'sair', texto: 'Sair' }, { valor: 'minimizar', texto: 'Minimizar' }]} className="w-56" />
            </Linha>
            <Interruptor rotulo="Iniciar com o Windows" descricao="Arranca sempre bloqueado." ligado={config.iniciarComSistema} aoMudar={(v) => void mudarConfig({ iniciarComSistema: v })} />
            <Linha rotulo="Atalhos de teclado">
              <Botao variante="escuro" tamanho="sm" icone={<Keyboard />} onClick={() => useAjuda.getState().abrir('atalhos')}>
                Ver atalhos
              </Botao>
            </Linha>
            <Linha rotulo="Versão" descricao="Sem atualizações automáticas: as versões novas instalam-se à mão a partir das Releases do GitHub (com o SHA-256 para confirmar).">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-text">
                <Archive className="size-4 text-faint" aria-hidden="true" />
                {useSessao.getState().app?.versao}
              </span>
            </Linha>
            <Linha rotulo="Sobre">
              <Botao variante="fantasma" tamanho="sm" icone={<Info />} onClick={() => useAjuda.getState().abrir('sobre')}>
                Sobre o LisSecurity
              </Botao>
            </Linha>
          </Grupo>
        </div>
      </div>

      <AlterarSenha aberto={modal === 'senha'} aoFechar={() => setModal(null)} />
      <Reforcar aberto={modal === 'reforcar'} aoFechar={() => setModal(null)} atual={`${d.kdfMemoriaMib} MiB × ${d.kdfIteracoes}`} />
    </div>
  )
}

function Grupo({ id, icone, titulo, children }: { id: string; icone: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <section id={`def-${id}`} className="scroll-mt-6">
      <h2 className="mb-3.5 flex items-center gap-2.5 text-[15px] font-bold">
        <span className="h-4 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span className="[&_svg]:size-4 [&_svg]:text-faint">{icone}</span>
        {titulo}
      </h2>
      <Cartao className="divide-y divide-border/60 px-5">{children}</Cartao>
    </section>
  )
}

function Linha({ rotulo, descricao, children }: { rotulo: string; descricao?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-text">{rotulo}</p>
        {descricao && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{descricao}</div>}
      </div>
      {children}
    </div>
  )
}

const NIVEIS = [
  { valor: 'normal', titulo: 'Normal', texto: '≈ 0,75 s a abrir · 128 MiB' },
  { valor: 'forte', titulo: 'Forte', texto: '≈ 1,5 s a abrir · 128 MiB' },
  { valor: 'maxima', titulo: 'Máxima', texto: '≈ 3 s a abrir · 256 MiB' },
] as const

/** Volta a cifrar o cofre com um Argon2id mais (ou menos) pesado, calibrado neste PC. */
function Reforcar({ aberto, aoFechar, atual }: { aberto: boolean; aoFechar: () => void; atual: string }) {
  const [nivel, setNivel] = useState<'normal' | 'forte' | 'maxima'>('forte')
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
  const aplicar = async (e: React.FormEvent) => {
    e.preventDefault()
    setATrabalhar(true)
    setErro(null)
    try {
      const k = await api.reforcarProtecao(senha, nivel)
      setSenha('')
      avisar('sucesso', 'Proteção atualizada.')
      useSessao.getState().mudou()
      if (k) setChave(k)
      else fechar()
    } catch (err) {
      if (descartado(err)) return
      setErro(err instanceof ErroIpc && err.codigo === 'credencial' ? 'A senha mestra não está correta.' : erroParaTexto(err))
    } finally {
      setATrabalhar(false)
    }
  }
  return (
    <Modal aberto={aberto} aoFechar={fechar} titulo={chave ? 'Nova chave de recuperação' : 'Reforçar a proteção da senha mestra'} largura="max-w-md" fecharComFundo={false}>
      {chave ? (
        <MostrarChaveRecuperacao chave={chave} aoConcluir={fechar} textoBotao="Concluir" />
      ) : (
        <form onSubmit={aplicar} className="space-y-4">
          <p className="text-[13px] leading-relaxed text-muted">
            Quanto mais pesado o Argon2id, mais caro fica para quem copie o ficheiro tentar adivinhar a senha — e mais demora a abrir o cofre. Agora: <span className="font-semibold text-text">{atual}</span>.
          </p>
          <div className="grid gap-2" role="radiogroup" aria-label="Nível">
            {NIVEIS.map((n) => (
              <button
                key={n.valor}
                type="button"
                role="radio"
                aria-checked={nivel === n.valor}
                onClick={() => setNivel(n.valor)}
                className={cn('flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors', nivel === n.valor ? 'border-accent/45 bg-accent-soft/60' : 'border-border bg-raised hover:border-border-strong')}
              >
                <span className="text-[13.5px] font-semibold text-text">{n.titulo}</span>
                <span className="text-[12px] text-muted">{n.texto}</span>
              </button>
            ))}
          </div>
          <CampoSenha rotulo="Senha mestra" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
          <Aviso tom="neutro">O cofre é cifrado de novo (com chave nova). Se tinhas chave de recuperação, é gerada uma nova. Faz uma cópia de segurança depois.</Aviso>
          {erro && <Aviso tom="vermelho">{erro}</Aviso>}
          <div className="flex justify-end gap-2">
            <Botao variante="fantasma" onClick={fechar}>
              Cancelar
            </Botao>
            <Botao type="submit" carregando={aTrabalhar} disabled={!senha}>
              Aplicar
            </Botao>
          </div>
          {aTrabalhar && <p className="text-center text-[11.5px] text-faint">A medir este computador e a cifrar de novo…</p>}
        </form>
      )}
    </Modal>
  )
}
