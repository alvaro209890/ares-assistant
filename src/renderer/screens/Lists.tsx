import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAres } from '../lib/store'
import type { Checklist } from '../../shared/types'

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export default function Lists(): JSX.Element {
  const { lists, saveLists, quickNotes, addNote, removeNote } = useAres()
  const [newList, setNewList] = useState('')
  const [note, setNote] = useState('')

  const createList = () => {
    const t = newList.trim()
    if (!t) return
    void saveLists([...lists, { id: uid('list'), title: t, items: [], createdAt: Date.now() }])
    setNewList('')
  }
  const update = (id: string, fn: (l: Checklist) => Checklist) =>
    void saveLists(lists.map((l) => (l.id === id ? fn(l) : l)))
  const removeList = (id: string) => void saveLists(lists.filter((l) => l.id !== id))

  const submitNote = () => {
    const t = note.trim()
    if (!t) return
    void addNote(t)
    setNote('')
  }

  return (
    <motion.div
      key="lists"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="grid h-full min-h-[680px] gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]"
    >
      <section className="glass flex min-h-0 flex-col rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-display text-sm title-track text-cyan-100">LISTAS</h2>
          <span className="ml-auto" />
          <input
            className="input w-[180px] py-1"
            placeholder="Nova lista…"
            value={newList}
            onChange={(e) => setNewList(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createList()}
          />
          <button onClick={createList} disabled={!newList.trim()} className="btn-ghost py-1 disabled:opacity-40">
            CRIAR
          </button>
        </div>
        <p className="mb-3 text-xs text-cyan-200/40">
          Listas simples de compras e afazeres — ou peça ao Ares: “adiciona leite na lista de compras”.
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {lists.length === 0 ? (
            <div className="grid h-40 place-items-center text-sm text-cyan-200/40">Nenhuma lista ainda.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {lists.map((l) => (
                <ListCard
                  key={l.id}
                  list={l}
                  onUpdate={(fn) => update(l.id, fn)}
                  onRemove={() => removeList(l.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="glass flex min-h-0 flex-col rounded-2xl p-4">
        <h2 className="font-display text-sm title-track text-cyan-100">NOTAS RÁPIDAS</h2>
        <div className="mt-3 flex gap-2">
          <input
            className="input flex-1"
            placeholder="Anote algo…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitNote()}
          />
          <button onClick={submitNote} disabled={!note.trim()} className="btn-ghost disabled:opacity-40">
            SALVAR
          </button>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {quickNotes.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-cyan-200/40">Sem notas.</div>
          ) : (
            <div className="grid gap-2">
              {quickNotes.map((n) => (
                <article key={n.id} className="flex items-start gap-3 rounded-xl border border-cyan-300/15 bg-black/20 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-sm text-cyan-50">{n.text}</p>
                    <p className="mt-1 text-[11px] text-cyan-200/40">{new Date(n.createdAt).toLocaleString('pt-BR')}</p>
                  </div>
                  <button onClick={() => removeNote(n.id)} className="text-cyan-200/50 hover:text-red-300" title="Remover">
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

function ListCard({
  list,
  onUpdate,
  onRemove
}: {
  list: Checklist
  onUpdate: (fn: (l: Checklist) => Checklist) => void
  onRemove: () => void
}): JSX.Element {
  const [item, setItem] = useState('')
  const done = list.items.filter((i) => i.done).length
  const addItem = () => {
    const t = item.trim()
    if (!t) return
    onUpdate((l) => ({ ...l, items: [...l.items, { id: uid('li'), text: t, done: false }] }))
    setItem('')
  }
  const toggle = (id: string) =>
    onUpdate((l) => ({ ...l, items: l.items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) }))
  const removeItem = (id: string) => onUpdate((l) => ({ ...l, items: l.items.filter((i) => i.id !== id) }))

  return (
    <div className="rounded-xl border border-cyan-300/15 bg-black/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-display text-sm text-cyan-100">{list.title}</h3>
        <span className="rounded-full bg-cyan-400/10 px-2 text-[11px] text-cyan-200/60">
          {done}/{list.items.length}
        </span>
        <button onClick={onRemove} className="ml-auto text-cyan-200/40 hover:text-red-300" title="Excluir lista">
          ✕
        </button>
      </div>
      <div className="grid gap-1">
        {list.items.map((i) => (
          <label key={i.id} className="flex items-center gap-2 text-sm text-cyan-100/85">
            <input type="checkbox" checked={i.done} onChange={() => toggle(i.id)} className="accent-cyan-400" />
            <span className={`min-w-0 flex-1 ${i.done ? 'line-through opacity-55' : ''}`}>{i.text}</span>
            <button onClick={() => removeItem(i.id)} className="text-cyan-200/40 hover:text-red-300">
              ×
            </button>
          </label>
        ))}
      </div>
      <div className="mt-2 flex gap-1">
        <input
          className="input flex-1 py-1"
          placeholder="Adicionar item…"
          value={item}
          onChange={(e) => setItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addItem()}
        />
        <button onClick={addItem} className="btn-ghost px-2 py-1">
          +
        </button>
      </div>
    </div>
  )
}
