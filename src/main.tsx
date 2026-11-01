import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// fonte empacotada na aplicação (nada é carregado da internet)
import '@fontsource-variable/inter'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
