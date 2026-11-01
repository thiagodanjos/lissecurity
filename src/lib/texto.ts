/** Minúsculas e sem acentos, para comparar texto ("Ação" = "acao"). */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}
