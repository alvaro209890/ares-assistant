import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAres } from '../lib/store'

// Controles do assistente: push-to-talk, campo de texto e modo conversa contínua.
export default function Controls(): JSX.Element {
  const { aresState, recording, continuous, beginPushToTalk, endPushToTalk, sendText, toggleContinuous, config, saveConfig } =
    useAres()
  const [text, setText] = useState('')
  const busy = aresState === 'thinking'
  const wake = config?.ui.wakeWord || 'ares'
  const wakeOn = !!config?.ui.wakeWordEnabled

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

      {/* Toggles de conversa contínua + wake word */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={toggleContinuous}
          className={`rounded-full border px-3 py-1 text-xs title-track transition ${
            continuous
              ? 'border-emerald-300/60 text-emerald-200 bg-emerald-400/10'
              : 'border-cyan-300/20 text-cyan-200/60 hover:text-cyan-100'
          }`}
        >
          {continuous ? '● CONVERSA CONTÍNUA ATIVA' : '○ CONVERSA CONTÍNUA'}
        </button>
        <button
          onClick={() => config && saveConfig({ ui: { wakeWordEnabled: !wakeOn } })}
          title={`Na conversa contínua, só age após ouvir "${wake}".`}
          className={`rounded-full border px-3 py-1 text-xs title-track transition ${
            wakeOn
              ? 'border-cyan-300/60 text-cyan-100 bg-cyan-400/10'
              : 'border-cyan-300/20 text-cyan-200/60 hover:text-cyan-100'
          }`}
        >
          {wakeOn ? `● EXIGIR “${wake.toUpperCase()}”` : `○ EXIGIR “${wake.toUpperCase()}”`}
        </button>
        {/* Exportar Demo Mode */}
        {aresState !== 'thinking' && (
          <button
            onClick={() => window.ares.demo.export().then(ok => { if (ok) alert('Apresentação exportada com sucesso!') })}
            className="rounded-full border border-cyan-300/20 px-3 py-1 text-xs title-track text-cyan-200/60 transition hover:border-cyan-300/60 hover:text-cyan-100"
            title="Exportar apresentação do Demo Mode (ZIP)"
          >
            ⬇ EXPORTAR DEMO
          </button>
        )}
      </div>
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
