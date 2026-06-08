import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useAres } from '../lib/store'
import type { MemoryCategory, MemoryFact } from '../../shared/types'
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABEL } from '../../shared/types'

const CAT_CLASS: Record<MemoryCategory, string> = {
  perfil: 'border-cyan-300/35 text-cyan-200',
  preferencias: 'border-blue-300/35 text-blue-200',
  rotina: 'border-emerald-300/35 text-emerald-200',
  trabalho: 'border-amber-300/35 text-amber-200',
  projetos: 'border-indigo-300/35 text-indigo-200',
  restricoes: 'border-red-300/40 text-red-200',
  interesses: 'border-pink-300/35 text-pink-200',
  outros: 'border-cyan-300/20 text-cyan-200/70'
}

export default function Memory(): JSX.Element {
  const {
    memory,
    addMemory,
    updateMemory,
    approveMemory,
    removeMemory,
    sessions,
    currentSessionId,
    openSession,
    createSession,
    renameSession,
    deleteSession
  } = useAres()
  const [fact, setFact] = useState('')
  const [newCat, setNewCat] = useState<MemoryCategory>('outros')
  const [filter, setFilter] = useState<'todas' | MemoryCategory>('todas')

  const pending = useMemo(() => memory.filter((m) => m.status === 'pending'), [memory])
  const active = useMemo(
    () => memory.filter((m) => m.status !== 'pending' && (filter === 'todas' || m.category === filter)),
    [memory, filter]
  )

  const submitFact = () => {
    const t = fact.trim()
    if (!t) return
    void addMemory(t, newCat)
    setFact('')
  }

  return (
    <motion.div
      key="memory"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="grid h-full min-h-[680px] gap-4 p-5 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]"
    >
      <section className="glass flex min-h-0 flex-col rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm title-track text-cyan-100">CONVERSAS</h2>
          <button onClick={() => createSession()} className="btn-ghost px-3 py-1 text-[11px]">
            NOVA
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
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

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            className="input min-w-[180px] flex-1"
            placeholder="Ex.: prefiro respostas curtas"
            value={fact}
            onChange={(e) => setFact(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitFact()}
          />
          <select className="input-select w-[150px] border-cyan-300/45 bg-black/40 shadow-[0_0_0_1px_rgba(56,225,255,0.04)] hover:border-cyan-200/70 hover:bg-cyan-400/10 focus:border-cyan-200/80 focus:shadow-[0_0_14px_rgba(56,225,255,0.18)]" value={newCat} onChange={(e) => setNewCat(e.target.value as MemoryCategory)}>
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MEMORY_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <button onClick={submitFact} disabled={!fact.trim()} className="btn-ghost disabled:opacity-40">
            ADICIONAR
          </button>
        </div>

        {pending.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-400/5 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-300" />
              <h3 className="text-[11px] title-track text-amber-200/80">PARA REVISAR ({pending.length})</h3>
              <span className="text-[10px] text-amber-200/50">extraídos automaticamente</span>
            </div>
            <div className="grid gap-2">
              {pending.map((m) => (
                <PendingRow
                  key={m.id}
                  fact={m}
                  onApprove={() => approveMemory(m.id)}
                  onCategory={(c) => updateMemory(m.id, { category: c })}
                  onDelete={() => removeMemory(m.id)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <span className="text-[11px] text-cyan-200/45">Filtrar:</span>
          <select className="input-select w-[170px] border-cyan-300/45 bg-black/40 py-1 shadow-[0_0_0_1px_rgba(56,225,255,0.04)] hover:border-cyan-200/70 hover:bg-cyan-400/10 focus:border-cyan-200/80 focus:shadow-[0_0_14px_rgba(56,225,255,0.18)]" value={filter} onChange={(e) => setFilter(e.target.value as MemoryCategory | 'todas')}>
            <option value="todas">todas categorias</option>
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MEMORY_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {active.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-cyan-200/40">Nenhum fato nesta categoria.</div>
          ) : (
            <div className="grid gap-2">
              {active.map((m) => (
                <FactRow
                  key={m.id}
                  fact={m}
                  onCategory={(c) => updateMemory(m.id, { category: c })}
                  onText={(t) => updateMemory(m.id, { text: t })}
                  onDelete={() => removeMemory(m.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </motion.div>
  )
}

function CategoryPill({ fact, onCategory }: { fact: MemoryFact; onCategory: (c: MemoryCategory) => void }): JSX.Element {
  return (
    <select
      value={fact.category}
      onChange={(e) => onCategory(e.target.value as MemoryCategory)}
      className={`input-select inline-block w-auto min-w-[96px] rounded-full border bg-black/35 py-0.5 pl-2.5 pr-7 text-[10px] outline-none shadow-[0_0_0_1px_rgba(56,225,255,0.04)] transition-all duration-150 hover:border-cyan-200/70 hover:bg-cyan-400/10 hover:brightness-125 hover:shadow-[0_0_10px_rgba(56,225,255,0.14)] focus:border-cyan-200/80 focus:shadow-[0_0_12px_rgba(56,225,255,0.2)] ${CAT_CLASS[fact.category]}`}
      title="Categoria"
    >
      {MEMORY_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {MEMORY_CATEGORY_LABEL[c]}
        </option>
      ))}
    </select>
  )
}

function FactRow({
  fact,
  onCategory,
  onText,
  onDelete
}: {
  fact: MemoryFact
  onCategory: (c: MemoryCategory) => void
  onText: (t: string) => void
  onDelete: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(fact.text)
  const commit = () => {
    if (draft.trim() && draft.trim() !== fact.text) onText(draft.trim())
    setEditing(false)
  }
  return (
    <article className="rounded-xl border border-cyan-300/15 bg-black/20 p-3">
      <div className="flex items-start gap-3">
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
          <p className="min-w-0 flex-1 text-sm text-cyan-50" onDoubleClick={() => setEditing(true)}>
            {fact.text}
            {fact.source === 'auto' && <span className="ml-2 text-[10px] text-cyan-200/40">(auto)</span>}
          </p>
        )}
        <button onClick={() => setEditing(true)} className="text-cyan-200/50 hover:text-cyan-100" title="Editar">
          ✎
        </button>
        <button onClick={onDelete} className="text-cyan-200/50 hover:text-red-300" title="Remover">
          ✕
        </button>
      </div>
      <div className="mt-2">
        <CategoryPill fact={fact} onCategory={onCategory} />
      </div>
    </article>
  )
}

function PendingRow({
  fact,
  onApprove,
  onCategory,
  onDelete
}: {
  fact: MemoryFact
  onApprove: () => void
  onCategory: (c: MemoryCategory) => void
  onDelete: () => void
}): JSX.Element {
  return (
    <article className="rounded-lg border border-amber-300/15 bg-black/20 p-2.5">
      <p className="text-sm text-cyan-50">{fact.text}</p>
      <div className="mt-2 flex items-center gap-2">
        <CategoryPill fact={fact} onCategory={onCategory} />
        <button onClick={onApprove} className="ml-auto rounded-full border border-emerald-300/40 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-400/10">
          ✓ SALVAR
        </button>
        <button onClick={onDelete} className="rounded-full border border-red-300/30 px-2 py-0.5 text-[10px] text-red-200/80 hover:bg-red-400/10">
          DESCARTAR
        </button>
      </div>
    </article>
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
          ✎
        </button>
        <button onClick={onDelete} className="text-cyan-200/50 hover:text-red-300" title="Apagar">
          ✕
        </button>
      </div>
    </div>
  )
}
