import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// O LisSecurity não carrega nada da internet: fontes, ícones e scripts vão todos no pacote.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port: 5174, strictPort: true, host: 'localhost' },
  build: {
    target: 'es2022',
    sourcemap: false,
    // sem ficheiros "inline" em data: — a CSP só permite scripts do próprio pacote
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
