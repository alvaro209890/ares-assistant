import { motion } from 'framer-motion'
import { useAres } from '../lib/store'

export default function TopBar(): JSX.Element {
  const { screen, navigate, openSettings, config, saveConfig } = useAres()
  const tabs: { id: 'assistant' | 'tasks' | 'calendar' | 'memory'; label: string }[] = [
    { id: 'assistant', label: 'ASSISTENTE' },
    { id: 'tasks', label: 'TAREFAS' },
    { id: 'calendar', label: 'CALENDÁRIO' },
    { id: 'memory', label: 'MEMÓRIA' }
  ]
  const muted = !config?.tts.enabled

  return (
    <header className="relative z-10 flex items-center justify-between px-7 py-4">
      <div className="flex items-center gap-3">
        <div className="relative h-7 w-7">
          <span className="absolute inset-0 rounded-full border border-cyan-300/60 animate-pulse-ring" />
          <span className="absolute inset-1.5 rounded-full bg-cyan-300 shadow-glow" />
        </div>
        <span className="font-display text-xl title-track text-cyan-100 neon-text">ARES</span>
      </div>

      <nav className="glass flex items-center gap-1 rounded-full p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(t.id)}
            className={`relative rounded-full px-5 py-1.5 text-xs title-track transition ${
              screen === t.id ? 'text-cyan-50' : 'text-cyan-200/50 hover:text-cyan-100'
            }`}
          >
            {screen === t.id && (
              <motion.span
                layoutId="tab-pill"
                className="absolute inset-0 rounded-full bg-cyan-400/15 border border-cyan-300/40"
              />
            )}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        {config && (
          <button
            onClick={() => saveConfig({ tts: { ...config.tts, enabled: muted } })}
            className={`glass flex h-9 w-9 items-center justify-center rounded-full transition ${
              muted ? 'text-amber-200/80' : 'text-cyan-200/70 hover:text-cyan-100'
            }`}
            title={muted ? 'Ativar fala' : 'Silenciar ARES'}
          >
            {muted ? <SpeakerOffIcon /> : <SpeakerIcon />}
          </button>
        )}
        <button
          onClick={() => openSettings(true)}
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-cyan-200/70 transition hover:text-cyan-100"
          title="Configurações"
        >
          <GearIcon />
        </button>
      </div>
    </header>
  )
}

function SpeakerIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" />
      <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" strokeLinecap="round" />
    </svg>
  )
}

function SpeakerOffIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 9v6h4l5 4V5L9 8" strokeLinejoin="round" />
      <path d="M3 3l18 18M17 9l4 4M21 9l-4 4" strokeLinecap="round" />
    </svg>
  )
}

function GearIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
