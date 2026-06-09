import { useMemo, useState } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import type { Board, Card, CardColor, Priority } from '../../shared/types'
import { useAres } from '../lib/store'
import { uid } from '../lib/actions'
import ColumnView from './ColumnView'
import Select from './Select'

const isDone = (title: string) => /conclu/i.test(title)
const COLORS: ('todas' | CardColor)[] = ['todas', 'cyan', 'blue', 'green', 'amber', 'pink']
const priorityRank: Record<Priority, number> = { alta: 0, media: 1, baixa: 2 }

type DueFilter = 'todos' | 'vencidas' | 'hoje' | 'proximas'
type StatusFilter = 'todos' | 'abertas' | 'concluidas'
type SortMode = 'manual' | 'prazo' | 'prioridade'

const sameDay = (iso: string, ref = new Date()) => {
  const d = new Date(iso)
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
}

export default function KanbanBoard(): JSX.Element {
  const { board, setBoard } = useAres()
  const [addingCol, setAddingCol] = useState(false)
  const [colTitle, setColTitle] = useState('')
  const [query, setQuery] = useState('')
  const [colorFilter, setColorFilter] = useState<'todas' | CardColor>('todas')
  const [dueFilter, setDueFilter] = useState<DueFilter>('todos')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos')
  const [sortMode, setSortMode] = useState<SortMode>('manual')
  const [labelFilter, setLabelFilter] = useState<string>('todas')

  const allLabels = useMemo(() => {
    const set = new Set<string>()
    for (const c of Object.values(board.cards)) c.labels?.forEach((l) => set.add(l))
    return Array.from(set).sort()
  }, [board.cards])

  const filterCard = (card: Card) => {
    const q = query.trim().toLowerCase()
    if (q && !`${card.title} ${card.description ?? ''} ${(card.labels ?? []).join(' ')}`.toLowerCase().includes(q)) return false
    if (colorFilter !== 'todas' && (card.color ?? 'cyan') !== colorFilter) return false
    if (labelFilter !== 'todas' && !(card.labels ?? []).includes(labelFilter)) return false
    if (statusFilter === 'abertas' && card.done) return false
    if (statusFilter === 'concluidas' && !card.done) return false
    if (dueFilter !== 'todos') {
      if (!card.due) return false
      const t = new Date(card.due).getTime()
      if (dueFilter === 'vencidas' && !(t < Date.now() && !card.done)) return false
      if (dueFilter === 'hoje' && !sameDay(card.due)) return false
      if (dueFilter === 'proximas' && !(t >= Date.now() && t <= Date.now() + 7 * 86400_000)) return false
    }
    return true
  }

  // Visões rápidas (Hoje / Vencidas / Próximos 7 dias).
  const quickViews: { id: DueFilter; label: string }[] = [
    { id: 'todos', label: 'TODAS' },
    { id: 'hoje', label: 'HOJE' },
    { id: 'vencidas', label: 'VENCIDAS' },
    { id: 'proximas', label: 'PRÓXIMOS 7 DIAS' }
  ]
  const applyQuickView = (id: DueFilter) => {
    setDueFilter(id)
    setStatusFilter(id === 'vencidas' ? 'abertas' : 'todos')
  }

  const sortCards = (cards: Card[]) => {
    if (sortMode === 'manual') return cards
    return [...cards].sort((a, b) => {
      if (sortMode === 'prioridade') return priorityRank[a.priority ?? 'media'] - priorityRank[b.priority ?? 'media']
      const ad = a.due ? new Date(a.due).getTime() : Number.MAX_SAFE_INTEGER
      const bd = b.due ? new Date(b.due).getTime() : Number.MAX_SAFE_INTEGER
      return ad - bd
    })
  }

  const visibleColumns = useMemo(
    () =>
      board.columns.map((col) => ({
        col,
        cards: sortCards(col.cardIds.map((id) => board.cards[id]).filter(Boolean).filter(filterCard))
      })),
    [board, query, colorFilter, dueFilter, statusFilter, sortMode, labelFilter]
  )

  const onDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    setBoard((prev: Board) => {
      const columns = prev.columns.map((c) => ({ ...c, cardIds: [...c.cardIds] }))
      const from = columns.find((c) => c.id === source.droppableId)
      const to = columns.find((c) => c.id === destination.droppableId)
      if (!from || !to) return prev
      from.cardIds = from.cardIds.filter((id) => id !== draggableId)
      const insertAt = Math.min(destination.index, to.cardIds.length)
      to.cardIds.splice(insertAt, 0, draggableId)

      const cards = { ...prev.cards }
      const card = cards[draggableId]
      if (card) {
        if (isDone(to.title)) cards[draggableId] = { ...card, done: true }
        else if (isDone(from.title) && !isDone(to.title)) cards[draggableId] = { ...card, done: false }
      }
      return { columns, cards }
    })
  }

  const addCard = (columnId: string, title: string) =>
    setBoard((prev) => {
      const card: Card = {
        id: uid('card'),
        title,
        done: false,
        createdAt: Date.now(),
        color: 'cyan',
        priority: 'media',
        subtasks: []
      }
      const columns = prev.columns.map((c) => (c.id === columnId ? { ...c, cardIds: [card.id, ...c.cardIds] } : c))
      return { columns, cards: { ...prev.cards, [card.id]: card } }
    })

  const cardSave = (cardId: string, patch: Partial<Card>) =>
    setBoard((prev) => ({ ...prev, cards: { ...prev.cards, [cardId]: { ...prev.cards[cardId], ...patch } } }))

  const cardToggle = (cardId: string) =>
    setBoard((prev) => ({
      ...prev,
      cards: { ...prev.cards, [cardId]: { ...prev.cards[cardId], done: !prev.cards[cardId].done } }
    }))

  const cardDelete = (cardId: string) =>
    setBoard((prev) => {
      const cards = { ...prev.cards }
      delete cards[cardId]
      const columns = prev.columns.map((c) => ({ ...c, cardIds: c.cardIds.filter((id) => id !== cardId) }))
      return { columns, cards }
    })

  const renameColumn = (columnId: string, title: string) =>
    setBoard((prev) => ({ ...prev, columns: prev.columns.map((c) => (c.id === columnId ? { ...c, title } : c)) }))

  const deleteColumn = (columnId: string) =>
    setBoard((prev) => {
      const col = prev.columns.find((c) => c.id === columnId)
      const cards = { ...prev.cards }
      col?.cardIds.forEach((id) => delete cards[id])
      return { columns: prev.columns.filter((c) => c.id !== columnId), cards }
    })

  const addColumn = () => {
    const t = colTitle.trim()
    if (t) setBoard((prev) => ({ ...prev, columns: [...prev.columns, { id: uid('col'), title: t, cardIds: [] }] }))
    setColTitle('')
    setAddingCol(false)
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {quickViews.map((v) => (
            <button
              key={v.id}
              onClick={() => applyQuickView(v.id)}
              className={`rounded-full border px-3 py-1 text-[11px] title-track transition ${
                dueFilter === v.id ? 'border-cyan-300/50 bg-cyan-400/10 text-cyan-100' : 'border-cyan-300/15 text-cyan-200/55 hover:text-cyan-100'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-[minmax(200px,1fr)_repeat(5,minmax(118px,148px))]">
          <input
            className="input"
            placeholder="Buscar título, descrição ou etiqueta"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select
            ariaLabel="Filtrar por cor"
            className="w-[130px]"
            value={colorFilter}
            onChange={(v) => setColorFilter(v as 'todas' | CardColor)}
            options={COLORS.map((c) => ({ value: c, label: `cor ${c}` }))}
          />
          <Select
            ariaLabel="Filtrar por etiqueta"
            className="w-[150px]"
            value={labelFilter}
            onChange={setLabelFilter}
            options={[{ value: 'todas', label: 'toda etiqueta' }, ...allLabels.map((l) => ({ value: l, label: l }))]}
          />
          <Select
            ariaLabel="Filtrar por prazo"
            className="w-[140px]"
            value={dueFilter}
            onChange={(v) => setDueFilter(v as DueFilter)}
            options={[
              { value: 'todos', label: 'todos prazos' },
              { value: 'vencidas', label: 'vencidas' },
              { value: 'hoje', label: 'hoje' },
              { value: 'proximas', label: 'próximas' }
            ]}
          />
          <Select
            ariaLabel="Filtrar por status"
            className="w-[140px]"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            options={[
              { value: 'todos', label: 'todo status' },
              { value: 'abertas', label: 'abertas' },
              { value: 'concluidas', label: 'concluídas' }
            ]}
          />
          <Select
            ariaLabel="Ordenar"
            className="w-[150px]"
            value={sortMode}
            onChange={(v) => setSortMode(v as SortMode)}
            options={[
              { value: 'manual', label: 'ordem manual' },
              { value: 'prazo', label: 'por prazo' },
              { value: 'prioridade', label: 'por prioridade' }
            ]}
          />
        </div>

        <div className="kanban-scroll flex min-h-0 flex-1 items-stretch gap-4 overflow-x-auto overflow-y-hidden pb-2">
          {visibleColumns.map(({ col, cards }) => (
            <ColumnView
              key={col.id}
              column={col}
              cards={cards}
              onAddCard={(title) => addCard(col.id, title)}
              onRename={(title) => renameColumn(col.id, title)}
              onDelete={() => deleteColumn(col.id)}
              onCardSave={cardSave}
              onCardDelete={cardDelete}
              onCardToggle={cardToggle}
            />
          ))}

          <div className="w-[280px] shrink-0">
            {addingCol ? (
              <input
                className="input"
                placeholder="Nome da coluna..."
                value={colTitle}
                autoFocus
                onChange={(e) => setColTitle(e.target.value)}
                onBlur={addColumn}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addColumn()
                  if (e.key === 'Escape') setAddingCol(false)
                }}
              />
            ) : (
              <button
                onClick={() => setAddingCol(true)}
                className="glass w-full rounded-2xl border-dashed border-cyan-300/20 py-3 text-xs title-track text-cyan-200/50 transition hover:text-cyan-100"
              >
                + NOVA COLUNA
              </button>
            )}
          </div>
        </div>
      </div>
    </DragDropContext>
  )
}
