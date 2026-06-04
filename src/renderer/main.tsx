import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Overlay from './components/Overlay'
import { AresProvider } from './lib/store'
import './index.css'

// A mesma janela renderer atende dois modos: app completo e a mini-orbe flutuante
// (carregada com #overlay). A orbe não monta o AresProvider (não usa microfone/STT).
const isOverlay = window.location.hash.replace('#', '') === 'overlay'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? (
      <Overlay />
    ) : (
      <AresProvider>
        <App />
      </AresProvider>
    )}
  </React.StrictMode>
)
