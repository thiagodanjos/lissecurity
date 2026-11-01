import { describe, expect, it } from 'vitest'
import {
  agrupar4,
  cnpjValido,
  cpfValido,
  detetarBandeira,
  estadoValidade,
  formatarValidade,
  haQuanto,
  luhn,
  mascararIdentificacao,
  validarBic,
  validarIban,
  validarNumeroCartao,
  validarPix,
  validarValidade,
} from './formatos'

// Todos os números abaixo são exemplos públicos de documentação/teste, não dados reais.
describe('IBAN', () => {
  it('aceita IBANs de exemplo válidos', () => {
    for (const iban of ['PT50 0002 0123 1234 5678 9015 4', 'DE89370400440532013000', 'GB82WEST12345698765432', 'BR1800360305000010009795493C1']) {
      expect(validarIban(iban)?.ok).toBe(true)
    }
  })
  it('recusa dígito de controlo errado e comprimento errado', () => {
    expect(validarIban('PT50000201231234567890155')?.ok).toBe(false)
    expect(validarIban('PT5000020123123456789015')?.ok).toBe(false)
    expect(validarIban('12345')?.ok).toBe(false)
    expect(validarIban('')).toBeNull()
  })
  it('avisa que formato válido não prova a conta', () => {
    const r = validarIban('PT50000201231234567890154')
    expect(r && r.ok && r.aviso).toMatch(/não confirma/)
  })
})

describe('BIC', () => {
  it('8 ou 11 caracteres', () => {
    expect(validarBic('CGDIPTPL')?.ok).toBe(true)
    expect(validarBic('CGDIPTPLXXX')?.ok).toBe(true)
    expect(validarBic('CGDIPT')?.ok).toBe(false)
  })
})

describe('cartões', () => {
  it('Luhn e bandeira', () => {
    expect(luhn('4111111111111111')).toBe(true)
    expect(luhn('4111111111111112')).toBe(false)
    expect(validarNumeroCartao('4111 1111 1111 1111')?.ok).toBe(true)
    expect(validarNumeroCartao('4111 1111 1111 1112')?.ok).toBe(false)
    expect(validarNumeroCartao('41a1')?.ok).toBe(false)
    expect(detetarBandeira('4111111111111111')).toBe('Visa')
    expect(detetarBandeira('5555555555554444')).toBe('Mastercard')
    expect(detetarBandeira('2223003122003222')).toBe('Mastercard')
    expect(detetarBandeira('378282246310005')).toBe('American Express')
    expect(detetarBandeira('6362970000457013')).toBe('Elo')
  })
  it('validade', () => {
    const agora = new Date(2026, 9, 31)
    expect(estadoValidade('09/26', agora)).toBe('expirado')
    expect(estadoValidade('10/26', agora)).toBe('a-expirar')
    expect(estadoValidade('12/26', agora)).toBe('a-expirar')
    expect(estadoValidade('01/27', agora)).toBe('valido')
    expect(estadoValidade('13/27', agora)).toBeNull()
    expect(validarValidade('1/2030')?.ok).toBe(true)
    expect(validarValidade('2030')?.ok).toBe(false)
    expect(formatarValidade('0829')).toBe('08/29')
  })
})

describe('Pix', () => {
  it('CPF e CNPJ de exemplo', () => {
    expect(cpfValido('529.982.247-25')).toBe(true)
    expect(cpfValido('111.111.111-11')).toBe(false)
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjValido('11.222.333/0001-82')).toBe(false)
  })
  it('telefone, e-mail e aleatória', () => {
    expect(validarPix('telefone', '+55 11 91234-5678')?.ok).toBe(true)
    expect(validarPix('telefone', '912345678')?.ok).toBe(false)
    expect(validarPix('email', 'pessoa@exemplo.invalid')?.ok).toBe(true)
    expect(validarPix('aleatoria', '123e4567-e89b-12d3-a456-426614174000')?.ok).toBe(true)
    expect(validarPix('aleatoria', 'xyz')?.ok).toBe(false)
  })
})

describe('apresentação', () => {
  it('agrupa e mascara', () => {
    expect(agrupar4('pt50000201231234567890154')).toBe('PT50 0002 0123 1234 5678 9015 4')
    expect(mascararIdentificacao('thiago@exemplo.pt')).toBe('th•••@exemplo.pt')
    expect(mascararIdentificacao('ana')).toBe('an•••')
    expect(mascararIdentificacao('')).toBe('')
  })
  it('tempo relativo', () => {
    const agora = 1_000_000_000_000
    expect(haQuanto(agora - 10_000, agora)).toBe('agora mesmo')
    expect(haQuanto(agora - 5 * 60_000, agora)).toBe('há 5 min')
    expect(haQuanto(agora - 86_400_000, agora)).toBe('ontem')
    expect(haQuanto(agora - 3 * 86_400_000, agora)).toBe('há 3 dias')
  })
})
