import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design-system/base.css'

const root = document.getElementById('root')
if (!root) throw new Error('Family Circle renderer root was not found')

createRoot(root).render(
  <StrictMode>
    <main aria-label="Family Circle application">Family Circle</main>
  </StrictMode>,
)
