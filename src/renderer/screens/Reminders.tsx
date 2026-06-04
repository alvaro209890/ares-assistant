import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useAres } from '../lib/store'
import type { Recurrence, Reminder } from '../../shared/types'

const REC_LABEL: Record<Recurrence, string> = { none: 'uma vez', daily: 'diário', weekly: 'semanal', monthly: 'mensal' }
const KIND_LABEL: Record<Reminder['kind'], string> = { reminder: 'Lembrete', timer: 'Timer', alarm: 'Despertador' }
const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export default function Reminders(): JSX.Element {
  const { reminders, addReminder, removeReminder } = useAres()
  const [text, setText] = useState('')
  const [when, setWhen] = useState('')
  const [minutes, setMinutes] = useState(0)
  const [recurrence, setRecurrence] = useState<Recurrence>('none')

  const ordered = useMemo(() => [...reminders].sort((a, b) => a.whenISO.localeCompare(b.whenISO)), [reminders])

  const submit = () => {
    const t = text.trim()
    if (!t) return
    const whenISO = minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : when ? new Date(when).toISOString() : ''
    if (!whenISO) return
    void addReminder({ text: t, whenISO, recurrence: recurrence !== 'none' ? recurrence : undefined, kind: 'reminder' })
    setText('')
    setWhen('')
    setMinutes(0)
    setRecurrence('none')
  }

  const quickTimer = (min: number) =>
    void addReminder({ text: `Timer de ${min} min`, whenISO: new Date(Date.now() + min * 60_000).toISOString(), kind: 'timer' })

  return (
    <motion.div
      key="reminders"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="grid h-full min-h-[680px] gap-4 p-5 lg:grid-cols-[360px_minmax(0,1fr)]"
    >
      <section className="glass flex min-w-0 flex-col rounded-2xl p-4">
        <h2 className="font-display text-sm title-track text-cyan-100">NOVO LEMBRETE</h2>
        <div className="mt-4 flex flex-col gap-3">
          <input className="input" placeholder="Ex.: tomar remédio" value={text} onChange={(e) => setText(e.target.value)} />
          <label className="text-[11px] text-cyan-200/60">
            Data e hora
            <input className="input mt-1" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <label className="text-[11px] text-cyan-200/60">
            …ou daqui a (minutos)
            <input
              className="input mt-1"
              type="number"
              min={0}
              value={minutes || ''}
              onChange={(e) => setMinutes(Number(e.target.value) || 0)}
              placeholder="0"
            />
          </label>
          <label className="text-[11px] text-cyan-200/60">
            Repetir
            <select className="input mt-1" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              <option value="none">uma vez</option>
              <option value="daily">todo dia</option>
              <option value="weekly">toda semana</option>
              <option value="monthly">todo mês</option>
            </select>
          </label>
          <button onClick={submit} disabled={!text.trim() || (!when && minutes <= 0)} className="btn-ghost disabled:opacity-40">
            CRIAR LEMBRETE
          </button>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[5, 10, 15, 25].map((m) => (
              <button
                key={m}
                onClick={() => quickTimer(m)}
                className="rounded-full border border-cyan-300/25 px-2.5 py-1 text-[11px] text-cyan-200/70 hover:text-cyan-100"
              >
                ⏱ {m} min
              </button>
            ))}
          </div>
          <p className="text-[11px] text-cyan-200/45">Por voz: “me lembra do remédio todo dia às 8h”, “põe um timer de 10 minutos”.</p>
        </div>
      </section>

      <section className="glass flex min-h-0 min-w-0 flex-col rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm title-track text-cyan-100">SEUS LEMBRETES</h2>
          <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-xs text-cyan-200/60">{ordered.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {ordered.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-cyan-200/40">Nenhum lembrete ativo.</div>
          ) : (
            <div className="grid gap-2">
              {ordered.map((r) => (
                <article key={r.id} className="flex items-start gap-3 rounded-xl border border-cyan-300/15 bg-black/20 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-cyan-50">{r.text}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="rounded-full border border-cyan-300/20 px-1.5 py-0.5 text-cyan-200/70">{KIND_LABEL[r.kind]}</span>
                      <span className="text-amber-200/80">{fmt(r.whenISO)}</span>
                      {r.recurrence && (
                        <span className="rounded-full border border-indigo-300/30 px-1.5 py-0.5 text-indigo-200/80">↻ {REC_LABEL[r.recurrence]}</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => removeReminder(r.id)} className="text-cyan-200/50 hover:text-red-300" title="Remover">
                    ✕
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
