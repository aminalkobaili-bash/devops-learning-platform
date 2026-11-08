import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// HashRouter: маршрут живёт после # (/#/p/sql), поэтому статическому хостингу
// (GitHub Pages) не нужно знать о маршрутах — прямые ссылки не дают 404
import { HashRouter } from 'react-router'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
