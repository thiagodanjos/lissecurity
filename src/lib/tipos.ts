// Tipos espelhados da camada nativa (serde em camelCase).

export type TipoItem = 'login' | 'banco' | 'cartao' | 'nota'

/** Um segredo como a interface o vê antes de o revelar. */
export interface Mascarado {
  definido: boolean
  /** últimos 4 caracteres (cartões, IBAN, contas), só quando o número é maior do que isso */
  fim?: string
  /** só nos campos personalizados NÃO ocultos */
  texto?: string
}

export interface Resumo {
  id: string
  tipo: TipoItem
  titulo: string
  subtitulo: string
  favorito: boolean
  categoria: string
  etiquetas: string[]
  criadoEm: number
  alteradoEm: number
  eliminadoEm: number | null
  dominio?: string
  fim?: string
  instituicao?: string
  bandeira?: string
  validade?: string
  tipoDetalhe?: string
  moeda?: string
  pais?: string
  codigosPorUsar?: number
}

// ───────── registo completo (só no formulário de edição) ─────────

export interface CampoPersonalizado {
  id: string
  rotulo: string
  valor: string
  oculto: boolean
}

export interface Login {
  url: string
  utilizador: string
  email: string
  senha: string
  senhaAlteradaEm: number | null
  historico: { senha: string; substituidaEm: number }[]
  totp: string
}

export interface ChavePix {
  tipo: string
  valor: string
}

export interface Banco {
  banco: string
  titular: string
  pais: string
  moeda: string
  tipoConta: string
  agencia: string
  numeroConta: string
  iban: string
  bic: string
  chavesPix: ChavePix[]
  idAcesso: string
  credencialLigada: string | null
}

export interface Cartao {
  instituicao: string
  bandeira: string
  titular: string
  numero: string
  validade: string
  tipoCartao: string
  contaLigada: string | null
}

export interface Nota {
  tipoNota: string
  conteudo: string
  codigos: { valor: string; usado: boolean }[]
}

export type Conteudo =
  | ({ tipo: 'login' } & Login)
  | ({ tipo: 'banco' } & Banco)
  | ({ tipo: 'cartao' } & Cartao)
  | ({ tipo: 'nota' } & Nota)

export interface Item {
  id: string
  titulo: string
  favorito: boolean
  categoria: string
  etiquetas: string[]
  notas: string
  campos: CampoPersonalizado[]
  criadoEm: number
  alteradoEm: number
  eliminadoEm: number | null
  conteudo: Conteudo
}

// ───────── vista de detalhe (mascarada) ─────────

export interface Ligado {
  id: string
  titulo: string
  tipo: TipoItem
}

export type ConteudoVista =
  | {
      tipo: 'login'
      url: string
      utilizador: string
      email: string
      senha: Mascarado
      totp: Mascarado
      senhaAlteradaEm: number | null
      historico: { substituidaEm: number }[]
    }
  | {
      tipo: 'banco'
      banco: string
      titular: string
      pais: string
      moeda: string
      tipoConta: string
      agencia: string
      bic: string
      numeroConta: Mascarado
      iban: Mascarado
      idAcesso: Mascarado
      chavesPix: { tipo: string; valor: Mascarado }[]
      credencialLigada: Ligado | null
    }
  | {
      tipo: 'cartao'
      instituicao: string
      bandeira: string
      titular: string
      validade: string
      tipoCartao: string
      numero: Mascarado
      contaLigada: Ligado | null
    }
  | {
      tipo: 'nota'
      tipoNota: string
      conteudo: Mascarado
      codigos: { usado: boolean; valor: Mascarado }[]
    }

export interface ItemVista {
  id: string
  titulo: string
  favorito: boolean
  categoria: string
  etiquetas: string[]
  criadoEm: number
  alteradoEm: number
  eliminadoEm: number | null
  notas: Mascarado
  campos: { id: string; rotulo: string; oculto: boolean; valor: Mascarado }[]
  conteudo: ConteudoVista
}

// ───────── aplicação ─────────

export interface ConfigApp {
  caminhoCofre: string | null
  animacoes: 'sistema' | 'reduzidas' | 'completas'
  densidade: 'confortavel' | 'compacta'
  tema: 'grafite' | 'preto'
  aoFechar: 'sair' | 'minimizar'
  iniciarComSistema: boolean
  protegerCaptura: boolean
  lateralRecolhida: boolean
  zoom: number
  paginaInicial: 'inicio' | 'senhas' | 'financeiro' | 'gastos'
  cor: 'verde' | 'azul'
  contadoresLateral: boolean
}

export interface EstadoApp {
  existeCofre: boolean
  desbloqueado: boolean
  viaRecuperacao: boolean
  erroArranque: string | null
  config: ConfigApp
  versao: string
  caminhoCofre: string
  geracao: number
  bloquearAoMinimizar: boolean
}

export interface Definicoes {
  bloqueioMinutos: number
  bloquearAoMinimizar: boolean
  bloquearAoSuspender: boolean
  bloquearComSistema: boolean
  limparCopiaSegundos: number
  diasLixo: number
  maxHistorico: number
  ocultarReveladoSegundos: number
  reautenticarFinanceiro: boolean
  limparAoBloquear: boolean
  lembreteCopiaDias: number
}

export interface PreferenciasGerador {
  modo: 'senha' | 'frase'
  comprimento: number
  maiusculas: boolean
  minusculas: boolean
  numeros: boolean
  simbolos: boolean
  evitarSemelhantes: boolean
  palavras: number
  separador: string
  maiusculaInicial: boolean
  incluirNumero: boolean
}

export interface DefinicoesVista {
  cofre: Definicoes
  nome: string
  temRecuperacao: boolean
  config: ConfigApp
  caminhoCofre: string
  kdfMemoriaMib: number
  kdfIteracoes: number
  gerador: PreferenciasGerador
}

export interface VisaoGeral {
  nome: string
  total: number
  logins: number
  bancos: number
  cartoes: number
  notas: number
  favoritosTotal: number
  noLixo: number
  favoritos: Resumo[]
  recentes: Resumo[]
  fracas: number
  reutilizadas: number
  gruposReutilizados: number
  antigas: number
  cartoesExpirados: number
  cartoesAExpirar: number
  ultimoBackup: number | null
  alteracoesPorSalvaguardar: boolean
  copiasAutomaticas: boolean
  lembreteCopiaDias: number
  totalMovimentos: number
}

export interface Relatorio {
  fracas: [Resumo, number][]
  reutilizadas: Resumo[][]
  antigas: Resumo[]
  cartoesExpirados: Resumo[]
  cartoesAExpirar: Resumo[]
  temRecuperacao: boolean
  kdfMemoriaMib: number
  kdfIteracoes: number
}

export interface Consulta {
  texto?: string
  tipo?: TipoItem | ''
  filtro?: 'todos' | 'favoritos' | 'lixo'
  categoria?: string
  etiqueta?: string
  ordem?: 'titulo' | 'alterado' | 'criado'
}

export interface Contagem {
  nome: string
  total: number
}

export interface Forca {
  pontuacao: number
  log10Tentativas: number
}

export interface Gerada {
  valor: string
  entropiaBits: number
}

export interface OpcoesSenha {
  comprimento: number
  maiusculas: boolean
  minusculas: boolean
  numeros: boolean
  simbolos: boolean
  evitarSemelhantes: boolean
}

export interface OpcoesFrase {
  palavras: number
  separador: string
  maiusculaInicial: boolean
  incluirNumero: boolean
}

export interface InfoCopia {
  total: number
  logins: number
  bancos: number
  cartoes: number
  notas: number
  noLixo: number
  gravadoEm: number
  mesmoCofre: boolean | null
  temRecuperacao: boolean
}

export interface CopiaCriada {
  caminho: string
  nome: string
  em: number
  bytes: number
}

export interface Desbloqueio {
  recuperadoAnterior: boolean
  removidosDoLixo: number
}

export interface Agrupamentos {
  categorias: Contagem[]
  etiquetas: Contagem[]
}

export interface CodigoTotp {
  codigo: string
  restante: number
  periodo: number
  emissor: string | null
}

export interface PreviaSenhas {
  formato: string
  total: number
  novos: number
  duplicados: number
  ignorados: number
  amostra: string[]
}

export interface Importacao {
  novos: number
  duplicados: number
  ignorados: number
  origem: string
}

export interface Movimento {
  id: string
  data: number
  descricao: string
  /** cêntimos; negativo = saída */
  valor: number
  moeda: string
  tipo: string
  categoria: string
  origem: string
}

export interface Total {
  chave: string
  total: number
  n: number
}

export interface ResumoMes {
  ano: number
  mes: number
  moeda: string
  gastos: number
  entradas: number
  movimentos: number
  gastosMesAnterior: number
  porCategoria: Total[]
  porDia: number[]
  comerciantes: Total[]
  maiorGasto: number | null
}

export interface ResumoGastos {
  resumo: ResumoMes
  evolucao: { ano: number; mes: number; gastos: number; entradas: number }[]
  recorrentes: { comerciante: string; descricao: string; categoria: string; valor: number; meses: number; ultimo: number }[]
  moedas: string[]
  totalMovimentos: number
  origens: string[]
  primeiro: [number, number] | null
  ultimo: [number, number] | null
  categorias: [string, string][]
}

export interface CopiaEncontrada {
  caminho: string
  nome: string
  bytes: number
  modificado: number
  automatica: boolean
}

export interface PastaNuvem {
  servico: string
  caminho: string
}

export interface ConfigCopias {
  ativo: boolean
  pasta: string
  manter: number
}

export interface EstadoCopias {
  config: ConfigCopias
  destino: string | null
  ultimaAutomatica: number | null
  ultimoErro: string | null
  ultimaManual: number | null
  copias: CopiaEncontrada[]
}

export interface CopiaFeita {
  caminho: string
  em: number
  bytes: number
}
