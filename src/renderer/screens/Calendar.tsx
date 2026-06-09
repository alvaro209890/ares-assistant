import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useAres } from '../lib/store'
import Select from '../components/Select'
import type { CalendarEvent, Recurrence } from '../../shared/types'

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const REC_LABEL: Record<Recurrence, string> = { none: 'sem repetição', daily: 'diário', weekly: 'semanal', monthly: 'mensal' }
const DAY = 86400_000

type View = 'todos' | 'hoje' | 'semana'

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10)
const sameDay = (iso: string, ref = new Date()) => {
  const d = new Date(iso)
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
}

export default function Calendar(): JSX.Element {
  const { events, addEvent, removeEvent } = useAres()
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState('')
  const [description, setDescription] = useState('')
  const [remind, setRemind] = useState(0)
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [view, setView] = useState<View>('todos')

  const filtered = useMemo(() => {
    const now = Date.now()
    const list = [...events].sort((a, b) => a.whenISO.localeCompare(b.whenISO))
    if (view === 'hoje') return list.filter((e) => sameDay(e.whenISO))
    if (view === 'semana')
      return list.filter((e) => {
        const t = new Date(e.whenISO).getTime()
        return t >= now - DAY && t <= now + 7 * DAY
      })
    return list
  }, [events, view])

  // Agrupa por dia para "agenda por dia".
  const groups = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of filtered) {
      const k = dayKey(e.whenISO)
      const arr = map.get(k) || []
      arr.push(e)
      map.set(k, arr)
    }
    return Array.from(map.entries())
  }, [filtered])

  const submit = () => {
    const t = title.trim()
    if (!t || !when) return
    void addEvent({
      title: t,
      whenISO: new Date(when).toISOString(),
      description: description.trim() || undefined,
      remindMinutes: remind > 0 ? remind : undefined,
      recurrence: recurrence !== 'none' ? recurrence : undefined
    })
    setTitle('')
    setWhen('')
    setDescription('')
    setRemind(0)
    setRecurrence('none')
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
            className="input min-h-[72px] resize-none"
            placeholder="Descrição"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-cyan-200/60">
              Avisar antes
              <div className="mt-1">
                <Select
                  ariaLabel="Avisar antes"
                  value={String(remind)}
                  onChange={(v) => setRemind(Number(v))}
                  options={[
                    { value: '0', label: 'na hora' },
                    { value: '5', label: '5 min' },
                    { value: '10', label: '10 min' },
                    { value: '15', label: '15 min' },
                    { value: '30', label: '30 min' },
                    { value: '60', label: '1 hora' },
                    { value: '1440', label: '1 dia' }
                  ]}
                />
              </div>
            </label>
            <label className="text-[11px] text-cyan-200/60">
              Repetir
              <div className="mt-1">
                <Select
                  ariaLabel="Repetir"
                  value={recurrence}
                  onChange={(v) => setRecurrence(v as Recurrence)}
                  options={[
                    { value: 'none', label: 'não repetir' },
                    { value: 'daily', label: 'diário' },
                    { value: 'weekly', label: 'semanal' },
                    { value: 'monthly', label: 'mensal' }
                  ]}
                />
              </div>
            </label>
          </div>
          <button onClick={submit} disabled={!title.trim() || !when} className="btn-ghost disabled:opacity-40">
            CRIAR EVENTO
          </button>
        </div>
      </section>

      <section className="glass flex min-h-0 min-w-0 flex-col rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-display text-sm title-track text-cyan-100">EVENTOS</h2>
          <div className="flex gap-1">
            {(['todos', 'hoje', 'semana'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] title-track transition ${
                  view === v ? 'border-cyan-300/50 bg-cyan-400/10 text-cyan-100' : 'border-cyan-300/15 text-cyan-200/55'
                }`}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {groups.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-cyan-200/40">Nenhum evento.</div>
          ) : (
            <div className="grid gap-4">
              {groups.map(([key, evs]) => (
                <div key={key}>
                  <h3 className="mb-2 text-[11px] capitalize text-cyan-300/55">
                    {new Date(key + 'T12:00').toLocaleDateString('pt-BR', {
                      weekday: 'long',
                      day: '2-digit',
                      month: 'long'
                    })}
                  </h3>
                  <div className="grid gap-2">
                    {evs.map((event) => (
                      <article key={event.id} className="rounded-xl border border-cyan-300/15 bg-black/20 p-3">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-cyan-50">{event.title}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="text-amber-200/80">{fmtTime(event.whenISO)}</span>
                              {event.recurrence && event.recurrence !== 'none' && (
                                <span className="rounded-full border border-indigo-300/30 px-1.5 py-0.5 text-indigo-200/80">
                                  ↻ {REC_LABEL[event.recurrence]}
                                </span>
                              )}
                              {event.remindMinutes ? (
                                <span className="rounded-full border border-cyan-300/25 px-1.5 py-0.5 text-cyan-200/70">
                                  avisa {event.remindMinutes >= 60 ? `${event.remindMinutes / 60}h` : `${event.remindMinutes}min`} antes
                                </span>
                              ) : null}
                            </div>
                            {event.description && <p className="mt-2 text-xs text-cyan-200/55">{event.description}</p>}
                          </div>
                          <button onClick={() => removeEvent(event.id)} className="text-cyan-200/50 hover:text-red-300" title="Remover">
                            <TrashIcon />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
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
