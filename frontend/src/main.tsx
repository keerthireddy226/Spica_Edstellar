import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { i18nReady } from './i18n'
import { trackMediaStreams } from './lib/mediaTracks'

// Keeps a list of camera, microphone and screen streams, so a finished test
// can turn them all off at once.
trackMediaStreams()

// The app is loaded only after the starting language is ready, so text
// that screens work out when they first load is already translated.
i18nReady.finally(async () => {
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})
