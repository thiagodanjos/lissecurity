// Validações de FORMATO (não de existência): um IBAN com o dígito de controlo certo não quer
// dizer que a conta exista ou seja tua, e um número de cartão que passa no Luhn não quer
// dizer que o banco o tenha autorizado. As mensagens dizem isso mesmo.

export type Validacao = { ok: true; aviso?: string } | { ok: false; erro: string } | null

const soAlnum = (v: string) => v.replace(/[\s-]/g, '').toUpperCase()

/** Comprimento do IBAN por país (registo SWIFT, países mais comuns). */
const COMPRIMENTO_IBAN: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, BR: 29, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24,
  FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20,
  LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24,
  SM: 27, AO: 25, MZ: 25, CV: 25, ST: 25,
}

function mod97(numero: string): number {
  let resto = 0
  for (const c of numero) resto = (resto * 10 + Number(c)) % 97
  return resto
}

export function validarIban(valor: string): Validacao {
  const v = soAlnum(valor)
  if (!v) return null
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(v)) return { ok: false, erro: 'Um IBAN começa por duas letras do país e dois dígitos (ex.: PT50…).' }
  const esperado = COMPRIMENTO_IBAN[v.slice(0, 2)]
  if (esperado && v.length !== esperado) {
    return { ok: false, erro: `Um IBAN de ${v.slice(0, 2)} tem ${esperado} caracteres; este tem ${v.length}.` }
  }
  if (v.length < 15 || v.length > 34) return { ok: false, erro: 'O IBAN tem entre 15 e 34 caracteres.' }
  const rearranjado = v.slice(4) + v.slice(0, 4)
  const numerico = rearranjado.replace(/[A-Z]/g, (l) => String(l.charCodeAt(0) - 55))
  if (mod97(numerico) !== 1) return { ok: false, erro: 'Os dígitos de controlo não batem certo — confirma se há algum erro de escrita.' }
  return { ok: true, aviso: 'Formato válido. Isto não confirma que a conta existe nem a quem pertence.' }
}

export function validarBic(valor: string): Validacao {
  const v = soAlnum(valor)
  if (!v) return null
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v)) {
    return { ok: false, erro: 'O BIC/SWIFT tem 8 ou 11 caracteres: 4 letras do banco, 2 do país e 2 (+3) de localização.' }
  }
  return { ok: true }
}

export function luhn(digitos: string): boolean {
  let soma = 0
  let dobrar = false
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = Number(digitos[i])
    if (dobrar) {
      d *= 2
      if (d > 9) d -= 9
    }
    soma += d
    dobrar = !dobrar
  }
  return soma % 10 === 0
}

export const BANDEIRAS = ['Visa', 'Mastercard', 'American Express', 'Maestro', 'Elo', 'Hipercard', 'Discover', 'Diners Club', 'JCB', 'UnionPay', 'Multibanco', 'Outra'] as const

/** Bandeira provável pelo prefixo (só para sugerir; a pessoa pode escolher outra). */
export function detetarBandeira(numero: string): string | null {
  const n = numero.replace(/\D/g, '')
  if (!n) return null
  if (/^(4011(78|79)|43(1274|8935)|45(1416|7393|763(1|2))|50(4175|6699|67[0-7][0-9]|9[0-9]{3})|627780|63(6297|6368)|650(0[3-9]|[1-4][0-9]|5[0-1])|6516(5[2-9]|[6-7][0-9])|6550([0-1][0-9]|2[1-9]|[3-4][0-9]|5[0-8]))/.test(n)) return 'Elo'
  if (/^(606282|3841)/.test(n)) return 'Hipercard'
  if (/^4/.test(n)) return 'Visa'
  if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/.test(n)) return 'Mastercard'
  if (/^3[47]/.test(n)) return 'American Express'
  if (/^(6011|65|64[4-9])/.test(n)) return 'Discover'
  if (/^3(0[0-5]|[68])/.test(n)) return 'Diners Club'
  if (/^35(2[89]|[3-8])/.test(n)) return 'JCB'
  if (/^62/.test(n)) return 'UnionPay'
  if (/^(50|5[6-9]|6)/.test(n)) return 'Maestro'
  return null
}

export function validarNumeroCartao(valor: string): Validacao {
  const n = valor.replace(/[\s-]/g, '')
  if (!n) return null
  if (!/^\d+$/.test(n)) return { ok: false, erro: 'O número do cartão só tem algarismos.' }
  if (n.length < 12 || n.length > 19) return { ok: false, erro: 'Um número de cartão tem entre 12 e 19 algarismos.' }
  if (!luhn(n)) return { ok: false, erro: 'O algarismo de controlo não bate certo — confirma se há algum erro de escrita.' }
  return { ok: true, aviso: 'Estrutura válida. Isto não confirma que o cartão está ativo ou autorizado.' }
}

/** "MM/AA" ou "MM/AAAA" → { mes, ano } */
export function lerValidade(v: string): { mes: number; ano: number } | null {
  const m = v.trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/)
  if (!m) return null
  const mes = Number(m[1])
  const ano = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
  if (mes < 1 || mes > 12) return null
  return { mes, ano }
}

export function estadoValidade(v: string, agora = new Date()): 'valido' | 'a-expirar' | 'expirado' | null {
  const d = lerValidade(v)
  if (!d) return null
  const meses = (d.ano - agora.getFullYear()) * 12 + (d.mes - (agora.getMonth() + 1))
  if (meses < 0) return 'expirado'
  if (meses <= 2) return 'a-expirar'
  return 'valido'
}

export function validarValidade(v: string): Validacao {
  if (!v.trim()) return null
  if (!lerValidade(v)) return { ok: false, erro: 'Escreve a validade como MM/AA (ex.: 08/29).' }
  if (estadoValidade(v) === 'expirado') return { ok: true, aviso: 'Este cartão já passou da validade.' }
  return { ok: true }
}

/** Formata enquanto se escreve: "0829" → "08/29". */
export function formatarValidade(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

export function cpfValido(v: string): boolean {
  const d = v.replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const calc = (n: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
}

export function cnpjValido(v: string): boolean {
  const d = v.replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const calc = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const s = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
}

export function validarPix(tipo: string, valor: string): Validacao {
  const v = valor.trim()
  if (!v) return null
  switch (tipo) {
    case 'cpf':
      return cpfValido(v) ? { ok: true } : { ok: false, erro: 'CPF com dígitos verificadores inválidos.' }
    case 'cnpj':
      return cnpjValido(v) ? { ok: true } : { ok: false, erro: 'CNPJ com dígitos verificadores inválidos.' }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { ok: true } : { ok: false, erro: 'E-mail com formato inválido.' }
    case 'telefone':
      return /^\+55\d{10,11}$/.test(v.replace(/[\s()-]/g, ''))
        ? { ok: true }
        : { ok: false, erro: 'Telefone Pix no formato +55 DDD número (ex.: +55 11 91234-5678).' }
    case 'aleatoria':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
        ? { ok: true }
        : { ok: false, erro: 'A chave aleatória tem o formato 8-4-4-4-12 (letras a–f e algarismos).' }
    default:
      return null
  }
}

/** Grupos de 4 para ler IBANs e números de cartão. */
export const agrupar4 = (v: string) => soAlnum(v).replace(/(.{4})(?=.)/g, '$1 ')

/** "thiago.anjos@gmail.com" → "th•••@gmail.com"; "utilizador" → "ut•••" */
export function mascararIdentificacao(v: string): string {
  if (!v) return ''
  const [nome, dominio] = v.split('@')
  const curto = nome.length <= 2 ? nome[0] ?? '' : nome.slice(0, 2)
  return dominio !== undefined ? `${curto}•••@${dominio}` : `${curto}•••`
}

// ───────── datas e números em português de Portugal ─────────

const fmtData = new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' })
const fmtDataHora = new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const data = (ms: number) => fmtData.format(new Date(ms))
export const dataHora = (ms: number) => fmtDataHora.format(new Date(ms))

export function haQuanto(ms: number, agora = Date.now()): string {
  const s = Math.max(0, Math.round((agora - ms) / 1000))
  if (s < 60) return 'agora mesmo'
  const min = Math.round(s / 60)
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  if (d === 1) return 'ontem'
  if (d < 30) return `há ${d} dias`
  const m = Math.round(d / 30)
  if (m < 12) return m === 1 ? 'há 1 mês' : `há ${m} meses`
  const a = Math.round(m / 12)
  return a === 1 ? 'há 1 ano' : `há ${a} anos`
}

export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

export const PAISES: { codigo: string; nome: string; moeda: string; modelo: 'iban' | 'br' | 'us' | 'outro' }[] = [
  { codigo: 'PT', nome: 'Portugal', moeda: 'EUR', modelo: 'iban' },
  { codigo: 'BR', nome: 'Brasil', moeda: 'BRL', modelo: 'br' },
  { codigo: 'ES', nome: 'Espanha', moeda: 'EUR', modelo: 'iban' },
  { codigo: 'FR', nome: 'França', moeda: 'EUR', modelo: 'iban' },
  { codigo: 'DE', nome: 'Alemanha', moeda: 'EUR', modelo: 'iban' },
  { codigo: 'IT', nome: 'Itália', moeda: 'EUR', modelo: 'iban' },
  { codigo: 'NL', nome: 'Países Baixos', moeda: 'EUR', modelo: 'iban' },
  { codigo: 'BE', nome: 'Bélgica', moeda: 'EUR', modelo: 'iban' },
  { codigo: 'LU', nome: 'Luxemburgo', moeda: 'EUR', modelo: 'iban' },
  { codigo: 'IE', nome: 'Irlanda', moeda: 'EUR', modelo: 'iban' },
  { codigo: 'GB', nome: 'Reino Unido', moeda: 'GBP', modelo: 'iban' },
  { codigo: 'CH', nome: 'Suíça', moeda: 'CHF', modelo: 'iban' },
  { codigo: 'AO', nome: 'Angola', moeda: 'AOA', modelo: 'iban' },
  { codigo: 'MZ', nome: 'Moçambique', moeda: 'MZN', modelo: 'iban' },
  { codigo: 'CV', nome: 'Cabo Verde', moeda: 'CVE', modelo: 'iban' },
  { codigo: 'US', nome: 'Estados Unidos', moeda: 'USD', modelo: 'us' },
  { codigo: '', nome: 'Outro país', moeda: '', modelo: 'outro' },
]

export const MOEDAS = ['EUR', 'BRL', 'USD', 'GBP', 'CHF', 'AOA', 'MZN', 'CVE', 'JPY', 'CAD']

export const TIPOS_CONTA: Record<string, string> = {
  corrente: 'Conta à ordem / corrente',
  poupanca: 'Poupança',
  pagamento: 'Conta de pagamento',
  salario: 'Conta salário',
  investimento: 'Investimento',
  outra: 'Outra',
}

export const TIPOS_PIX: Record<string, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  telefone: 'Telefone',
  aleatoria: 'Chave aleatória',
}

export const TIPOS_CARTAO: Record<string, string> = {
  credito: 'Crédito',
  debito: 'Débito',
  virtual: 'Virtual',
  prepago: 'Pré-pago',
}

export const TIPOS_NOTA: Record<string, string> = {
  nota: 'Nota',
  codigos: 'Códigos de recuperação',
  licenca: 'Chave de licença',
}
