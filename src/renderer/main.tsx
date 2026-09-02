import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './app/App'
import './design-system/base.css'

const root = document.getElementById('root')
if (!root) throw new Error('Family Circle renderer root was not found')

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
