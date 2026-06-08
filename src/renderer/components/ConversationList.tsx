import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAres } from '../lib/store'

// Tempo relativo curto em pt-BR (ex.: "agora", "5 min", "3 h", "ontem", "12/05").
function relTime(ms: number): string {
  const diff = Date.now() - ms
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ontem'
  if (d < 7) return `${d} d`
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/**
 * Lista o histórico de conversas (sessões). Permite abrir, renomear (duplo clique
 * ou lápis) e excluir. O item ativo fica destacado. `onPick` é chamado ao abrir
 * uma conversa para que a tela possa voltar à transcrição.
 */
export default function ConversationList({ onPick }: { onPick?: () => void }): JSX.Element {
  const { sessions, currentSessionId, openSession, renameSession, deleteSession } = useAres()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) inputRef.current?.focus()
  }, [editingId])

  const startEdit = (id: string, title: string): void => {
    setConfirmId(null)
    setEditingId(id)
    setDraft(title)
  }

  const commitEdit = (): void => {
    if (editingId) {
      const t = draft.trim()
      if (t) void renameSession(editingId, t)
    }
    setEditingId(null)
  }

  const pick = (id: string): void => {
    if (id !== currentSessionId) void openSession(id)
    onPick?.()
  }

  return (
    <div className="selectable flex h-full flex-col gap-1.5 overflow-y-auto pr-1">
      {sessions.length === 0 && (
        <div className="m-auto text-center text-cyan-200/40">
          <p className="text-xs">Nenhuma conversa ainda.</p>
        </div>
      )}
      <AnimatePresence initial={false}>
        {sessions.map((s) => {
          const active = s.id === currentSessionId
          const editing = s.id === editingId
          return (
            <motion.div
              key={s.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className={`group relative flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                active
                  ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-50 shadow-glow'
                  : 'border-white/5 bg-white/[0.02] text-cyan-100/80 hover:border-cyan-300/20 hover:bg-cyan-400/[0.06]'
              }`}
            >
              {editing ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="min-w-0 flex-1 rounded-md border border-cyan-300/30 bg-black/30 px-2 py-1 text-sm text-cyan-50 outline-none"
                />
              ) : (
                <button
                  onClick={() => pick(s.id)}
                  onDoubleClick={() => startEdit(s.id, s.title)}
                  className="min-w-0 flex-1 text-left"
                  title={s.title}
                >
                  <div className="truncate">{s.title}</div>
                  <div className="mt-0.5 text-[10px] text-cyan-300/40">{relTime(s.updatedAt)}</div>
                </button>
              )}

              {!editing && confirmId !== s.id && (
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => startEdit(s.id, s.title)}
                    className="rounded-md p-1 text-cyan-200/50 hover:bg-white/10 hover:text-cyan-100"
                    title="Renomear"
                    aria-label="Renomear conversa"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => setConfirmId(s.id)}
                    className="rounded-md p-1 text-cyan-200/50 hover:bg-rose-400/20 hover:text-rose-200"
                    title="Excluir"
                    aria-label="Excluir conversa"
                  >
                    🗑
                  </button>
                </div>
              )}

              {confirmId === s.id && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => {
                      void deleteSession(s.id)
                      setConfirmId(null)
                    }}
                    className="rounded-md bg-rose-500/20 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/30"
                  >
                    Excluir
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="rounded-md px-2 py-1 text-[11px] text-cyan-200/60 hover:text-cyan-100"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
