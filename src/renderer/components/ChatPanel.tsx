import { useState } from 'react'
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
  const { conversation, sessions, createSession } = useAres()
  const [showHistory, setShowHistory] = useState(false)

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
