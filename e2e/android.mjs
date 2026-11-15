// Teste ponta-a-ponta da app REAL no Android (camada Rust + Kotlin + interface), num emulador.
// A interface é conduzida pelo protocolo DevTools do WebView, que só existe nos APK de teste
// (compilados com -PdepurarWebView=true; os publicados nunca o têm). As teclas do sistema
// (voltar, início) e as verificações do pacote vão por adb. Só usa dados claramente fictícios
// e começa sempre com os dados da app apagados (pm clear).
//
//   ORG_GRADLE_PROJECT_depurarWebView=true npx tauri android build --target x86_64 --apk
//   adb install -r <apk>
//   node e2e/android.mjs
//
// ALVO=simulador corre o mesmo percurso no simulador da interface (Chromium com
// ?simular=android, servidor do Vite em ENDERECO), sem os passos que precisam do Android:
// serve para validar o próprio teste num computador sem emulador.

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const RAIZ = path.resolve(import.meta.dirname, '..')
const PACOTE = 'pt.lisfilms.lissecurity'
const ATIVIDADE = `${PACOTE}/.MainActivity`
const SIMULADOR = process.env.ALVO === 'simulador'
const CAPTURAS = process.env.CAPTURAS ?? path.join(RAIZ, 'target', 'capturas-android')
const PORTA = 9333
const SENHA = 'cavalo-bateria-agrafo-correto-android'
const SEGREDO = 'SENHA-FICTICIA-ANDROID-4417'
const TITULO = 'Correio Exemplo Android'
mkdirSync(CAPTURAS, { recursive: true })

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
function assegurar(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ───────────────────────────── adb ─────────────────────────────

function adb(...args) {
  return execFileSync('adb', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] })
}
const shell = (...args) => adb('shell', ...args)
const tecla = (codigo) => shell('input', 'keyevent', String(codigo))
const VOLTAR = 4
const INICIO = 3

/** A atividade que está à frente (a que recebe o toque). */
function emPrimeiroPlano() {
  const t = shell('dumpsys', 'activity', 'activities')
  const linha = t.split('\n').find((l) => /topResumedActivity|mResumedActivity|ResumedActivity:/.test(l)) ?? ''
  return linha.includes(PACOTE)
}

async function esperarAte(cond, ms, msg) {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    try {
      if (await cond()) return
    } catch {}
    await esperar(250)
  }
  throw new Error(msg)
}

// ───────────────────────── DevTools (CDP) ─────────────────────────

class Cdp {
  constructor(url) {
    this.n = 0
    this.pendentes = new Map()
    this.ws = new WebSocket(url)
    this.ws.onmessage = (m) => {
      const r = JSON.parse(String(m.data))
      const p = r.id && this.pendentes.get(r.id)
      if (!p) return
      this.pendentes.delete(r.id)
      if (r.error) p.falha(new Error(`${r.error.message} (${r.error.code})`))
      else p.ok(r.result)
    }
    this.aberto = new Promise((ok, falha) => {
      this.ws.onopen = ok
      this.ws.onerror = () => falha(new Error('sem ligação ao DevTools do WebView'))
    })
  }
  enviar(method, params = {}) {
    const id = ++this.n
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((ok, falha) => {
      this.pendentes.set(id, { ok, falha })
      setTimeout(() => this.pendentes.has(id) && (this.pendentes.delete(id), falha(new Error(`${method} sem resposta`))), 30_000)
    })
  }
  fechar() {
    try {
      this.ws.close()
    } catch {}
  }
}

let cdp = null
let navegador = null

/** Liga-se ao WebView da app (Android) ou a um Chromium com o simulador. */
async function ligar() {
  cdp?.fechar()
  if (SIMULADOR) {
    if (!navegador) {
      const perfil = mkdtempSync(path.join(tmpdir(), 'lissecurity-cdp-'))
      const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium'
      navegador = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, '--window-size=412,915', '--no-sandbox', 'about:blank'], { stdio: 'ignore' })
      await esperarAte(async () => (await fetch(`http://127.0.0.1:${PORTA}/json/version`)).ok, 15_000, 'o Chromium não abriu o DevTools')
    }
  } else {
    let socket = ''
    await esperarAte(
      () => {
        const pid = shell('pidof', PACOTE).trim()
        const linhas = shell('cat', '/proc/net/unix')
        socket = (linhas.match(new RegExp(`@(webview_devtools_remote_${pid})\\b`)) ?? [])[1] ?? ''
        return !!pid && !!socket
      },
      40_000,
      'o WebView da app não abriu o DevTools (o APK foi compilado com -PdepurarWebView=true?)',
    )
    adb('forward', `tcp:${PORTA}`, `localabstract:${socket}`)
  }
  let alvo
  await esperarAte(
    async () => {
      const lista = await (await fetch(`http://127.0.0.1:${PORTA}/json/list`)).json()
      alvo = lista.find((p) => p.type === 'page' && (SIMULADOR || /tauri\.localhost/.test(p.url)))
      return !!alvo
    },
    30_000,
    'a página da app não apareceu no DevTools',
  )
  cdp = new Cdp(alvo.webSocketDebuggerUrl)
  await cdp.aberto
  await cdp.enviar('Runtime.enable')
  await cdp.enviar('Page.enable')
  if (SIMULADOR) {
    await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 1, mobile: true })
    await cdp.enviar('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }
}

/** Corre JavaScript na página e devolve o valor (falha se o script lançar um erro). */
async function js(expressao) {
  const r = await cdp.enviar('Runtime.evaluate', { expression: expressao, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(`erro na página: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}
const textoPagina = () => js('document.body.innerText')
const html = () => js('document.documentElement.outerHTML')

async function esperarTexto(texto, ms = 15_000) {
  try {
    await esperarAte(async () => (await textoPagina()).includes(texto), ms, '')
  } catch {
    const ecra = await textoPagina().catch(() => '')
    throw new Error(`"${texto}" não apareceu em ${ms / 1000} s. No ecrã: ${String(ecra).replace(/\s+/g, ' ').slice(0, 300)}`)
  }
}
async function semTexto(texto, ms = 10_000) {
  await esperarAte(async () => !(await textoPagina()).includes(texto), ms, `"${texto}" continua no ecrã`)
}

// Funções que correm dentro da página: encontrar um botão pelo texto ou pelo aria-label (o
// último diálogo aberto primeiro) e um campo pelo rótulo.
const AJUDANTES = `
  const visivel = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const raiz = () => { const d = [...document.querySelectorAll('[role="dialog"]')].filter(visivel); return d[d.length - 1] ?? document }
  const nome = (e) => (e.getAttribute('aria-label') || e.innerText || '').replace(/\\s+/g, ' ').trim()
  const botao = (t) => {
    const todos = [...raiz().querySelectorAll('button, [role="switch"], [role="radio"], [role="tab"], a, label')].filter(visivel)
    return todos.find((b) => nome(b) === t) ?? todos.find((b) => nome(b).startsWith(t)) ?? todos.find((b) => nome(b).includes(t))
  }
  const campo = (t) => {
    const r = raiz()
    const l = [...r.querySelectorAll('label')].find((x) => x.textContent.replace(/\\s+/g, ' ').trim().startsWith(t) && x.htmlFor)
    return (l && document.getElementById(l.htmlFor)) ?? r.querySelector('[aria-label="' + t + '"]') ?? [...r.querySelectorAll('input, textarea')].find((i) => i.placeholder === t)
  }
`

/** Toca no centro de um elemento, como um dedo (eventos de toque reais do Chromium). */
async function tocarEm(seletorJs, descricao) {
  let pos = null
  await esperarAte(
    async () => {
      pos = await js(`(() => { ${AJUDANTES}
        const e = ${seletorJs}
        if (!e || e.disabled || e.getAttribute('aria-disabled') === 'true') return null
        e.scrollIntoView({ block: 'center', inline: 'nearest' })
        const r = e.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })()`)
      return !!pos
    },
    15_000,
    `não encontrei «${descricao}» (ou estava desativado)`,
  )
  await esperar(120) // deixa o scroll assentar
  pos = await js(`(() => { ${AJUDANTES} const r = (${seletorJs}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await cdp.enviar('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pos.x, y: pos.y }] })
  await esperar(40)
  await cdp.enviar('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await esperar(350)
}
const tocar = (texto) => tocarEm(`botao(${JSON.stringify(texto)})`, texto)

/** Escreve num campo (pelo rótulo) com o teclado do sistema e confirma o que lá ficou. */
async function escrever(rotulo, valor) {
  const sel = `campo(${JSON.stringify(rotulo)})`
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await tocarEm(sel, `campo ${rotulo}`)
    await js(`(() => { ${AJUDANTES} const c = ${sel}; c.focus(); c.select?.() })()`)
    if (await js(`(() => { ${AJUDANTES} return ${sel}.value })()`)) {
      await cdp.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
      await cdp.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    }
    await cdp.enviar('Input.insertText', { text: valor })
    await esperar(150 + tentativa * 250)
    if ((await js(`(() => { ${AJUDANTES} return ${sel}.value })()`)) === valor) return
  }
  throw new Error(`o campo «${rotulo}» não ficou com o valor escrito`)
}

async function captura(nome) {
  await esperar(450)
  try {
    const { data } = await cdp.enviar('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(CAPTURAS, `${nome}.png`), data, 'base64')
  } catch {}
}

// ───────────────────────────── passos ─────────────────────────────

const resultados = []
let falhas = 0
async function passo(nome, f, { soAndroid = false } = {}) {
  if (soAndroid && SIMULADOR) {
    console.log(`– ${nome} (só no Android)`)
    return
  }
  try {
    await f()
    resultados.push({ nome, ok: true })
    console.log(`✔ ${nome}`)
  } catch (e) {
    resultados.push({ nome, ok: false })
    console.log(`✘ ${nome} — ${String(e?.message ?? e).split('\n')[0]}`)
    await captura(`falha-${++falhas}`)
  }
}

async function abrirApp({ limpar = false } = {}) {
  if (SIMULADOR) {
    await ligar()
    const base = process.env.ENDERECO ?? 'http://127.0.0.1:5174'
    await cdp.enviar('Page.navigate', { url: `${base}/?simular=android&fase=sem-cofre` })
    await esperar(1500)
    return
  }
  if (limpar) shell('pm', 'clear', PACOTE)
  shell('am', 'start', '-W', '-n', ATIVIDADE)
  await ligar()
}

async function desbloquear(senha = SENHA) {
  await escrever('Senha mestra', senha)
  await tocar('Desbloquear')
}

try {
  await passo(
    'o pacote não pede acesso à internet nem deixa o Android copiar os dados',
    () => {
      const t = shell('dumpsys', 'package', PACOTE)
      const pedidas = t.split('requested permissions:')[1]?.split(/install permissions:|runtime permissions:|User 0:/)[0] ?? ''
      assegurar(!pedidas.includes('android.permission.INTERNET'), 'o APK pede a permissão INTERNET')
      const flags = t.match(/pkgFlags=\[([^\]]*)\]/)?.[1] ?? ''
      assegurar(!flags.includes('ALLOW_BACKUP'), `cópias do Android permitidas (pkgFlags: ${flags.trim()})`)
    },
    { soAndroid: true },
  )

  await passo('primeiro uso mostra as boas-vindas (sem internet)', async () => {
    await abrirApp({ limpar: true })
    await esperarTexto('Criar um cofre novo', 40_000)
    const t = await textoPagina()
    assegurar(t.includes('telemóvel'), 'os textos ainda falam do computador')
    await captura('01-boas-vindas')
  })

  await passo('criar o cofre com chave de recuperação', async () => {
    await tocar('Criar um cofre novo')
    await escrever('Nome', 'Inês')
    await tocar('Continuar')
    await escrever('Senha mestra', SENHA)
    await esperar(500)
    if ((await textoPagina()).includes('quero usá-la')) await tocar('Percebo que esta senha é fraca')
    await tocar('Continuar')
    await escrever('Repetir a senha mestra', SENHA)
    await tocar('Continuar')
    await esperarTexto('Criar uma chave de recuperação')
    await tocar('Continuar')
    await tocar('Criar o cofre')
    await esperarTexto('CHAVE DE RECUPERAÇÃO', 90_000) // Argon2id num emulador sem aceleração demora
    await captura('02-chave-recuperacao')
    await tocar('Guardei a chave de recuperação')
    await tocar('Entrar no cofre')
    await esperarTexto('Bem-vindo', 20_000)
    await captura('03-visao-geral')
  })

  await passo(
    'o ecrã está protegido contra capturas (FLAG_SECURE)',
    () => {
      const t = shell('dumpsys', 'window', 'windows')
      const janela = new RegExp(`Window\\{[^}]*${PACOTE.replaceAll('.', '\\.')}/[^}]*MainActivity\\}`)
      const bloco = t.split(/\n(?=\s*Window #)/).find((b) => janela.test(b)) ?? ''
      assegurar(bloco, 'janela da app não encontrada no dumpsys')
      assegurar(/fl=[^\n]*SECURE/.test(bloco), 'a janela não tem FLAG_SECURE')
    },
    { soAndroid: true },
  )

  await passo('guardar uma senha com o botão «+»', async () => {
    await tocar('Senhas')
    await tocar('Novo registo')
    await escrever('Título', TITULO)
    await escrever('Utilizador', 'ines.teste')
    await escrever('Senha', SEGREDO)
    await captura('04-editor')
    await tocar('Guardar')
    await esperarTexto(TITULO, 20_000)
    await semTexto('Nova senha', 10_000)
  })

  await passo('o detalhe não tem a senha no DOM até ser revelada', async () => {
    if (!(await js(`!!document.querySelector('h2') && [...document.querySelectorAll('h2')].some((h) => h.innerText.trim() === ${JSON.stringify(TITULO)})`))) {
      await tocar(TITULO)
    }
    await esperarAte(async () => (await textoPagina()).includes('ines.teste'), 10_000, 'o detalhe não abriu')
    assegurar(!(await html()).includes(SEGREDO), 'a senha apareceu no DOM sem ser revelada')
    await tocar('Revelar senha')
    await esperarAte(async () => (await html()).includes(SEGREDO), 8000, 'revelar não mostrou a senha')
    await captura('05-detalhe-revelado')
    await tocar('Ocultar senha')
    await esperarAte(async () => !(await html()).includes(SEGREDO), 8000, 'ocultar não tirou a senha do DOM')
  })

  await passo('copiar a senha avisa quando a área de transferência é limpa', async () => {
    await tocar('Copiar senha')
    await esperarTexto('A área de transferência é limpa em')
  })

  await passo(
    'botão voltar: fecha o detalhe, volta ao início e manda a app para trás',
    async () => {
      tecla(VOLTAR)
      await esperarAte(async () => !(await textoPagina()).includes('ines.teste'), 8000, 'o detalhe não fechou com o voltar')
      tecla(VOLTAR)
      await esperarTexto('Bem-vindo', 8000)
      tecla(VOLTAR)
      await esperarAte(() => !emPrimeiroPlano(), 8000, 'a app não saiu da frente no ecrã inicial')
    },
    { soAndroid: true },
  )

  await passo(
    'ao voltar à app o cofre está bloqueado (Bloquear ao sair da app)',
    async () => {
      shell('am', 'start', '-n', ATIVIDADE)
      await ligar()
      await esperarTexto('Bloqueado porque saíste da app', 15_000)
      assegurar(!(await html()).includes(TITULO), 'o nome de um registo ficou no ecrã bloqueado')
      await captura('06-bloqueado')
    },
    { soAndroid: true },
  )

  await passo('a senha errada não abre o cofre', async () => {
    if (SIMULADOR) {
      await tocar('Bloquear o cofre')
      await esperarTexto('O teu cofre está bloqueado')
    }
    await desbloquear('abc')
    await esperarTexto('A senha não abre este cofre')
  })

  await passo('a senha certa abre o cofre', async () => {
    await desbloquear()
    await esperarTexto('Bem-vindo', 30_000)
  })

  await passo(
    'o cofre fica gravado: fechar a app, abrir e encontrar a senha',
    async () => {
      shell('am', 'force-stop', PACOTE)
      await esperar(800)
      shell('am', 'start', '-W', '-n', ATIVIDADE)
      await ligar()
      await esperarTexto('O teu cofre está bloqueado', 30_000)
      await desbloquear()
      await esperarTexto('Bem-vindo', 30_000)
      await tocar('Senhas')
      await esperarTexto(TITULO)
    },
    { soAndroid: true },
  )

  await passo('definições do telemóvel: sem opções do Windows', async () => {
    await tocar('Mais')
    await tocar('Definições')
    await esperarTexto('Bloquear ao sair da app')
    const t = await textoPagina()
    for (const so of ['Iniciar com o Windows', 'sessão do Windows', 'Ao fechar a janela', 'Atalhos de teclado']) assegurar(!t.includes(so), `aparece «${so}» no telemóvel`)
    await captura('07-definicoes')
  })

  await passo('bloquear à mão tira tudo do ecrã', async () => {
    await tocar('Bloquear o cofre')
    await esperarTexto('O teu cofre está bloqueado')
    assegurar(!(await html()).includes(TITULO), 'o nome de um registo ficou no DOM depois de bloquear')
  })
} finally {
  cdp?.fechar()
  navegador?.kill()
  if (!SIMULADOR) {
    try {
      adb('forward', '--remove', `tcp:${PORTA}`)
    } catch {}
  }
}

const ok = resultados.filter((r) => r.ok).length
console.log(`\n${ok}/${resultados.length} passos certos${SIMULADOR ? ' (simulador)' : ''}. Capturas em ${CAPTURAS}`)
process.exit(ok === resultados.length ? 0 : 1)
