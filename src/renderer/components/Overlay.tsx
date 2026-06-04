import { useEffect, useState } from 'react'
import type { AresState } from '../../shared/types'
import Orb3D from './Orb3D'

const LABEL: Record<AresState, string> = {
  idle: 'ARES',
  listening: 'OUVINDO',
  thinking: 'PENSANDO',
  speaking: 'FALANDO'
}

// Janela flutuante (always-on-top): mini-orbe que reflete o estado do Ares.
// Clique na orbe abre a janela principal; o botão do microfone pede uma escuta.
export default function Overlay(): JSX.Element {
  const [state, setState] = useState<AresState>('idle')

  useEffect(() => {
    document.body.style.background = 'transparent'
    const off = window.ares.overlay.onState(setState)
    return off
  }, [])

  return (
    <div className="overlay-root">
      <div className="overlay-drag" />
      <button
        className="overlay-orb"
        onClick={() => void window.ares.overlay.focusMain()}
        title="Abrir o Ares"
      >
        <Orb3D state={state} />
      </button>
      <div className="overlay-label">{LABEL[state]}</div>
      <button
        className="overlay-mic"
        onClick={(e) => {
          e.stopPropagation()
          void window.ares.overlay.command()
        }}
        title="Falar com o Ares"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
