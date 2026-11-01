import { useEffect, useState } from 'react'
import { CheckCircle2, FileSpreadsheet, FileWarning, Trash2, Upload } from 'lucide-react'
import { api, descartado } from '@/lib/ipc'
import { useSessao } from '@/lib/sessao'
import type { Importacao, PreviaSenhas } from '@/lib/tipos'
import { plural } from '@/lib/formatos'
import { avisar, erroParaTexto } from './avisos'
import { Aviso, Botao, Modal } from './ui'

const FONTES_SENHAS = [
  ['Chrome / Edge / Brave', 'Definições → Palavras-passe → ⋮ → Exportar palavras-passe'],
  ['Firefox', 'about:logins → ⋯ → Exportar credenciais'],
  ['Bitwarden', 'Ferramentas → Exportar cofre → .csv'],
  ['LastPass, 1Password, KeePassXC', 'Exportar → CSV (com a linha de cabeçalho)'],
]

/** Importar senhas (CSV de outro gestor/navegador) ou um extrato bancário (CSV). */
export function Importar() {
  const tipo = useSessao((s) => s.importarAberto)
  const fechar = () => useSessao.getState().abrirImportar(null)
  return (
    <Modal
      aberto={tipo !== null}
      aoFechar={fechar}
      titulo={tipo === 'extrato' ? 'Importar extrato bancário' : 'Importar senhas'}
      largura="max-w-lg"
      fecharComFundo={false}
    >
      {tipo === 'senhas' && <ImportarSenhas aoFechar={fechar} />}
      {tipo === 'extrato' && <ImportarExtrato aoFechar={fechar} />}
    </Modal>
  )
}

function ApagarCsv({ caminho }: { caminho: string }) {
  const [apagado, setApagado] = useState(false)
  if (apagado)
    return (
      <Aviso tom="verde" icone={<CheckCircle2 />}>
        O ficheiro CSV foi apagado. (Num SSD, pode ainda ser recuperável com ferramentas especiais — esvazia também a reciclagem se o tiveres lá.)
      </Aviso>
    )
  return (
    <Aviso tom="ambar" icone={<FileWarning />}>
      <p>
        O ficheiro <strong>{caminho.split(/[\\/]/).pop()}</strong> tem as senhas em texto simples. Agora que estão no cofre, apaga-o.
      </p>
      <Botao
        variante="perigo"
        tamanho="sm"
        className="mt-2.5"
        icone={<Trash2 />}
        onClick={async () => {
          try {
            await api.apagarFicheiroImportado(caminho)
            setApagado(true)
          } catch (e) {
            if (descartado(e)) return
            avisar('erro', erroParaTexto(e))
          }
        }}
      >
        Apagar o ficheiro CSV
      </Botao>
    </Aviso>
  )
}

function ImportarSenhas({ aoFechar }: { aoFechar: () => void }) {
  const [caminho, setCaminho] = useState<string | null>(null)
  const [previa, setPrevia] = useState<PreviaSenhas | null>(null)
  const [resultado, setResultado] = useState<Importacao | null>(null)
  const [aTrabalhar, setATrabalhar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const escolher = async () => {
    setErro(null)
    try {
      const c = await api.escolherCsv('Escolhe o CSV com as senhas exportadas')
      if (!c) return
      setCaminho(c)
      setPrevia(null)
      setATrabalhar(true)
      setPrevia(await api.preVisualizarSenhas(c))
    } catch (e) {
      if (descartado(e)) return
      setErro(erroParaTexto(e))
    } finally {
      setATrabalhar(false)
    }
  }

  const importar = async () => {
    if (!caminho) return
    setATrabalhar(true)
    try {
      setResultado(await api.importarSenhas(caminho))
      useSessao.getState().mudou()
    } catch (e) {
      if (descartado(e)) return
      setErro(erroParaTexto(e))
    } finally {
      setATrabalhar(false)
    }
  }

  if (resultado && caminho) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center py-2 text-center">
          <CheckCircle2 className="mb-2 size-10 text-accent" aria-hidden="true" />
          <p className="text-[16px] font-bold">{plural(resultado.novos, 'senha importada', 'senhas importadas')}</p>
          <p className="mt-1 text-[12.5px] text-muted">
            {resultado.duplicados > 0 && `${plural(resultado.duplicados, 'já existia', 'já existiam')} e ${resultado.duplicados === 1 ? 'foi saltada' : 'foram saltadas'}. `}
            Ficaram com a etiqueta #importado.
          </p>
        </div>
        <ApagarCsv caminho={caminho} />
        <Botao largo onClick={aoFechar}>
          Concluir
        </Botao>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-muted">Exporta as senhas para um ficheiro CSV no programa onde estão agora e escolhe-o aqui:</p>
      <ul className="space-y-1.5 rounded-xl border border-border bg-raised p-3.5 text-[12px]">
        {FONTES_SENHAS.map(([nome, como]) => (
          <li key={nome} className="flex gap-2">
            <span className="w-36 shrink-0 font-semibold text-text">{nome}</span>
            <span className="text-muted">{como}</span>
          </li>
        ))}
      </ul>
      <Botao variante="escuro" largo icone={<FileSpreadsheet />} onClick={escolher} carregando={aTrabalhar && !previa}>
        {caminho ? 'Escolher outro ficheiro' : 'Escolher o ficheiro CSV'}
      </Botao>
      {previa && (
        <div className="rounded-xl border border-accent/25 bg-accent-soft/40 p-4 text-[13px]">
          <p className="font-semibold text-text">Formato reconhecido: {previa.formato}</p>
          <p className="mt-1 text-muted">
            {plural(previa.novos, 'registo novo', 'registos novos')}
            {previa.duplicados > 0 && ` · ${plural(previa.duplicados, 'repetido', 'repetidos')} (saltados)`}
            {previa.ignorados > 0 && ` · ${plural(previa.ignorados, 'linha ignorada', 'linhas ignoradas')}`}
          </p>
          {previa.amostra.length > 0 && <p className="mt-2 truncate text-[12px] text-faint">Por exemplo: {previa.amostra.join(', ')}</p>}
        </div>
      )}
      {erro && <Aviso tom="vermelho">{erro}</Aviso>}
      {previa && (
        <Botao largo tamanho="lg" icone={<Upload />} onClick={importar} carregando={aTrabalhar} disabled={previa.novos === 0}>
          {previa.novos === 0 ? 'Nada de novo para importar' : `Importar ${plural(previa.novos, 'senha', 'senhas')}`}
        </Botao>
      )}
    </div>
  )
}

function ImportarExtrato({ aoFechar }: { aoFechar: () => void }) {
  const [caminho, setCaminho] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Importacao | null>(null)
  const [aTrabalhar, setATrabalhar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => setErro(null), [caminho])

  const escolherEImportar = async () => {
    setErro(null)
    try {
      const c = await api.escolherCsv('Escolhe o extrato (CSV)')
      if (!c) return
      setCaminho(c)
      setATrabalhar(true)
      setResultado(await api.importarExtrato(c))
      useSessao.getState().mudou()
    } catch (e) {
      if (descartado(e)) return
      setErro(erroParaTexto(e))
    } finally {
      setATrabalhar(false)
    }
  }

  if (resultado) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center py-2 text-center">
          <CheckCircle2 className="mb-2 size-10 text-accent" aria-hidden="true" />
          <p className="text-[16px] font-bold">{plural(resultado.novos, 'movimento importado', 'movimentos importados')}</p>
          <p className="mt-1 text-[12.5px] text-muted">
            Origem: {resultado.origem}
            {resultado.duplicados > 0 && ` · ${plural(resultado.duplicados, 'já estava', 'já estavam')} no cofre`}
            {resultado.ignorados > 0 && ` · ${plural(resultado.ignorados, 'pendente ou anulado ignorado', 'pendentes ou anulados ignorados')}`}
          </p>
        </div>
        {caminho && (
          <Aviso tom="neutro">
            O extrato original continua em <span className="mono break-all">{caminho}</span>. Se não precisares dele, apaga-o — os movimentos já estão cifrados no cofre.
          </Aviso>
        )}
        <Botao largo onClick={aoFechar}>
          Ver os gastos
        </Botao>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-muted">
        O Revolut não permite ligar uma conta pessoal a aplicações como esta. O que dá para fazer — sem dar a ninguém acesso ao banco — é exportar o extrato e importá-lo aqui. Fica cifrado no cofre e a análise é feita neste computador.
      </p>
      <ol className="list-decimal space-y-1 rounded-xl border border-border bg-raised p-3.5 pl-8 text-[12.5px] text-muted">
        <li>Na app do Revolut: toca na conta → <strong className="text-text">…</strong> → <strong className="text-text">Extrato</strong>.</li>
        <li>
          Escolhe o formato <strong className="text-text">Excel</strong> (é um ficheiro .csv) e o período.
        </li>
        <li>Envia o ficheiro para o computador e escolhe-o abaixo. Podes importar todos os meses — os repetidos são saltados.</li>
      </ol>
      <p className="text-[11.5px] text-faint">Outros bancos: qualquer CSV com colunas de data, descrição e valor.</p>
      {erro && <Aviso tom="vermelho">{erro}</Aviso>}
      <Botao largo tamanho="lg" icone={<FileSpreadsheet />} onClick={escolherEImportar} carregando={aTrabalhar}>
        Escolher o extrato e importar
      </Botao>
    </div>
  )
}
