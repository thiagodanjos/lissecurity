import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// fonte empacotada na aplicação (nada é carregado da internet)
import '@fontsource-variable/inter'
import './index.css'
import App from './App'

async function arrancar() {
  // Só em desenvolvimento, com ?simular=android|windows: um cofre fictício em memória no lugar
  // da camada nativa, para desenhar e testar ecrãs num navegador. Fora do `npm run dev` este
  // ramo não existe (o Vite remove-o da compilação final).
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('simular')) {
    await import('./dev/simulacao')
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void arrancar()
