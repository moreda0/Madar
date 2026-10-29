import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initSync } from './lib/sync'

initSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline support + installability. Skipped in the single-file preview build.
if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_SINGLEFILE) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* not available here (e.g. inside a sandboxed frame) */
    })
  })
}
