export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

/** Cor discreta e estável para o ícone de um registo (a partir do nome), sempre legível. */
const TONS = ['#1ed760', '#22a7ff', '#a78bfa', '#f5a524', '#f472b6', '#2dd4bf', '#fb7185', '#facc15']
export function tomDe(texto: string): string {
  let h = 0
  for (const c of texto.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return TONS[h % TONS.length]
}

export function inicial(texto: string): string {
  const t = texto.replace(/^(https?:\/\/)?(www\.)?/i, '').trim()
  const c = [...t].find((x) => /\p{L}|\p{N}/u.test(x))
  return (c ?? '?').toUpperCase()
}

export const atraso = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Espera que o navegador pinte (dois frames): usado para esconder dados ANTES de minimizar. */
export const depoisDePintar = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
