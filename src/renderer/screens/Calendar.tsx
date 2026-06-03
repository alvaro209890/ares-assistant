import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useAres } from '../lib/store'

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export default function Calendar(): JSX.Element {
  const { events, addEvent, removeEvent } = useAres()
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState('')
  const [description, setDescription] = useState('')
  const ordered = useMemo(() => [...events].sort((a, b) => a.whenISO.localeCompare(b.whenISO)), [events])

  const submit = () => {
    const t = title.trim()
    if (!t || !when) return
    void addEvent({ title: t, whenISO: new Date(when).toISOString(), description: description.trim() || undefined })
    setTitle('')
    setWhen('')
    setDescription('')
  }

  return (
    <motion.div
      key="calendar"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="grid h-full min-h-[680px] gap-4 p-5 lg:grid-cols-[360px_minmax(0,1fr)]"
    >
      <section className="glass flex min-w-0 flex-col rounded-2xl p-4">
        <h2 className="font-display text-sm title-track text-cyan-100">AGENDA LOCAL</h2>
        <div className="mt-4 flex flex-col gap-3">
          <input className="input" placeholder="Título do evento" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <textarea
            className="input min-h-[86px] resize-none"
            placeholder="Descrição"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button onClick={submit} disabled={!title.trim() || !when} className="btn-ghost disabled:opacity-40">
            CRIAR EVENTO
          </button>
        </div>
      </section>

      <section className="glass flex min-h-0 min-w-0 flex-col rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm title-track text-cyan-100">EVENTOS</h2>
          <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-xs text-cyan-200/60">{ordered.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {ordered.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-cyan-200/40">Nenhum evento local.</div>
          ) : (
            <div className="grid gap-3">
              {ordered.map((event) => (
                <article key={event.id} className="rounded-xl border border-cyan-300/15 bg-black/20 p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-cyan-50">{event.title}</p>
                      <p className="mt-1 text-xs text-amber-200/80">{fmt(event.whenISO)}</p>
                      {event.description && <p className="mt-2 text-xs text-cyan-200/55">{event.description}</p>}
                    </div>
                    <button onClick={() => removeEvent(event.id)} className="text-cyan-200/50 hover:text-red-300" title="Remover">
                      <TrashIcon />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </motion.div>
  )
}

function TrashIcon(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 7h16M10 11v6M14 11v6M9 7l1-3h4l1 3M6 7l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
