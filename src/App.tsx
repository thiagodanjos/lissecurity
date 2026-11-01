import { useEffect } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { listen } from '@tauri-apps/api/event'
import { AlertOctagon } from 'lucide-react'
import { api, definirAoBloqueado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import { aplicarAparencia, bloquearAgora, movimentoReduzido, novoRegisto } from '@/lib/acoes'
import { BarraTitulo } from '@/componentes/barra-titulo'
import { Avisos, limparAvisos } from '@/componentes/avisos'
import { Ajuda, useAjuda } from '@/componentes/ajuda'
import { Paleta } from '@/componentes/paleta'
import { cancelarConfirmacao, Confirmacao } from '@/componentes/ui'
import { FundoLis } from '@/componentes/fundo'
import { Reautenticacao } from '@/componentes/reautenticacao'
import { Desbloqueio } from '@/ecras/Desbloqueio'
import { Arranque } from '@/ecras/Arranque'
import { NovaSenha } from '@/ecras/NovaSenha'
import { Shell } from '@/ecras/Shell'

/** Teclas do navegador que não fazem sentido numa app (e algumas que poderiam expor conteúdo). */
function teclaDoNavegador(e: KeyboardEvent): boolean {
  const k = e.key.toLowerCase()
  if (['f3', 'f5', 'f7', 'f12', 'browserback', 'browserforward'].includes(k)) return true
  if (e.ctrlKey && ['r', 'p', 'u', 'j', 'h', 'o', 'd', 'e', '+', '-', '=', '0'].includes(k)) return true
  if (e.ctrlKey && e.shiftKey && ['i', 'c', 'j', 'r', 'delete'].includes(k)) return true
  if (e.altKey && ['arrowleft', 'arrowright', 'home'].includes(k)) return true
  return false
}

export default function App() {
  const fase = useSessao((s) => s.fase)
  const config = useSessao((s) => s.config)
  const erroArranque = useSessao((s) => s.app?.erroArranque)

  // arranque: estado, aparência, mostrar a janela só depois da primeira pintura
  useEffect(() => {
    definirAoBloqueado(() => {
      const f = useSessao.getState().fase
      if (f === 'desbloqueado' || f === 'nova-senha') {
        cancelarConfirmacao()
        limparAvisos()
        useSessao.getState().bloquearLocal('sessao')
      }
    })
    api
      .estadoApp()
      .then(async (e) => {
        aplicarAparencia(e.config)
        useSessao.getState().carregar(e)
        // (com a janela ainda invisível não há requestAnimationFrame: basta deixar o React montar)
        await new Promise((r) => setTimeout(r, 40))
        await api.janelaPronta()
      })
      .catch(() => api.janelaPronta().catch(() => {}))

    // bloqueio decidido pela camada nativa (inatividade, suspensão, Windows, minimizar…)
    const desligar = listen<string>('lis://bloqueado', (e) => {
      const f = useSessao.getState().fase
      if (f === 'desbloqueado' || f === 'nova-senha') {
        cancelarConfirmacao()
        limparAvisos()
        useSessao.getState().bloquearLocal(e.payload)
      }
    })
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const aoMudarMovimento = () => aplicarAparencia(useSessao.getState().config)
    mq.addEventListener('change', aoMudarMovimento)
    return () => {
      void desligar.then((f) => f())
      mq.removeEventListener('change', aoMudarMovimento)
    }
  }, [])

  // atalhos globais
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (teclaDoNavegador(e)) {
        e.preventDefault()
        return
      }
      const s = useSessao.getState()
      const aberto = s.fase === 'desbloqueado'
      const k = e.key.toLowerCase()
      if (e.key === 'F1') {
        e.preventDefault()
        useAjuda.getState().abrir('atalhos')
        return
      }
      if (!aberto || !e.ctrlKey || e.altKey) return
      if (k === 'l') {
        e.preventDefault()
        bloquearAgora('atalho')
      } else if (k === 'k') {
        e.preventDefault()
        s.definirPaleta(!s.paletaAberta)
      } else if (k === 'g') {
        e.preventDefault()
        s.irPara('gerador')
      } else if (k === 'b') {
        e.preventDefault()
        s.alternarLateral()
      } else if (k === 'f') {
        e.preventDefault()
        document.getElementById('pesquisa-cofre')?.focus()
      } else if (k === 'n' && !s.editor) {
        e.preventDefault()
        novoRegisto(s.pagina === 'bancos' || s.pagina === 'financeiro' ? 'banco' : s.pagina === 'cartoes' ? 'cartao' : s.pagina === 'notas' ? 'nota' : 'login')
      }
    }
    // menu de contexto do navegador só nos campos de texto (copiar/colar)
    const contexto = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement
      if (!alvo.closest('input, textarea, .selecionavel')) e.preventDefault()
    }
    // arrastar ficheiros para a janela não navega para lado nenhum
    const largar = (e: DragEvent) => e.preventDefault()
    window.addEventListener('keydown', tecla)
    window.addEventListener('contextmenu', contexto)
    window.addEventListener('dragover', largar)
    window.addEventListener('drop', largar)
    return () => {
      window.removeEventListener('keydown', tecla)
      window.removeEventListener('contextmenu', contexto)
      window.removeEventListener('dragover', largar)
      window.removeEventListener('drop', largar)
    }
  }, [])

  return (
    <MotionConfig reducedMotion={movimentoReduzido(config) ? 'always' : 'never'}>
      <div className="flex h-full flex-col bg-sidebar">
        <BarraTitulo />
        {/* O conteúdo troca SEM animação de saída: ao bloquear, o cofre desaparece no mesmo frame. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {fase === 'desbloqueado' ? (
            <Shell />
          ) : (
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={fase} className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
                {fase === 'bloqueado' && <Desbloqueio />}
                {fase === 'sem-cofre' && <Arranque />}
                {fase === 'nova-senha' && <NovaSenha />}
                {fase === 'erro' && <ErroArranque mensagem={erroArranque ?? ''} />}
                {fase === 'a-carregar' && <div className="flex-1 bg-bg" />}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        <Paleta />
        <Confirmacao />
        <Reautenticacao />
        <Ajuda />
        <Avisos />
      </div>
    </MotionConfig>
  )
}

function ErroArranque({ mensagem }: { mensagem: string }) {
  return (
    <div className="relative flex flex-1 items-center justify-center bg-bg px-6">
      <FundoLis />
      <div className="relative max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sobreposicao">
        <AlertOctagon className="mx-auto mb-3 size-8 text-danger" aria-hidden="true" />
        <h1 className="text-[17px] font-bold">Não foi possível abrir o local do cofre</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{mensagem}</p>
        <p className="mt-3 text-[12px] text-faint">Fecha outras janelas do LisSecurity e volta a abrir a aplicação.</p>
      </div>
    </div>
  )
}
