import { useState, useEffect } from 'react'
import { useAres } from '../lib/store'
import Conversation from './Conversation'
import ConversationList from './ConversationList'
import Controls from './Controls'

interface ChatPanelProps {
  title?: string
  status?: string
  controls?: boolean
  className?: string
}

export default function ChatPanel({
  title = 'CONVERSA',
  status = '',
  controls = false,
  className = 'glass flex min-h-[420px] min-w-0 flex-col rounded-2xl p-4'
}: ChatPanelProps): JSX.Element {
  const { conversation, sessions, createSession, currentSessionId } = useAres()
  const [showHistory, setShowHistory] = useState(false)
  const [metrics, setMetrics] = useState({ chars: 0, limit: 128000, pct: 0 })

  useEffect(() => {
    if (currentSessionId && !showHistory) {
      window.ares.chat.getContextMetrics(currentSessionId).then(setMetrics)
    }
  }, [conversation, currentSessionId, showHistory])

  const handleCompact = async () => {
    if (!currentSessionId) return
    const compacted = await window.ares.chat.compact(currentSessionId)
    if (compacted) {
      window.ares.chat.getContextMetrics(currentSessionId).then(setMetrics)
    }
  }

  return (
    <section className={className}>
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h3 className="min-w-0 truncate text-xs title-track text-cyan-300/60">
          {showHistory ? 'HISTÓRICO' : title}
        </h3>
        <div className="flex shrink-0 items-center gap-3">
          {status && !showHistory && (
            <span className="max-w-[220px] truncate rounded-full border border-amber-300/20 bg-black/25 px-3 py-1 text-[11px] text-amber-200/85">
              {status}
            </span>
          )}
          {!showHistory && metrics.chars > 0 && (
            <button
              onClick={handleCompact}
              title="Compactar Contexto"
              className={`rounded-full border px-2 py-0.5 text-[10px] transition ${metrics.pct > 80 ? 'border-amber-400/50 text-amber-300/80 bg-amber-400/10 hover:bg-amber-400/20' : 'border-cyan-300/20 text-cyan-200/60 bg-black/25 hover:text-cyan-100 hover:bg-cyan-400/10'}`}
            >
              {Math.round(metrics.chars / 1024)}k / {Math.round(metrics.limit / 1024)}k ({metrics.pct}%)
            </button>
          )}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className={`text-xs transition ${showHistory ? 'text-cyan-100' : 'text-cyan-200/60 hover:text-cyan-100'}`}
            title="Ver histórico de conversas"
          >
            HISTÓRICO{sessions.length ? ` (${sessions.length})` : ''}
          </button>
          <button
            onClick={() => {
              void createSession()
              setShowHistory(false)
            }}
            className="text-xs text-cyan-200/60 hover:text-cyan-100"
          >
            NOVA
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {showHistory ? <ConversationList onPick={() => setShowHistory(false)} /> : <Conversation messages={conversation} />}
      </div>
      {controls && (
        <div className="mt-3">
          <Controls />
        </div>
      )}
    </section>
  )
}
