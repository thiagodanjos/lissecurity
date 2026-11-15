import { describe, expect, it } from 'vitest'
import { margemCss, passoVoltar } from './movel'

const base = { abertosPorCima: 0, fase: 'desbloqueado', editor: false, importar: false, pagina: 'senhas' }

describe('botão voltar do Android', () => {
  it('fecha primeiro o que está por cima (diálogo, folha, detalhe)', () => {
    expect(passoVoltar({ ...base, abertosPorCima: 2, editor: true })).toBe('fechar-por-cima')
  })
  it('depois o editor, a importação e só então volta ao início', () => {
    expect(passoVoltar({ ...base, editor: true, importar: true })).toBe('fechar-editor')
    expect(passoVoltar({ ...base, importar: true })).toBe('fechar-importar')
    expect(passoVoltar(base)).toBe('inicio')
  })
  it('no início manda a app para trás em vez de a fechar', () => {
    expect(passoVoltar({ ...base, pagina: 'inicio' })).toBe('segundo-plano')
  })
  it('com o cofre bloqueado nunca navega dentro do cofre', () => {
    expect(passoVoltar({ ...base, fase: 'bloqueado', editor: true, pagina: 'gastos' })).toBe('segundo-plano')
  })
})

describe('margens do sistema com zoom', () => {
  it('divide pelo zoom para continuar encostado às barras', () => {
    expect(margemCss(48, 1)).toBe('48px')
    expect(margemCss(48, 1.25)).toBe('38.4px')
    expect(margemCss(24, 1.5)).toBe('16px')
  })
  it('ignora valores inválidos', () => {
    expect(margemCss(-3, 1)).toBe('0px')
    expect(margemCss(30, 0)).toBe('30px')
  })
})
