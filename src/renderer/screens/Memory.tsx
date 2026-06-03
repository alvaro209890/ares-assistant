import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAres } from '../lib/store'

export default function Memory(): JSX.Element {
  const { memory, addMemory, removeMemory, sessions, currentSessionId, openSession, createSession, renameSession, deleteSession } =
    useAres()
  const [fact, setFact] = useState('')

  const submitFact = () => {
    const t = fact.trim()
    if (!t) return
    void addMemory(t)
    setFact('')
  }

  return (
    <motion.div
      key="memory"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="grid h-full grid-cols-[minmax(320px,420px)_1fr] gap-4 px-7 pb-6"
    >
      <section className="glass flex min-h-0 flex-col rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm title-track text-cyan-100">CONVERSAS</h2>
          <button onClick={() => createSession()} className="btn-ghost px-3 py-1 text-[11px]">
            NOVA
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              active={s.id === currentSessionId}
              title={s.title}
              updatedAt={s.updatedAt}
              onOpen={() => openSession(s.id)}
              onRename={(title) => renameSession(s.id, title)}
              onDelete={() => deleteSession(s.id)}
            />
          ))}
        </div>
      </section>

      <section className="glass flex min-h-0 flex-col rounded-2xl p-4">
        <h2 className="font-display text-sm title-track text-cyan-100">MEMÓRIA DE LONGO PRAZO</h2>
        <div className="mt-4 flex gap-2">
          <input
            className="input flex-1"
            placeholder="Ex.: prefiro respostas curtas"
            value={fact}
            onChange={(e) => setFact(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitFact()}
          />
          <button onClick={submitFact} disabled={!fact.trim()} className="btn-ghost disabled:opacity-40">
            ADICIONAR
          </button>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
          {memory.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-cyan-200/40">Nenhum fato salvo ainda.</div>
          ) : (
            <div className="grid gap-2">
              {memory.map((m) => (
                <article key={m.id} className="flex items-start gap-3 rounded-xl border border-cyan-300/15 bg-black/20 p-3">
                  <p className="min-w-0 flex-1 text-sm text-cyan-50">{m.text}</p>
                  <button onClick={() => removeMemory(m.id)} className="text-cyan-200/50 hover:text-red-300" title="Remover">
                    <TrashIcon />
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </motion.div>
  )
}

function SessionRow({
  active,
  title,
  updatedAt,
  onOpen,
  onRename,
  onDelete
}: {
  active: boolean
  title: string
  updatedAt: number
  onOpen: () => void
  onRename: (title: string) => void
  onDelete: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const commit = () => {
    onRename(draft.trim() || title)
    setEditing(false)
  }
  return (
    <div className={`mb-2 rounded-xl border p-3 ${active ? 'border-cyan-300/45 bg-cyan-400/10' : 'border-cyan-300/15 bg-black/20'}`}>
      <div className="flex items-start gap-2">
        {editing ? (
          <input
            className="input min-w-0 flex-1 py-1"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <button onClick={onOpen} className="min-w-0 flex-1 text-left text-sm text-cyan-50">
            <span className="block truncate">{title}</span>
            <span className="mt-1 block text-[11px] text-cyan-200/45">{new Date(updatedAt).toLocaleString('pt-BR')}</span>
          </button>
        )}
        <button onClick={() => setEditing(true)} className="text-cyan-200/50 hover:text-cyan-100" title="Renomear">
          <EditIcon />
        </button>
        <button onClick={onDelete} className="text-cyan-200/50 hover:text-red-300" title="Apagar">
          <TrashIcon />
        </button>
      </div>
    </div>
  )
}

function EditIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrashIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 7h16M10 11v6M14 11v6M9 7l1-3h4l1 3M6 7l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
