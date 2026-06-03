import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAres } from '../lib/store'

// Controles do assistente: push-to-talk, campo de texto e modo conversa contínua.
export default function Controls(): JSX.Element {
  const { aresState, recording, continuous, beginPushToTalk, endPushToTalk, sendText, toggleContinuous } = useAres()
  const [text, setText] = useState('')
  const busy = aresState === 'thinking'

  const submit = () => {
    const t = text.trim()
    if (!t || busy) return
    setText('')
    void sendText(t)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {/* Push-to-talk */}
        <motion.button
          whileTap={{ scale: 0.94 }}
          onPointerDown={() => beginPushToTalk()}
          onPointerUp={() => endPushToTalk()}
          onPointerLeave={() => recording && endPushToTalk()}
          disabled={continuous || busy}
          className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition ${
            recording
              ? 'border-emerald-300 bg-emerald-400/20 shadow-glow'
              : 'border-cyan-300/40 bg-cyan-400/10 hover:bg-cyan-400/20'
          } disabled:opacity-40`}
          title="Segure para falar"
        >
          {recording && (
            <motion.span
              className="absolute inset-0 rounded-full border border-emerald-300/60"
              animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
              transition={{ duration: 1.1, repeat: Infinity }}
            />
          )}
          <MicIcon />
        </motion.button>

        {/* Campo de texto */}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Digite para o Ares… (ou segure o microfone)"
          className="h-12 min-w-0 flex-1 rounded-xl border border-cyan-300/20 bg-black/30 px-4 text-cyan-50 outline-none placeholder:text-cyan-200/30 focus:border-cyan-300/50"
        />

        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="h-12 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-5 text-sm title-track text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-40"
        >
          ENVIAR
        </button>
      </div>

      {/* Toggle de conversa contínua */}
      <button
        onClick={toggleContinuous}
        className={`self-start rounded-full border px-3 py-1 text-xs title-track transition ${
          continuous
            ? 'border-emerald-300/60 text-emerald-200 bg-emerald-400/10'
            : 'border-cyan-300/20 text-cyan-200/60 hover:text-cyan-100'
        }`}
      >
        {continuous ? '● CONVERSA CONTÍNUA ATIVA' : '○ CONVERSA CONTÍNUA'}
      </button>
    </div>
  )
}

function MicIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-cyan-100">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  )
}
