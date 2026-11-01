// Teste ponta-a-ponta da aplicação REAL (camada Rust + interface), conduzida por WebDriver.
// Só usa dados claramente fictícios. Corre em Linux (WebKitGTK) com tauri-driver:
//
//   npx tauri build --debug --no-bundle
//   xvfb-run -a node e2e/teste.mjs
//
// Cria um cofre numa pasta temporária (XDG_DATA_HOME/XDG_CONFIG_HOME), nunca no cofre real.

import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { Builder, By, Capabilities, Key, until } from 'selenium-webdriver'

const RAIZ = path.resolve(import.meta.dirname, '..')
const APP = path.join(RAIZ, 'target', 'debug', 'lissecurity')
const CAPTURAS = process.env.CAPTURAS ?? path.join(RAIZ, 'docs', 'capturas')
const TMP = mkdtempSync(path.join(tmpdir(), 'lissecurity-e2e-'))
// HOME aponta para uma pasta temporária com um "Google Drive" falso: a app deteta-o como
// faria com o Google Drive para computador (as cópias automáticas vão para lá).
const CASA = path.join(TMP, 'casa')
const DRIVE = path.join(CASA, 'Google Drive', 'O meu disco')
mkdirSync(DRIVE, { recursive: true })
const ENV = { ...process.env, HOME: CASA, XDG_DATA_HOME: path.join(TMP, 'dados'), XDG_CONFIG_HOME: path.join(TMP, 'config') }
const SEGREDO_2FA = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' // vetor público do RFC 6238

/** TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s) calculado aqui, de forma independente da app. */
async function totpEsperado(segundos) {
  const { createHmac } = await import('node:crypto')
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of SEGREDO_2FA) bits += alfabeto.indexOf(c).toString(2).padStart(5, '0')
  const chave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const contador = Buffer.alloc(8)
  contador.writeBigUInt64BE(BigInt(Math.floor(segundos / 30)))
  const h = createHmac('sha1', chave).update(contador).digest()
  const o = h[h.length - 1] & 0xf
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

const SENHA = 'cavalo-bateria-agrafo-correto-e2e'
const SENHA_NOVA = 'outra-frase-mestra-ficticia-e2e'
const SEGREDOS = {
  senha: 'SENHA-FICTICIA-E2E-7731',
  titulo: 'Correio Exemplo E2E',
  iban: 'PT50000201231234567890154',
  cartao: '4111111111111111',
  codigo: 'codigo-ficticio-e2e-01',
  nota: 'nota-privada-ficticia-e2e',
}

const resultados = []
function registar(nome, ok, detalhe = '') {
  resultados.push({ nome, ok, detalhe })
  console.log(`${ok ? '✔' : '✘'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}
let falhaN = 0
async function passo(nome, f) {
  try {
    await f()
    registar(nome, true)
  } catch (e) {
    registar(nome, false, (e?.message || e?.name || String(e)).split('\n')[0])
    try {
      const png = await d.takeScreenshot()
      writeFileSync(path.join(TMP, `falha-${++falhaN}.png`), png, 'base64')
      console.log(`   captura da falha: ${path.join(TMP, `falha-${falhaN}.png`)}`)
    } catch {}
  }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
function assegurar(cond, msg) {
  if (!cond) throw new Error(msg)
}

mkdirSync(CAPTURAS, { recursive: true })
const driverProc = spawn(path.join(homedir(), '.cargo', 'bin', 'tauri-driver'), [], { env: ENV, stdio: ['ignore', 'ignore', 'inherit'] })
await esperar(1500)

const caps = new Capabilities()
caps.set('tauri:options', { application: APP })
caps.setBrowserName('wry')
const d = await new Builder().withCapabilities(caps).usingServer('http://127.0.0.1:4444/').build()

const $ = (css) => d.wait(until.elementLocated(By.css(css)), 10000)
const porTexto = (texto, tag = '*') => d.wait(until.elementLocated(By.xpath(`//${tag}[contains(normalize-space(.), "${texto}")]`)), 10000)
const botao = (texto) => d.wait(until.elementLocated(By.xpath(`//button[contains(normalize-space(.), "${texto}") or @aria-label="${texto}"]`)), 10000)
async function clicar(texto) {
  const b = await botao(texto)
  await d.wait(until.elementIsEnabled(b), 10000)
  await clicarEl(b)
}
/** Clica num elemento; se estiver tapado (aviso, animação) ou fora da área visível, clica por script. */
async function clicarEl(el) {
  await d.executeScript('arguments[0].scrollIntoView({ block: "center", inline: "nearest" })', el).catch(() => {})
  try {
    await el.click()
  } catch (e) {
    if (!['ElementClickInterceptedError', 'ElementNotInteractableError'].includes(e?.name)) throw e
    await d.executeScript('arguments[0].click()', el)
  }
}
async function clicarExato(texto) {
  const b = await d.wait(until.elementLocated(By.xpath(`//button[normalize-space(.)="${texto}"]`)), 10000)
  await d.wait(until.elementIsEnabled(b), 10000)
  await b.click()
}
async function escolherOpcao(rotulo, valor) {
  await d.wait(until.elementLocated(By.css(`select[aria-label="${rotulo}"] option[value="${valor}"]`)), 10000)
  // como a pessoa faria ao escolher na lista: muda o valor e dispara o evento "change"
  await d.executeScript(
    `const s = document.querySelector('select[aria-label="${rotulo}"]');
     s.scrollIntoView({ block: 'center' });
     Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, arguments[0]);
     s.dispatchEvent(new Event('change', { bubbles: true }));`,
    valor,
  )
  await esperar(300)
  const atual = await d.findElement(By.css(`select[aria-label="${rotulo}"]`)).getAttribute('value')
  assegurar(atual === valor, `«${rotulo}» ficou com ${atual} em vez de ${valor}`)
}
/** Espera que nenhuma janela sobreposta (editor, confirmação) continue no DOM. */
const semDialogos = () => d.wait(async () => (await d.findElements(By.css('[role="dialog"]'))).length === 0, 5000)
async function escrever(rotulo, valor) {
  const campo = await d.wait(until.elementLocated(By.xpath(`//label[normalize-space(text())="${rotulo}"]/following::input[1] | //input[@aria-label="${rotulo}"]`)), 10000)
  await d.executeScript('arguments[0].scrollIntoView({ block: "center" })', campo)
  await campo.clear()
  await campo.sendKeys(valor)
}
const html = () => d.executeScript('return document.documentElement.outerHTML')
const textoPagina = () => d.executeScript('return document.body.innerText')
async function captura(nome) {
  await esperar(450)
  const png = await d.takeScreenshot()
  writeFileSync(path.join(CAPTURAS, `${nome}.png`), png, 'base64')
}
async function teclas(...k) {
  await d.actions().keyDown(Key.CONTROL).sendKeys(...k).keyUp(Key.CONTROL).perform()
}
/** Todos os ficheiros que a app escreveu (cofre, temporários, caches do WebView, preferências). */
function ficheirosEscritos(pasta = TMP) {
  if (!existsSync(pasta)) return []
  return readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(pasta, e.name)
    return e.isDirectory() ? ficheirosEscritos(p) : e.isFile() ? [p] : []
  })
}
const clipboard = () => {
  try {
    return execFileSync('xclip', ['-o', '-selection', 'clipboard'], { env: ENV, timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  } catch {
    return ''
  }
}

try {
  await d.manage().window().setRect({ width: 1280, height: 820 }).catch(() => {})

  await passo('primeiro uso mostra as boas-vindas', async () => {
    await porTexto('Criar um cofre novo', 'button')
    await captura('01-boas-vindas')
  })

  await passo('onboarding cria o cofre com chave de recuperação', async () => {
    await clicar('Criar um cofre novo')
    await escrever('Nome', 'Thiago')
    await clicar('Continuar')
    await escrever('Senha mestra', 'curta')
    await clicar('Continuar')
    await porTexto('pelo menos 12 caracteres')
    await escrever('Senha mestra', SENHA)
    await esperar(600)
    await captura('02-senha-mestra')
    const aceitar = await d.findElements(By.xpath('//label[contains(., "quero usá-la")]//input'))
    if (aceitar.length) await aceitar[0].click()
    await clicar('Continuar')
    await escrever('Repetir a senha mestra', SENHA)
    await clicar('Continuar')
    await porTexto('Criar uma chave de recuperação')
    await clicar('Continuar')
    await clicar('Criar o cofre')
    await d.wait(until.elementLocated(By.xpath('//*[contains(., "CHAVE DE RECUPERAÇÃO")]')), 30000)
    await captura('03-chave-recuperacao')
    await (await d.findElement(By.xpath('//label[contains(., "Guardei a chave")]//input'))).click()
    await clicar('Entrar no cofre')
    await porTexto('Bem-vindo')
  })

  await passo('visão geral com saudação e números reais', async () => {
    const t = await textoPagina()
    assegurar(t.includes('Thiago'), 'nome em falta na saudação')
    assegurar(/Senhas guardadas/.test(t), 'cartão de resumo em falta')
    await captura('04-visao-geral-vazia')
  })

  await passo('criar registo de senha', async () => {
    await teclas('n')
    await escrever('Título', SEGREDOS.titulo)
    await escrever('Endereço', 'https://correio.exemplo.invalid')
    await escrever('Utilizador', 'thiago.teste')
    await escrever('E-mail', 'thiago@exemplo.invalid')
    await escrever('Senha', SEGREDOS.senha)
    await esperar(500)
    await captura('05-editor-senha')
    await teclas('s')
    await porTexto('Registo guardado no cofre')
  })

  await passo('detalhe mostra a senha mascarada (o segredo não está no DOM)', async () => {
    await d.wait(until.elementLocated(By.xpath(`//h2[normalize-space(.)="${SEGREDOS.titulo}"]`)), 10000)
    await botao('Revelar senha')
    const h = await html()
    assegurar(!h.includes(SEGREDOS.senha), 'a senha apareceu no DOM sem ser revelada')
    await captura('06-detalhe-senha')
  })

  await passo('revelar mostra a senha só depois de pedido', async () => {
    await clicar('Revelar senha')
    await d.wait(async () => (await html()).includes(SEGREDOS.senha), 5000)
    await captura('07-senha-revelada')
    await clicar('Ocultar senha')
    await d.wait(async () => !(await html()).includes(SEGREDOS.senha), 5000)
  })

  await passo('mais registos: senha reutilizada e fraca', async () => {
    for (const [titulo, senha] of [
      ['Loja Ficticia', SEGREDOS.senha],
      ['Fórum Antigo', '123456'],
      ['Nuvem Exemplo', 'reboque-gaveta-orvalho-ninho-tufao'],
    ]) {
      await teclas('n')
      await escrever('Título', titulo)
      await escrever('Senha', senha)
      await teclas('s')
      await porTexto('Registo guardado no cofre')
      await esperar(300)
    }
    await captura('08-lista-senhas')
  })

  await passo('conta bancária PT com IBAN validado', async () => {
    await d.executeScript('document.getElementById("pesquisa-cofre").blur()')
    await clicar('Novo registo')
    await clicar('Conta bancária')
    await escrever('Nome personalizado', 'Conta ordenado (exemplo)')
    await escrever('Banco', 'Banco Ficticio Exemplar')
    await escrever('Titular', 'Thiago Teste')
    await escrever('IBAN', SEGREDOS.iban.slice(0, -1) + '5')
    await porTexto('dígitos de controlo não batem certo')
    await escrever('IBAN', SEGREDOS.iban)
    await porTexto('não confirma que a conta existe')
    await escrever('BIC / SWIFT', 'CGDIPTPL')
    await captura('09-editor-banco')
    await teclas('s')
    await porTexto('Registo guardado no cofre')
    await captura('10-detalhe-banco')
  })

  await passo('conta bancária BR com agência e chave Pix', async () => {
    await clicar('Novo registo')
    await clicar('Conta bancária')
    await escrever('Nome personalizado', 'Conta corrente BR (exemplo)')
    const pais = await d.findElement(By.xpath('//label[normalize-space(text())="País da conta"]/following::select[1]'))
    await pais.sendKeys('Brasil')
    await escrever('Agência', '1234-5')
    await escrever('Número da conta', '12345-6')
    await clicar('Adicionar chave Pix')
    await escrever('Chave Pix', '529.982.247-25')
    await teclas('s')
    await porTexto('Registo guardado no cofre')
  })

  await passo('cartão com número validado e só 4 dígitos visíveis', async () => {
    await semDialogos()
    await d.executeScript(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Cartões'))?.click()`)
    await porTexto('Novo cartão')
    await teclas('n')
    await escrever('Nome personalizado', 'Cartão de crédito (exemplo)')
    await escrever('Número do cartão', SEGREDOS.cartao)
    await escrever('Validade', '1228')
    await escrever('Titular', 'THIAGO TESTE')
    await teclas('s')
    await porTexto('Registo guardado no cofre')
    await semDialogos()
    const h = await html()
    assegurar(!h.includes(SEGREDOS.cartao) && !h.includes('4111 1111 1111 1111'), 'número completo do cartão no DOM')
    assegurar(h.includes('1111'), 'últimos 4 dígitos em falta')
    await captura('11-cartoes')
  })

  await passo('nota com códigos de recuperação', async () => {
    await clicar('Novo registo')
    await clicar('Nota segura')
    await escrever('Título', 'Códigos GitHub (exemplo)')
    await clicar('Códigos de recuperação')
    const area = await d.findElement(By.xpath('//label[contains(., "um por linha")]/following::textarea[1]'))
    await area.sendKeys(`${SEGREDOS.codigo}\ncodigo-ficticio-e2e-02\ncodigo-ficticio-e2e-03`)
    await teclas('s')
    await porTexto('Registo guardado no cofre')
    await captura('12-nota-codigos')
  })

  await passo('pesquisa interna encontra pelo título, nunca pela senha', async () => {
    const p = await $('#pesquisa-cofre')
    await p.sendKeys('correio')
    await porTexto(SEGREDOS.titulo)
    await captura('13-pesquisa')
    await p.clear()
    await p.sendKeys(SEGREDOS.senha)
    await porTexto('Nada encontrado no cofre')
    await p.sendKeys(Key.ESCAPE)
  })

  await passo('paleta de comandos (Ctrl+K)', async () => {
    await teclas('k')
    await porTexto('Bloquear imediatamente')
    await d.actions().sendKeys('banc').perform()
    await esperar(400)
    await captura('14-paleta')
    await d.actions().sendKeys(Key.ESCAPE).perform()
  })

  await passo('visão geral com alertas concretos', async () => {
    await d.executeScript(`[...document.querySelectorAll('aside button')].find(b => b.getAttribute('aria-label') === 'Visão geral')?.click()`)
    await porTexto('senha fraca')
    const t = await textoPagina()
    assegurar(/reutilizada/.test(t), 'alerta de senha reutilizada em falta')
    await captura('15-visao-geral')
  })

  await passo('área Financeiro', async () => {
    await clicar('Financeiro')
    await porTexto('Resumo')
    await captura('16-financeiro')
    await clicar('Cofre')
  })

  await passo('segurança, gerador e definições', async () => {
    await d.executeScript(`[...document.querySelectorAll('aside button')].find(b => b.getAttribute('aria-label') === 'Segurança')?.click()`)
    await porTexto('Proteção do cofre')
    await captura('17-seguranca')
    await teclas('g')
    await porTexto('Entropia estimada')
    await captura('18-gerador')
    await d.executeScript(`document.querySelector('aside button[aria-label="Definições"]')?.click()`)
    await porTexto('Bloquear depois de')
    await captura('19-definicoes')
  })

  await passo('categorias: setas quando não cabem e menu com todas', async () => {
    await d.executeScript(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Senhas'))?.click()`)
    await porTexto('Nova senha')
    const categorias = ['Trabalho Exemplo', 'Pessoal Exemplo', 'Finanças Exemplo', 'Compras Exemplo', 'Jogos Exemplo', 'Estudos Exemplo', 'Viagens Exemplo']
    for (const [i, cat] of categorias.entries()) {
      await teclas('n')
      await escrever('Título', `Serviço ${i + 1} (exemplo)`)
      await escrever('Senha', `senha-ficticia-cat-${i}-xyz`)
      await escrever('Categoria', cat)
      if (i === 0) await escrever('Chave 2FA (TOTP)', SEGREDO_2FA)
      await teclas('s')
      await porTexto('Registo guardado no cofre')
      await semDialogos()
    }
    const direita = await d.wait(until.elementLocated(By.css('button[aria-label="Ver as seguintes"]')), 8000)
    await captura('23-categorias-setas')
    const antes = await d.executeScript(`return document.querySelector('[aria-label="Filtrar por categoria ou etiqueta"] .sem-barra').scrollLeft`)
    await clicarEl(direita)
    await esperar(700)
    const depois = await d.executeScript(`return document.querySelector('[aria-label="Filtrar por categoria ou etiqueta"] .sem-barra').scrollLeft`)
    assegurar(depois > antes, 'a seta não fez rolar as categorias')
    await d.wait(until.elementLocated(By.css('button[aria-label="Ver as anteriores"]')), 4000)
    await clicar('Todas (')
    for (const cat of categorias) await porTexto(cat, 'button')
    await captura('24-categorias-todas')
    await clicarEl(await porTexto('Viagens Exemplo', 'button'))
    await porTexto('Serviço 7 (exemplo)')
  })

  await passo('código 2FA ao vivo igual ao calculado de forma independente', async () => {
    await clicar('Limpar')
    await clicarEl(await porTexto('Serviço 1 (exemplo)', 'button'))
    const xp = '//p[contains(., "Código 2FA")]/following-sibling::div//span[contains(@class, "mono")]'
    await d.wait(until.elementLocated(By.xpath(xp)), 8000)
    await esperar(800)
    // lido por script: o elemento é recriado sempre que o código muda (animação)
    const mostrado = String(await d.executeScript(`return document.evaluate(arguments[0], document, null, 9, null).singleNodeValue?.textContent ?? ''`, xp)).replace(/\s/g, '')
    const agora = Date.now() / 1000
    const validos = await Promise.all([agora - 30, agora, agora + 30].map(totpEsperado))
    assegurar(validos.includes(mostrado), `código ${mostrado} ≠ ${validos.join('/')}`)
    assegurar(!(await html()).includes(SEGREDO_2FA), 'a chave 2FA chegou ao ecrã')
    await captura('25-codigo-2fa')
  })

  await passo('cópias automáticas cifradas para a pasta do Google Drive', async () => {
    await d.executeScript(`[...document.querySelectorAll('aside button')].find(b => b.getAttribute('aria-label') === 'Cópias de segurança')?.click()`)
    await clicarEl(await porTexto('Google Drive', 'button'))
    await clicar('Ligar ao Google Drive')
    await porTexto('Cópias automáticas ligadas')
    const pasta = path.join(DRIVE, 'LisSecurity')
    const autos = () => (existsSync(pasta) ? readdirSync(pasta).filter((f) => f.startsWith('LisSecurity-auto-') && f.endsWith('.lissec')) : [])
    assegurar(autos().length === 1, `esperava 1 cópia automática, há ${autos().length}`)
    await captura('26-copias-google-drive')
    // uma alteração gera outra cópia passados ~15 s
    await teclas('n')
    await escrever('Título', 'Depois da cópia (exemplo)')
    await escrever('Senha', 'senha-ficticia-depois')
    await teclas('s')
    await porTexto('Registo guardado no cofre')
    await d.wait(async () => autos().length === 2, 30000).catch(() => {})
    assegurar(autos().length === 2, `depois de uma alteração esperava 2 cópias, há ${autos().length}`)
  })

  await passo('pedir a senha mestra antes de revelar o IBAN (quando ligado)', async () => {
    await d.executeScript(`document.querySelector('aside button[aria-label="Definições"]')?.click()`)
    const interruptor = await d.wait(until.elementLocated(By.xpath('//label[normalize-space(.)="Pedir a senha mestra para dados financeiros"]/following::button[@role="switch"][1]')), 8000)
    await clicarEl(interruptor)
    await esperar(800)
    await captura('27-definicoes-completas')
    await clicar('Financeiro')
    await d.executeScript(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Dados bancários'))?.click()`)
    await clicarEl(await porTexto('Conta ordenado (exemplo)', 'button'))
    await clicar('Revelar iban')
    await porTexto('Confirma que és tu')
    assegurar(!(await html()).includes(SEGREDOS.iban), 'o IBAN apareceu antes da senha')
    await captura('28-reautenticacao')
    await escrever('Senha mestra', SENHA)
    await clicarExato('Confirmar')
    await d.wait(async () => (await html()).includes('PT50 0002 0123 1234 5678 9015 4'), 8000)
    await clicar('Cofre')
  })

  await passo('página de gastos sem extratos explica como importar', async () => {
    await clicar('Financeiro')
    await d.executeScript(`[...document.querySelectorAll('aside button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Gastos'))?.click()`)
    await porTexto('Importa o primeiro extrato')
    await captura('29-gastos-vazio')
    await clicar('Importar extrato')
    await porTexto('não permite ligar uma conta pessoal')
    await captura('30-importar-extrato')
    await d.actions().sendKeys(Key.ESCAPE).perform()
    await semDialogos()
    await clicar('Cofre')
  })

  await passo('copiar põe na área de transferência e limpa sozinha', async () => {
    await escolherOpcao('Segundos até limpar', '10')
    await esperar(800)
    await clicar('Senhas')
    await porTexto(SEGREDOS.titulo)
    const linha = await porTexto(SEGREDOS.titulo, 'button')
    await linha.click()
    await clicar('Copiar senha')
    await esperar(600)
    assegurar(clipboard() === SEGREDOS.senha, 'a senha não chegou à área de transferência')
    await esperar(11500)
    assegurar(clipboard() === '', 'a área de transferência não foi limpa')
  })

  await passo('a limpeza não apaga algo novo copiado pela pessoa', async () => {
    await clicar('Copiar senha')
    await esperar(500)
    execFileSync('sh', ['-c', 'printf "texto-da-pessoa" | xclip -selection clipboard -loops 3'], { env: ENV, timeout: 3000, stdio: 'ignore' })
    await esperar(11500)
    assegurar(clipboard() === 'texto-da-pessoa', `foi apagado o texto da pessoa (${JSON.stringify(clipboard())})`)
  })

  await passo('nenhum ficheiro escrito pela app tem dados em claro (cofre, temporários, caches)', async () => {
    const ficheiros = ficheirosEscritos()
    assegurar(ficheiros.some((f) => f.endsWith(path.join('pt.lisfilms.lissecurity', 'cofre.lissec'))), 'cofre não encontrado')
    for (const f of ficheiros) {
      if (f.includes(`${path.sep}gstreamer-1.0${path.sep}`)) continue // registo de plugins do sistema, não da app
      const b = readFileSync(f)
      for (const s of [...Object.values(SEGREDOS), 'Thiago', 'Banco Ficticio', 'thiago.teste']) {
        const utf16 = Buffer.from(s, 'utf16le')
        assegurar(!b.includes(Buffer.from(s)) && !b.includes(utf16), `«${s}» em claro em ${path.relative(TMP, f)}`)
      }
    }
    registar(`  (${ficheiros.length} ficheiros verificados)`, true)
  })

  await passo('bloquear (Ctrl+L) tira tudo do ecrã', async () => {
    await clicar('Revelar senha')
    await d.wait(async () => (await html()).includes(SEGREDOS.senha), 5000)
    await teclas('l')
    await porTexto('O teu cofre está bloqueado')
    const h = await html()
    for (const s of [...Object.values(SEGREDOS), 'Thiago', 'Banco Ficticio', 'Conta ordenado', 'Loja Ficticia']) {
      assegurar(!h.includes(s), `«${s}» continua no ecrã depois de bloquear`)
    }
    await captura('20-bloqueado')
  })

  await passo('com o cofre bloqueado a camada nativa recusa leituras', async () => {
    const r = await d.executeAsyncScript(`
      const feito = arguments[arguments.length - 1];
      window.__TAURI_INTERNALS__.invoke('listar', { consulta: {} }).then(() => feito('aberto')).catch((e) => feito(e.codigo));
    `)
    assegurar(r === 'bloqueado', `esperado "bloqueado", veio ${r}`)
  })

  await passo('senha errada não abre e explica porquê', async () => {
    await escrever('Senha mestra', 'cavalo-bateria-agrafo-errado-e2e')
    await clicar('Desbloquear')
    await porTexto('A senha não abre este cofre')
    await captura('21-senha-errada')
  })

  await passo('senha certa abre', async () => {
    await escrever('Senha mestra', SENHA)
    await clicar('Desbloquear')
    await porTexto('Bem-vindo', '*')
  })

  await passo('uma revelação pedida antes do bloqueio não reaparece depois', async () => {
    await clicar('Senhas')
    await (await porTexto(SEGREDOS.titulo, 'button')).click()
    await botao('Revelar senha')
    // clique em revelar e bloqueio no mesmo instante
    await d.executeScript(`
      document.querySelector('button[aria-label="Revelar senha"]').click();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }));
    `)
    await esperar(2500)
    assegurar(!(await html()).includes(SEGREDOS.senha), 'a resposta atrasada voltou a mostrar a senha')
    await porTexto('O teu cofre está bloqueado')
  })

  await passo('trocar a senha mestra preserva os dados', async () => {
    await escrever('Senha mestra', SENHA)
    await clicar('Desbloquear')
    await porTexto('Bem-vindo')
    await d.executeScript(`[...document.querySelectorAll('aside button')].find(b => b.getAttribute('aria-label') === 'Segurança')?.click()`)
    await clicar('Alterar senha mestra')
    await escrever('Senha mestra atual', SENHA)
    await escrever('Senha mestra nova', SENHA_NOVA)
    await escrever('Repetir a senha nova', SENHA_NOVA)
    await clicarExato('Alterar senha')
    await d.wait(until.elementLocated(By.xpath('//*[contains(., "CHAVE DE RECUPERAÇÃO")]')), 30000)
    await (await d.findElement(By.xpath('//label[contains(., "Guardei a chave")]//input'))).click()
    await clicar('Concluir')
    await teclas('l')
    await escrever('Senha mestra', SENHA)
    await clicar('Desbloquear')
    await porTexto('A senha não abre este cofre')
    await escrever('Senha mestra', SENHA_NOVA)
    await clicar('Desbloquear')
    await porTexto('Bem-vindo')
    await clicar('Senhas')
    await porTexto(SEGREDOS.titulo)
  })

  await passo('minimizar bloqueia o cofre mas mantém o que se copiou para colar', async () => {
    await clicar('Senhas')
    await (await porTexto(SEGREDOS.titulo, 'button')).click()
    await clicar('Copiar senha')
    await esperar(500)
    await clicar('Minimizar')
    await porTexto('O teu cofre está bloqueado')
    await porTexto('Bloqueado ao minimizar')
    assegurar(!(await html()).includes(SEGREDOS.titulo), 'registos visíveis depois de minimizar')
    assegurar(clipboard() === SEGREDOS.senha, 'minimizar apagou o que se tinha copiado')
    await d.manage().window().setRect({ width: 1280, height: 820 }).catch(() => {})
    await escrever('Senha mestra', SENHA_NOVA)
    await clicar('Desbloquear')
    await porTexto('Bem-vindo')
  })

  await passo('bloqueio automático por inatividade (1 min, contado na camada nativa)', async () => {
    await d.executeScript(`document.querySelector('aside button[aria-label="Definições"]')?.click()`)
    await escolherOpcao('Minutos até bloquear', '1')
    await esperar(1500)
    // sem rato nem teclado durante pouco mais de um minuto
    await d.wait(until.elementLocated(By.xpath('//*[contains(., "Bloqueado por inatividade")]')), 80000)
    assegurar(!(await html()).includes('Thiago'), 'dados do cofre visíveis depois do bloqueio')
  })

  await passo('janela mais pequena continua utilizável', async () => {
    await escrever('Senha mestra', SENHA_NOVA)
    await clicar('Desbloquear')
    await porTexto('Bem-vindo')
    await d.manage().window().setRect({ width: 900, height: 640 })
    await esperar(600)
    await captura('22-janela-pequena')
    await d.manage().window().setRect({ width: 1280, height: 820 })
  })
} finally {
  await d.quit().catch(() => {})
  driverProc.kill()
}

const falhas = resultados.filter((r) => !r.ok)
writeFileSync(path.join(CAPTURAS, '..', 'resultado-e2e.json'), JSON.stringify({ data: new Date().toISOString(), resultados }, null, 2))
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram.`)
process.exit(falhas.length ? 1 : 0)
