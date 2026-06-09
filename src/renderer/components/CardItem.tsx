import { useState } from 'react'
import { Draggable } from '@hello-pangea/dnd'
import { motion } from 'framer-motion'
import type { Card, CardColor, CardLink, Priority, Recurrence, Subtask } from '../../shared/types'
import { uid } from '../lib/actions'
import Select from './Select'

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'não repetir' },
  { value: 'daily', label: 'diário' },
  { value: 'weekly', label: 'semanal' },
  { value: 'monthly', label: 'mensal' }
]

const REC_LABEL: Record<Recurrence, string> = { none: '', daily: 'diário', weekly: 'semanal', monthly: 'mensal' }

export const COLOR_BAR: Record<CardColor, string> = {
  cyan: 'from-cyan-400 to-sky-500',
  blue: 'from-blue-500 to-indigo-500',
  green: 'from-emerald-400 to-teal-500',
  amber: 'from-amber-400 to-orange-500',
  pink: 'from-pink-400 to-fuchsia-500'
}
const COLOR_DOT: Record<CardColor, string> = {
  cyan: 'bg-cyan-400',
  blue: 'bg-blue-500',
  green: 'bg-emerald-400',
  amber: 'bg-amber-400',
  pink: 'bg-pink-400'
}
const COLORS: CardColor[] = ['cyan', 'blue', 'green', 'amber', 'pink']
const PRIORITIES: Priority[] = ['baixa', 'media', 'alta']
const PRIORITY_CLASS: Record<Priority, string> = {
  baixa: 'border-emerald-300/35 text-emerald-200',
  media: 'border-amber-300/35 text-amber-200',
  alta: 'border-red-300/45 text-red-200'
}

interface Props {
  card: Card
  index: number
  onSave: (patch: Partial<Card>) => void
  onDelete: () => void
  onToggle: () => void
}

const toInputDate = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60_000)
  return local.toISOString().slice(0, 16)
}
const fromInputDate = (v: string) => (v ? new Date(v).toISOString() : undefined)

export default function CardItem({ card, index, onSave, onDelete, onToggle }: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(card.title)
  const [desc, setDesc] = useState(card.description ?? '')
  const [due, setDue] = useState(toInputDate(card.due))
  const [reminder, setReminder] = useState(toInputDate(card.reminderAt))
  const [priority, setPriority] = useState<Priority>(card.priority ?? 'media')
  const [color, setColor] = useState<CardColor>(card.color ?? 'cyan')
  const [labels, setLabels] = useState((card.labels ?? []).join(', '))
  const [recurrence, setRecurrence] = useState<Recurrence>(card.recurrence ?? 'none')
  const [newSubtask, setNewSubtask] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')

  const subtasks = card.subtasks ?? []
  const doneSubs = subtasks.filter((s) => s.done).length
  const progress = subtasks.length ? Math.round((doneSubs / subtasks.length) * 100) : 0
  const links = card.links ?? []

  const save = () => {
    const parsedLabels = labels
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean)
    onSave({
      title: title.trim() || card.title,
      description: desc.trim() || undefined,
      due: fromInputDate(due),
      reminderAt: fromInputDate(reminder),
      reminded: reminder !== toInputDate(card.reminderAt) ? false : card.reminded,
      priority,
      color,
      labels: parsedLabels.length ? Array.from(new Set(parsedLabels)) : undefined,
      recurrence: recurrence !== 'none' ? recurrence : undefined
    })
    setEditing(false)
  }

  const addLink = () => {
    const url = linkUrl.trim()
    if (!url) return
    onSave({ links: [...links, { label: linkLabel.trim() || url, url }] })
    setLinkLabel('')
    setLinkUrl('')
  }
  const removeLink = (i: number) => onSave({ links: links.filter((_, idx) => idx !== i) })
  const openLink = (l: CardLink) => void window.ares.system.openExternal(l.url)

  const saveSubtasks = (next: Subtask[]) => onSave({ subtasks: next })
  const addSubtask = () => {
    const text = newSubtask.trim()
    if (!text) return
    saveSubtasks([...(card.subtasks ?? []), { id: uid('st'), text, done: false }])
    setNewSubtask('')
  }

  return (
    <Draggable draggableId={card.id} index={index} isDragDisabled={editing}>
      {(provided, snapshot) => (
        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} style={provided.draggableProps.style}>
          <motion.div
            layout
            className={`group relative mb-2.5 overflow-hidden rounded-xl border bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-3 transition ${
              snapshot.isDragging ? 'border-cyan-300/70 shadow-glow-lg' : 'border-cyan-300/15 hover:border-cyan-300/40'
            } ${card.done ? 'opacity-60' : ''}`}
          >
            <span className={`absolute left-0 top-0 h-full w-1 bg-gradient-to-b ${COLOR_BAR[card.color ?? 'cyan']}`} />

            {editing ? (
              <div className="flex flex-col gap-2 pl-1">
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                <textarea
                  className="input min-h-[56px] resize-none"
                  placeholder="Descrição"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-cyan-200/60">
                    Prazo
                    <input className="input mt-1" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
                  </label>
                  <label className="text-[11px] text-cyan-200/60">
                    Lembrete
                    <input className="input mt-1" type="datetime-local" value={reminder} onChange={(e) => setReminder(e.target.value)} />
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    ariaLabel="Prioridade"
                    className="flex-1"
                    value={priority}
                    onChange={(v) => setPriority(v as Priority)}
                    options={PRIORITIES.map((p) => ({ value: p, label: `prioridade ${p}` }))}
                  />
                  <div className="flex gap-1">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`h-5 w-5 rounded-full ${COLOR_DOT[c]} ${color === c ? 'ring-2 ring-white/70' : ''}`}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-cyan-200/60">
                    Etiquetas (vírgula)
                    <input
                      className="input mt-1"
                      placeholder="casa, urgente"
                      value={labels}
                      onChange={(e) => setLabels(e.target.value)}
                    />
                  </label>
                  <label className="text-[11px] text-cyan-200/60">
                    Repetir
                    <div className="mt-1">
                      <Select
                        ariaLabel="Repetir"
                        value={recurrence}
                        onChange={(v) => setRecurrence(v as Recurrence)}
                        options={RECURRENCE_OPTIONS}
                      />
                    </div>
                  </label>
                </div>

                <div className="rounded-lg border border-cyan-300/10 bg-black/20 p-2">
                  <div className="mb-1 text-[11px] text-cyan-200/55">Links / anexos</div>
                  {links.length > 0 && (
                    <div className="mb-2 grid gap-1">
                      {links.map((l, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-cyan-100/80">
                          <button type="button" onClick={() => openLink(l)} className="min-w-0 flex-1 truncate text-left hover:text-cyan-50" title={l.url}>
                            ↗ {l.label}
                          </button>
                          <button type="button" onClick={() => removeLink(i)} className="text-cyan-200/45 hover:text-red-300">
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1">
                    <input className="input flex-1 py-1" placeholder="nome" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />
                    <input
                      className="input flex-[2] py-1"
                      placeholder="https:// ou file://"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addLink()}
                    />
                    <button onClick={addLink} className="btn-ghost px-2">
                      +
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Nova subtarefa"
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addSubtask()}
                  />
                  <button onClick={addSubtask} className="btn-ghost px-2">
                    +
                  </button>
                </div>
                {subtasks.length > 0 && (
                  <div className="grid gap-1 rounded-lg border border-cyan-300/10 bg-black/20 p-2">
                    {subtasks.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-xs text-cyan-100/80">
                        <input
                          type="checkbox"
                          checked={s.done}
                          onChange={() => saveSubtasks(subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))}
                          className="accent-cyan-400"
                        />
                        <span className={s.done ? 'line-through opacity-55' : ''}>{s.text}</span>
                        <button
                          type="button"
                          onClick={() => saveSubtasks(subtasks.filter((x) => x.id !== s.id))}
                          className="ml-auto text-cyan-200/45 hover:text-red-300"
                        >
                          x
                        </button>
                      </label>
                    ))}
                  </div>
                )}
                <div className="ml-auto flex gap-2">
                  <button onClick={save} className="text-xs title-track text-cyan-200 hover:text-cyan-50">
                    SALVAR
                  </button>
                  <button onClick={() => setEditing(false)} className="text-xs title-track text-cyan-200/50">
                    CANCELAR
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 pl-1">
                <button
                  onClick={onToggle}
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    card.done ? 'border-emerald-400 bg-emerald-400/30' : 'border-cyan-300/40'
                  }`}
                  title={card.done ? 'Reabrir' : 'Concluir'}
                >
                  {card.done && <span className="text-[10px] text-emerald-200">✓</span>}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <p className={`min-w-0 flex-1 truncate text-sm text-cyan-50 ${card.done ? 'line-through' : ''}`}>{card.title}</p>
                    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${PRIORITY_CLASS[card.priority ?? 'media']}`}>
                      {(card.priority ?? 'media').toUpperCase()}
                    </span>
                  </div>
                  {card.description && <p className="mt-1 text-xs text-cyan-200/50">{card.description}</p>}
                  {subtasks.length > 0 && (
                    <div className="mt-2">
                      <div className="mb-1 flex justify-between text-[11px] text-cyan-200/55">
                        <span>Subtarefas</span>
                        <span>
                          {doneSubs}/{subtasks.length}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-cyan-950/70">
                        <span className="block h-full bg-cyan-300/70" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                    {(card.labels ?? []).map((l) => (
                      <span key={l} className="rounded-full border border-cyan-300/25 bg-cyan-400/5 px-2 py-0.5 text-cyan-100/80">
                        #{l}
                      </span>
                    ))}
                    {card.recurrence && card.recurrence !== 'none' && (
                      <span className="rounded-full border border-indigo-300/30 px-2 py-0.5 text-indigo-200/80">
                        ↻ {REC_LABEL[card.recurrence]}
                      </span>
                    )}
                    {card.due && (
                      <span className="rounded-full border border-amber-300/20 px-2 py-0.5 text-amber-200/75">
                        {new Date(card.due).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    )}
                    {card.reminderAt && (
                      <span className="rounded-full border border-cyan-300/20 px-2 py-0.5 text-cyan-200/70">
                        lembrete {new Date(card.reminderAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    )}
                  </div>
                  {links.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
                      {links.map((l, i) => (
                        <button
                          key={i}
                          onClick={() => openLink(l)}
                          title={l.url}
                          className="rounded-full border border-cyan-300/20 px-2 py-0.5 text-cyan-200/70 hover:text-cyan-50"
                        >
                          ↗ {l.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button onClick={() => setEditing(true)} className="text-cyan-200/50 hover:text-cyan-100" title="Editar">
                    <EditIcon />
                  </button>
                  <button onClick={onDelete} className="text-cyan-200/50 hover:text-red-300" title="Excluir">
                    <TrashIcon />
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </Draggable>
  )
}

function EditIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrashIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 7h16M10 11v6M14 11v6M9 7l1-3h4l1 3M6 7l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
