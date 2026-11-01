import { create } from 'zustand'
import { ShieldCheck } from 'lucide-react'
import { useSessao } from '@/lib/sessao'
import { Kbd, Marca, Modal } from './ui'

export const useAjuda = create<{ aberto: 'atalhos' | 'sobre' | null; abrir: (q: 'atalhos' | 'sobre') => void; fechar: () => void }>((set) => ({
  aberto: null,
  abrir: (aberto) => set({ aberto }),
  fechar: () => set({ aberto: null }),
}))

const ATALHOS: [string, string][] = [
  ['Ctrl + L', 'Bloquear o cofre já'],
  ['Ctrl + K', 'Pesquisar páginas, ações e registos'],
  ['Ctrl + F', 'Procurar no cofre'],
  ['Ctrl + N', 'Novo registo (do tipo da página aberta)'],
  ['Ctrl + G', 'Gerador de senhas'],
  ['Ctrl + B', 'Mostrar ou ocultar a barra lateral'],
  ['Ctrl + S', 'Guardar o registo em edição'],
  ['Esc', 'Fechar a janela ou o painel aberto'],
  ['↑ ↓  Enter', 'Navegar nas listas e na paleta'],
  ['F1', 'Esta lista de atalhos'],
]

export function Ajuda() {
  const { aberto, fechar } = useAjuda()
  const versao = useSessao((s) => s.app?.versao)
  return (
    <>
      <Modal aberto={aberto === 'atalhos'} aoFechar={fechar} titulo="Atalhos de teclado" largura="max-w-md">
        <ul className="space-y-1">
          {ATALHOS.map(([tecla, texto]) => (
            <li key={tecla} className="flex items-center justify-between gap-4 rounded-lg px-1 py-1.5 text-[13px]">
              <span className="text-muted">{texto}</span>
              <Kbd className="shrink-0 text-[11px]">{tecla}</Kbd>
            </li>
          ))}
        </ul>
      </Modal>
      <Modal aberto={aberto === 'sobre'} aoFechar={fechar} titulo="Sobre o LisSecurity" largura="max-w-md">
        <div className="flex flex-col items-center pb-2 text-center">
          <Marca tamanho="lg" />
          <p className="mt-3 text-[12.5px] text-faint">Versão {versao ?? '—'} · da família LisFilms</p>
          <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-muted">
            O teu cofre pessoal de senhas, dados bancários, cartões e notas. Tudo fica cifrado neste computador e funciona sem internet.
          </p>
          <div className="mt-5 w-full space-y-2 rounded-xl border border-border bg-raised p-4 text-left text-[12.5px] text-muted">
            <p className="flex items-center gap-2 font-semibold text-text">
              <ShieldCheck className="size-4 text-accent" aria-hidden="true" /> Como está protegido
            </p>
            <p>Senha mestra → Argon2id (calibrado para este computador) → chave que abre a chave do cofre.</p>
            <p>Registos, definições, lixo e históricos → um único bloco cifrado com XChaCha20-Poly1305 (cifra autenticada).</p>
            <p>Sem contas online, sem telemetria, sem sincronização.</p>
          </div>
        </div>
      </Modal>
    </>
  )
}
