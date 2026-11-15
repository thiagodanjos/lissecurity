// Simulador da camada nativa — SÓ para desenvolvimento (`npm run dev` com `?simular=android` ou
// `?simular=windows`). Responde aos comandos com um cofre FICTÍCIO em memória, para se ver e
// testar a interface num navegador (por exemplo, com o tamanho de um telemóvel) sem compilar a
// app. Nunca entra na compilação final: `main.tsx` só o importa com `import.meta.env.DEV`.
//
// Não imita a segurança (não cifra nada): é só uma maquete de dados para desenhar ecrãs.
// Parâmetros: ?simular=android|windows · &fase=sem-cofre|bloqueado|desbloqueado · &biometria=1

import { mockIPC } from '@tauri-apps/api/mocks'

type Obj = Record<string, unknown>

const q = new URLSearchParams(location.search)
const plataforma = q.get('simular') === 'windows' ? 'windows' : 'android'
const fase = q.get('fase') ?? 'desbloqueado'
const DIA = 86_400_000
const agora = Date.now()

let existe = fase !== 'sem-cofre'
let desbloqueado = fase === 'desbloqueado'
let biometriaAtiva = q.get('biometria') === '1'
let ultimoBackup: number | null = agora - 9 * DIA
let geracao = 1

const config = {
  caminhoCofre: null,
  animacoes: 'sistema',
  densidade: 'confortavel',
  tema: 'grafite',
  aoFechar: 'sair',
  iniciarComSistema: false,
  protegerCaptura: true,
  lateralRecolhida: false,
  zoom: 1,
  paginaInicial: 'inicio',
  cor: 'verde',
  contadoresLateral: true,
}

const definicoes = {
  bloqueioMinutos: 5,
  bloquearAoMinimizar: true,
  bloquearAoSuspender: true,
  bloquearComSistema: true,
  limparCopiaSegundos: 30,
  diasLixo: 30,
  maxHistorico: 10,
  ocultarReveladoSegundos: 30,
  reautenticarFinanceiro: true,
  limparAoBloquear: false,
  lembreteCopiaDias: 14,
}

const gerador = {
  modo: 'senha',
  comprimento: 20,
  maiusculas: true,
  minusculas: true,
  numeros: true,
  simbolos: true,
  evitarSemelhantes: true,
  palavras: 5,
  separador: '-',
  maiusculaInicial: true,
  incluirNumero: true,
}

let seq = 100
const novoId = () => `sim-${++seq}`

function login(titulo: string, url: string, utilizador: string, senha: string, extra: Obj = {}) {
  return {
    id: novoId(),
    titulo,
    favorito: false,
    categoria: '',
    etiquetas: [] as string[],
    notas: '',
    campos: [] as Obj[],
    criadoEm: agora - 120 * DIA,
    alteradoEm: agora - 3 * DIA,
    eliminadoEm: null as number | null,
    conteudo: { tipo: 'login', url, utilizador, email: '', senha, senhaAlteradaEm: agora - 40 * DIA, historico: [], totp: '' },
    ...extra,
  }
}

type Item = ReturnType<typeof login> & { conteudo: Obj }

const itens: Item[] = [
  login('Gmail', 'https://mail.google.com', 'ana.ficticia@exemplo.pt', 'Fr4se-Longa-Do-Correio!', { favorito: true, categoria: 'Pessoal', etiquetas: ['email'] }),
  login('GitHub', 'https://github.com', 'ana-dev', 'k9#Lq2vX!rP7zM4wT8sY', { favorito: true, categoria: 'Trabalho' }),
  login('Netflix', 'https://www.netflix.com', 'ana.ficticia@exemplo.pt', 'netflix123', { categoria: 'Lazer' }),
  login('Spotify', 'https://open.spotify.com', 'ana.ficticia', 'netflix123', { categoria: 'Lazer' }),
  login('Portal das Finanças', 'https://www.portaldasfinancas.gov.pt', '123456789', 'Ex3mplo-Fiscal-2026', { categoria: 'Estado' }),
  login('Router de casa', '192.168.1.1', 'admin', 'admin', { categoria: 'Casa', etiquetas: ['rede'] }),
  login('Amazon', 'https://www.amazon.es', 'ana.ficticia@exemplo.pt', 'Qp7!vB2#mK9$xL4w', { categoria: 'Compras' }),
  login('Discord', 'https://discord.com', 'ana_lis', 'Mesa-Azul-Rio-Faro-42', { categoria: 'Lazer' }),
  {
    ...login('Banco Exemplo — homebanking', 'https://www.bancoexemplo.pt', 'cliente 0012345', 'H0me!Banking#2026', { categoria: 'Banco' }),
    conteudo: { tipo: 'login', url: 'https://www.bancoexemplo.pt', utilizador: 'cliente 0012345', email: '', senha: 'H0me!Banking#2026', senhaAlteradaEm: agora - 400 * DIA, historico: [], totp: 'JBSWY3DPEHPK3PXP' },
  },
  {
    id: novoId(), titulo: 'Conta à ordem', favorito: true, categoria: '', etiquetas: [], notas: '', campos: [],
    criadoEm: agora - 300 * DIA, alteradoEm: agora - 30 * DIA, eliminadoEm: null,
    conteudo: { tipo: 'banco', banco: 'Banco Exemplo', titular: 'Ana Fictícia', pais: 'PT', moeda: 'EUR', tipoConta: 'Conta à ordem', agencia: '', numeroConta: '0012345678901', iban: 'PT50000201231234567890154', bic: 'EXMPPTPL', chavesPix: [], idAcesso: '12345678', credencialLigada: null },
  },
  {
    id: novoId(), titulo: 'Conta no Brasil', favorito: false, categoria: '', etiquetas: [], notas: '', campos: [],
    criadoEm: agora - 200 * DIA, alteradoEm: agora - 60 * DIA, eliminadoEm: null,
    conteudo: { tipo: 'banco', banco: 'Banco Fictício do Brasil', titular: 'Ana Fictícia', pais: 'BR', moeda: 'BRL', tipoConta: 'Conta corrente', agencia: '1234', numeroConta: '98765-4', iban: '', bic: '', chavesPix: [{ tipo: 'email', valor: 'ana.ficticia@exemplo.pt' }], idAcesso: '', credencialLigada: null },
  },
  {
    id: novoId(), titulo: 'Cartão de débito', favorito: false, categoria: '', etiquetas: [], notas: '', campos: [],
    criadoEm: agora - 300 * DIA, alteradoEm: agora - 30 * DIA, eliminadoEm: null,
    conteudo: { tipo: 'cartao', instituicao: 'Banco Exemplo', bandeira: 'Visa', titular: 'ANA FICTICIA', numero: '4111111111111111', validade: '08/28', tipoCartao: 'Débito', contaLigada: null },
  },
  {
    id: novoId(), titulo: 'Cartão de crédito', favorito: false, categoria: '', etiquetas: [], notas: '', campos: [],
    criadoEm: agora - 300 * DIA, alteradoEm: agora - 30 * DIA, eliminadoEm: null,
    conteudo: { tipo: 'cartao', instituicao: 'Banco Exemplo', bandeira: 'Mastercard', titular: 'ANA FICTICIA', numero: '5500000000000004', validade: '12/26', tipoCartao: 'Crédito', contaLigada: null },
  },
  {
    id: novoId(), titulo: 'Códigos de recuperação do Gmail', favorito: false, categoria: '', etiquetas: [], notas: '', campos: [],
    criadoEm: agora - 90 * DIA, alteradoEm: agora - 90 * DIA, eliminadoEm: null,
    conteudo: { tipo: 'nota', tipoNota: 'codigos', conteudo: '', codigos: [{ valor: '1234-5678', usado: true }, { valor: '2345-6789', usado: false }, { valor: '3456-7890', usado: false }] },
  },
  {
    id: novoId(), titulo: 'Wi-Fi de casa', favorito: false, categoria: '', etiquetas: [], notas: '', campos: [],
    criadoEm: agora - 50 * DIA, alteradoEm: agora - 50 * DIA, eliminadoEm: null,
    conteudo: { tipo: 'nota', tipoNota: 'texto', conteudo: 'Rede: Casa-Ficticia\nSenha: exemplo-de-wifi-2026', codigos: [] },
  },
] as Item[]

const tipoDe = (i: Item) => i.conteudo.tipo as string
const dominio = (url: string) => {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}
const mascarar = (v: unknown, fim = false) => {
  const s = String(v ?? '')
  return s ? { definido: true, ...(fim && s.length > 4 ? { fim: s.slice(-4) } : {}) } : { definido: false }
}

function resumo(i: Item): Obj {
  const c = i.conteudo as Obj
  const base: Obj = {
    id: i.id, tipo: tipoDe(i), titulo: i.titulo, favorito: i.favorito, categoria: i.categoria, etiquetas: i.etiquetas,
    criadoEm: i.criadoEm, alteradoEm: i.alteradoEm, eliminadoEm: i.eliminadoEm, subtitulo: '',
  }
  if (c.tipo === 'login') Object.assign(base, { subtitulo: c.utilizador || c.email, dominio: dominio(String(c.url)) })
  if (c.tipo === 'banco') Object.assign(base, { subtitulo: c.banco, instituicao: c.banco, fim: String(c.iban || c.numeroConta).slice(-4), moeda: c.moeda, pais: c.pais, tipoDetalhe: c.tipoConta })
  if (c.tipo === 'cartao') Object.assign(base, { subtitulo: c.instituicao, instituicao: c.instituicao, fim: String(c.numero).slice(-4), bandeira: c.bandeira, validade: c.validade, tipoDetalhe: c.tipoCartao })
  if (c.tipo === 'nota') Object.assign(base, { subtitulo: c.tipoNota === 'codigos' ? 'Códigos de recuperação' : 'Nota', tipoDetalhe: c.tipoNota, codigosPorUsar: (c.codigos as { usado: boolean }[]).filter((x) => !x.usado).length })
  return base
}

function vista(i: Item): Obj {
  const c = i.conteudo as Obj
  let conteudo: Obj
  if (c.tipo === 'login') conteudo = { tipo: 'login', url: c.url, utilizador: c.utilizador, email: c.email, senha: mascarar(c.senha), totp: mascarar(c.totp), senhaAlteradaEm: c.senhaAlteradaEm, historico: [] }
  else if (c.tipo === 'banco') conteudo = { tipo: 'banco', banco: c.banco, titular: c.titular, pais: c.pais, moeda: c.moeda, tipoConta: c.tipoConta, agencia: c.agencia, bic: c.bic, numeroConta: mascarar(c.numeroConta, true), iban: mascarar(c.iban, true), idAcesso: mascarar(c.idAcesso), chavesPix: (c.chavesPix as Obj[]).map((p) => ({ tipo: p.tipo, valor: mascarar(p.valor) })), credencialLigada: null }
  else if (c.tipo === 'cartao') conteudo = { tipo: 'cartao', instituicao: c.instituicao, bandeira: c.bandeira, titular: c.titular, validade: c.validade, tipoCartao: c.tipoCartao, numero: mascarar(c.numero, true), contaLigada: null }
  else conteudo = { tipo: 'nota', tipoNota: c.tipoNota, conteudo: mascarar(c.conteudo), codigos: (c.codigos as Obj[]).map((x) => ({ usado: x.usado, valor: mascarar(x.valor) })) }
  return { id: i.id, titulo: i.titulo, favorito: i.favorito, categoria: i.categoria, etiquetas: i.etiquetas, criadoEm: i.criadoEm, alteradoEm: i.alteradoEm, eliminadoEm: i.eliminadoEm, notas: mascarar(i.notas), campos: [], conteudo }
}

function revelar(i: Item, campo: string): string {
  const c = i.conteudo as Obj
  if (campo.startsWith('pix:')) return String((c.chavesPix as Obj[])[Number(campo.slice(4))]?.valor ?? '')
  if (campo.startsWith('codigo:')) return String((c.codigos as Obj[])[Number(campo.slice(7))]?.valor ?? '')
  if (campo === 'notas') return i.notas
  return String(c[campo] ?? '')
}

const ativos = () => itens.filter((i) => i.eliminadoEm === null)

function listar(consulta: Obj): Obj[] {
  const texto = String(consulta.texto ?? '').toLowerCase()
  let v = consulta.filtro === 'lixo' ? itens.filter((i) => i.eliminadoEm !== null) : ativos()
  if (consulta.tipo) v = v.filter((i) => tipoDe(i) === consulta.tipo)
  if (consulta.filtro === 'favoritos') v = v.filter((i) => i.favorito)
  if (consulta.categoria) v = v.filter((i) => i.categoria === consulta.categoria)
  if (consulta.etiqueta) v = v.filter((i) => i.etiquetas.includes(String(consulta.etiqueta)))
  if (texto) v = v.filter((i) => `${i.titulo} ${resumo(i).subtitulo}`.toLowerCase().includes(texto))
  const r = v.map(resumo)
  if (consulta.ordem === 'alterado') r.sort((a, b) => Number(b.alteradoEm) - Number(a.alteradoEm))
  else r.sort((a, b) => String(a.titulo).localeCompare(String(b.titulo), 'pt'))
  return r
}

function contagens(lista: string[]) {
  const m = new Map<string, number>()
  lista.filter(Boolean).forEach((x) => m.set(x, (m.get(x) ?? 0) + 1))
  return [...m].map(([nome, total]) => ({ nome, total })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
}

function visaoGeral(): Obj {
  const a = ativos()
  const conta = (t: string) => a.filter((i) => tipoDe(i) === t).length
  return {
    nome: 'Ana', total: a.length, logins: conta('login'), bancos: conta('banco'), cartoes: conta('cartao'), notas: conta('nota'),
    favoritosTotal: a.filter((i) => i.favorito).length, noLixo: itens.length - a.length,
    favoritos: a.filter((i) => i.favorito).map(resumo), recentes: [...a].sort((x, y) => y.alteradoEm - x.alteradoEm).slice(0, 5).map(resumo),
    fracas: 2, reutilizadas: 2, gruposReutilizados: 1, antigas: 1, cartoesExpirados: 0, cartoesAExpirar: 1,
    ultimoBackup, alteracoesPorSalvaguardar: true, copiasAutomaticas: false, lembreteCopiaDias: 14, totalMovimentos: movimentos.length,
  }
}

const CATEGORIAS: [string, string][] = [['supermercado', 'Supermercado'], ['restauracao', 'Restauração'], ['transportes', 'Transportes'], ['casa', 'Casa'], ['lazer', 'Lazer'], ['subscricoes', 'Subscrições'], ['salario', 'Salário'], ['outros', 'Outros']]
const movimentos = Array.from({ length: 60 }, (_, k) => {
  const d = new Date(agora - k * 1.6 * DIA)
  const lista: [string, number, string][] = [['Continente', -4210, 'supermercado'], ['Pingo Doce', -1875, 'supermercado'], ['Uber', -890, 'transportes'], ['Netflix', -1399, 'subscricoes'], ['Spotify', -799, 'subscricoes'], ['Café Central', -340, 'restauracao'], ['EDP', -6120, 'casa'], ['Cinema', -1450, 'lazer']]
  const [descricao, valor, categoria] = k === 7 ? ['Salário', 185000, 'salario'] as [string, number, string] : lista[k % lista.length]
  return { id: `mov-${k}`, data: d.getTime(), descricao, valor, moeda: 'EUR', tipo: 'Pagamento com cartão', categoria, origem: 'Revolut (exemplo)' }
})

function resumoGastos(args: Obj): Obj {
  const hoje = new Date(agora)
  const ano = Number(args.ano ?? hoje.getFullYear())
  const mes = Number(args.mes ?? hoje.getMonth() + 1)
  const doMes = movimentos.filter((m) => {
    const d = new Date(m.data)
    return d.getFullYear() === ano && d.getMonth() + 1 === mes
  })
  const gastos = -doMes.filter((m) => m.valor < 0).reduce((s, m) => s + m.valor, 0)
  const entradas = doMes.filter((m) => m.valor > 0).reduce((s, m) => s + m.valor, 0)
  const porCategoria = new Map<string, { total: number; n: number }>()
  doMes.filter((m) => m.valor < 0).forEach((m) => {
    const c = porCategoria.get(m.categoria) ?? { total: 0, n: 0 }
    c.total -= m.valor
    c.n++
    porCategoria.set(m.categoria, c)
  })
  const porDia = Array.from({ length: 31 }, (_, d) => -doMes.filter((m) => new Date(m.data).getDate() === d + 1 && m.valor < 0).reduce((s, m) => s + m.valor, 0))
  return {
    resumo: {
      ano, mes, moeda: 'EUR', gastos, entradas, movimentos: doMes.length, gastosMesAnterior: Math.round(gastos * 0.9),
      porCategoria: [...porCategoria].map(([chave, v]) => ({ chave, ...v })).sort((a, b) => b.total - a.total),
      porDia, comerciantes: [{ chave: 'Continente', total: 12630, n: 3 }, { chave: 'EDP', total: 6120, n: 1 }], maiorGasto: 6120,
    },
    evolucao: Array.from({ length: 6 }, (_, k) => ({ ano, mes: ((mes - 6 + k + 12) % 12) + 1, gastos: 60000 + k * 5000, entradas: 185000 })),
    recorrentes: [{ comerciante: 'Netflix', descricao: 'Netflix', categoria: 'subscricoes', valor: -1399, meses: 6, ultimo: agora - 5 * DIA }],
    moedas: ['EUR'], totalMovimentos: movimentos.length, origens: ['Revolut (exemplo)'],
    primeiro: [ano, Math.max(1, mes - 3)], ultimo: [ano, mes], categorias: CATEGORIAS,
  }
}

function aleatoria(n: number) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&*+-=?@'
  return Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => a[x % a.length]).join('')
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const erro = (codigo: string, mensagem: string) => Promise.reject({ codigo, mensagem })

async function comando(cmd: string, args: Obj): Promise<unknown> {
  const item = () => itens.find((i) => i.id === args.id)
  switch (cmd) {
    case 'estado_app':
      return { existeCofre: existe, desbloqueado, viaRecuperacao: false, erroArranque: null, config, versao: '0.3.0-simulado', caminhoCofre: '/data/user/0/pt.lisfilms.lissecurity/cofre.lissec', geracao, bloquearAoMinimizar: true, plataforma }
    case 'janela_pronta':
    case 'registar_atividade':
    case 'janela_minimizar':
    case 'janela_fechar':
    case 'guardar_gerador':
    case 'marcar_codigo':
    case 'limpar_historico':
    case 'abrir_endereco':
    case 'abrir_pasta_cofre':
      return null
    case 'para_segundo_plano':
      console.info('[simulador] a app iria para segundo plano')
      return null
    case 'margens_sistema':
      return plataforma === 'android' ? { topo: 24, direita: 0, baixo: 16, esquerda: 0, teclado: 0 } : { topo: 0, direita: 0, baixo: 0, esquerda: 0, teclado: 0 }
    case 'janela_maximizada':
    case 'janela_alternar_maximizar':
      return false
    case 'criar_cofre':
      await espera(900)
      existe = true
      desbloqueado = true
      return args.comRecuperacao ? 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-ABCD' : null
    case 'desbloquear':
      await espera(700)
      if (String(args.senha).length < 4) return erro('credencial', 'A senha mestra não está certa.')
      desbloqueado = true
      geracao++
      return { recuperadoAnterior: false, removidosDoLixo: 0 }
    case 'desbloquear_biometria':
      await espera(500)
      desbloqueado = true
      geracao++
      return { recuperadoAnterior: false, removidosDoLixo: 0 }
    case 'estado_biometria':
      return plataforma === 'android' ? { suportada: true, disponivel: true, ativa: biometriaAtiva, motivo: null } : { suportada: false, disponivel: false, ativa: false, motivo: 'Disponível só na app para Android.' }
    case 'ativar_biometria':
      await espera(600)
      biometriaAtiva = true
      return null
    case 'desativar_biometria':
      biometriaAtiva = false
      return null
    case 'bloquear_cofre':
      desbloqueado = false
      geracao++
      return null
    case 'visao_geral':
      return visaoGeral()
    case 'listar':
      return listar((args.consulta as Obj) ?? {})
    case 'agrupamentos': {
      const v = ativos().filter((i) => !args.tipo || tipoDe(i) === args.tipo)
      return { categorias: contagens(v.map((i) => i.categoria)), etiquetas: contagens(v.flatMap((i) => i.etiquetas)) }
    }
    case 'obter_item':
      return item() ? vista(item()!) : erro('invalido', 'Registo não encontrado.')
    case 'obter_item_edicao':
      return item() ?? erro('invalido', 'Registo não encontrado.')
    case 'revelar_campo':
      return item() ? revelar(item()!, String(args.campo)) : ''
    case 'copiar_campo':
    case 'copiar_texto':
    case 'copiar_codigo_totp':
      return definicoes.limparCopiaSegundos
    case 'codigo_totp': {
      const periodo = 30
      return { codigo: String(100000 + Math.floor((agora / 1000 / periodo) % 900000)), restante: periodo - Math.floor((Date.now() / 1000) % periodo), periodo, emissor: 'Banco Exemplo' }
    }
    case 'relatorio_seguranca': {
      const a = ativos().filter((i) => tipoDe(i) === 'login')
      return {
        fracas: a.filter((i) => String((i.conteudo as Obj).senha).length < 10).map((i) => [resumo(i), 1]),
        reutilizadas: [a.filter((i) => (i.conteudo as Obj).senha === 'netflix123').map(resumo)],
        antigas: a.filter((i) => Number((i.conteudo as Obj).senhaAlteradaEm) < agora - 365 * DIA).map(resumo),
        cartoesExpirados: [], cartoesAExpirar: ativos().filter((i) => tipoDe(i) === 'cartao').slice(1).map(resumo),
        temRecuperacao: true, kdfMemoriaMib: 128, kdfIteracoes: 3,
      }
    }
    case 'guardar_item': {
      const novo = args.item as Item
      const i = itens.findIndex((x) => x.id === novo.id)
      const gravado = { ...novo, id: novo.id || novoId(), alteradoEm: Date.now(), criadoEm: novo.criadoEm || Date.now() }
      if (i >= 0) itens[i] = gravado
      else itens.push(gravado)
      return gravado.id
    }
    case 'duplicar_item': {
      const i = item()
      if (!i) return erro('invalido', 'Registo não encontrado.')
      const c = { ...structuredClone(i), id: novoId(), titulo: `${i.titulo} (cópia)` }
      itens.push(c)
      return c.id
    }
    case 'mover_para_lixo':
      if (item()) item()!.eliminadoEm = Date.now()
      return null
    case 'restaurar_item':
      if (item()) item()!.eliminadoEm = null
      return null
    case 'eliminar_item':
      itens.splice(itens.findIndex((i) => i.id === args.id), 1)
      return null
    case 'esvaziar_lixo': {
      const n = itens.filter((i) => i.eliminadoEm !== null).length
      for (let k = itens.length - 1; k >= 0; k--) if (itens[k].eliminadoEm !== null) itens.splice(k, 1)
      return n
    }
    case 'alternar_favorito':
      if (item()) item()!.favorito = !item()!.favorito
      return item()?.favorito ?? false
    case 'gerar_senha': {
      const o = args.opcoes as Obj
      return { valor: aleatoria(Number(o.comprimento ?? 20)), entropiaBits: Number(o.comprimento ?? 20) * 6.1 }
    }
    case 'gerar_frase': {
      const p = ['mesa', 'rio', 'farol', 'azul', 'pinhal', 'vento', 'castelo', 'moinho', 'serra', 'lápis', 'barco', 'cereja']
      const o = args.opcoes as Obj
      const n = Number(o.palavras ?? 5)
      const ps = Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => p[x % p.length]).map((w) => (o.maiusculaInicial ? w[0].toUpperCase() + w.slice(1) : w))
      return { valor: ps.join(String(o.separador ?? '-')) + (o.incluirNumero ? '-7' : ''), entropiaBits: n * 12.9 }
    }
    case 'avaliar_senha': {
      const s = String(args.senha ?? '')
      const pontuacao = s.length >= 20 ? 4 : s.length >= 14 ? 3 : s.length >= 10 ? 2 : s.length >= 6 ? 1 : 0
      return { pontuacao, log10Tentativas: s.length * 1.4 }
    }
    case 'obter_definicoes':
      return { cofre: definicoes, nome: 'Ana', temRecuperacao: true, config, caminhoCofre: '/data/user/0/pt.lisfilms.lissecurity/cofre.lissec', kdfMemoriaMib: 128, kdfIteracoes: 3, gerador }
    case 'guardar_definicoes':
      Object.assign(definicoes, args.definicoes as Obj)
      return null
    case 'guardar_config':
      Object.assign(config, args.config as Obj)
      return config
    case 'reautenticar':
    case 'alterar_senha':
    case 'ativar_recuperacao':
    case 'desativar_recuperacao':
    case 'reforcar_protecao':
      await espera(500)
      return cmd === 'ativar_recuperacao' ? 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-ABCD' : null
    case 'criar_copia':
      await espera(400)
      ultimoBackup = Date.now()
      return { caminho: 'content://simulado/LisSecurity-copia.lissec', nome: 'LisSecurity-copia-2026-11-15_1740.lissec', em: Date.now(), bytes: 24576 }
    case 'partilhar_copia':
      console.info('[simulador] folha de partilha do Android')
      return null
    case 'escolher_copia':
    case 'escolher_csv':
      return 'content://simulado/ficheiro'
    case 'testar_copia':
    case 'restaurar_copia':
      await espera(600)
      return { total: itens.length, logins: 9, bancos: 2, cartoes: 2, notas: 2, noLixo: 0, gravadoEm: agora - 2 * DIA, mesmoCofre: true, temRecuperacao: true }
    case 'pre_visualizar_senhas':
      return { formato: 'Chrome / Edge', total: 42, novos: 38, duplicados: 3, ignorados: 1, amostra: ['github.com', 'gmail.com', 'netflix.com'] }
    case 'importar_senhas':
    case 'importar_extrato':
      return { novos: 38, duplicados: 3, ignorados: 1, origem: 'CSV' }
    case 'apagar_ficheiro_importado':
      return null
    case 'resumo_gastos':
      return resumoGastos(args)
    case 'listar_movimentos':
      return movimentos.filter((m) => new Date(m.data).getMonth() + 1 === Number(args.mes))
    case 'categorizar_movimento':
      return 1
    case 'eliminar_movimentos':
      return movimentos.length
    case 'pastas_nuvem':
      return plataforma === 'windows' ? [{ servico: 'Google Drive', caminho: 'G:\\O meu disco' }] : []
    case 'escolher_pasta':
      return plataforma === 'android' ? 'content://com.android.externalstorage.documents/tree/primary%3ALisSecurity' : 'G:\\O meu disco'
    case 'listar_copias':
    case 'estado_copias':
    case 'configurar_copias':
    case 'fazer_copia_auto': {
      const est = {
        config: { ativo: false, pasta: '', manter: 10 }, destino: null, noutroAparelho: false, ultimaAutomatica: null, ultimoErro: null, ultimaManual: ultimoBackup,
        copias: [{ caminho: 'content://simulado/1', nome: 'LisSecurity-copia-2026-11-06_2210.lissec', bytes: 24576, modificado: agora - 9 * DIA, automatica: false }],
      }
      if (cmd === 'listar_copias') return est.copias
      if (cmd === 'fazer_copia_auto') return { caminho: 'LisSecurity-auto.lissec', em: Date.now(), bytes: 24576 }
      return est
    }
    default:
      if (cmd.startsWith('plugin:')) return null
      console.warn('[simulador] comando sem resposta:', cmd, args)
      return null
  }
}

mockIPC((cmd, args) => comando(cmd, (args as Obj) ?? {}), { shouldMockEvents: true })
document.documentElement.dataset.simulado = plataforma
console.info(`[simulador] LisSecurity simulado (${plataforma}, ${fase}). Dados fictícios em memória.`)
