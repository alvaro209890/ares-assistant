import { useState } from 'react'
import { Droppable } from '@hello-pangea/dnd'
import { motion } from 'framer-motion'
import type { Card, Column } from '../../shared/types'
import CardItem from './CardItem'

interface Props {
  column: Column
  cards: Card[]
  onAddCard: (title: string) => void
  onRename: (title: string) => void
  onDelete: () => void
  onCardSave: (cardId: string, patch: Partial<Card>) => void
  onCardDelete: (cardId: string) => void
  onCardToggle: (cardId: string) => void
}

export default function ColumnView(props: Props): JSX.Element {
  const { column, cards } = props
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(column.title)
  const [adding, setAdding] = useState(false)
  const [newCard, setNewCard] = useState('')

  const commitTitle = () => {
    props.onRename(title.trim() || column.title)
    setEditingTitle(false)
  }
  const commitCard = () => {
    const t = newCard.trim()
    if (t) props.onAddCard(t)
    setNewCard('')
    setAdding(false)
  }

  return (
    <motion.div layout className="glass flex max-h-full w-[320px] shrink-0 flex-col rounded-2xl p-3">
      <div className="mb-3 flex items-center gap-2 px-1">
        {editingTitle ? (
          <input
            className="input py-1"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === 'Enter' && commitTitle()}
          />
        ) : (
          <button onClick={() => setEditingTitle(true)} className="font-display text-sm title-track text-cyan-100">
            {column.title}
          </button>
        )}
        <span className="ml-auto rounded-full bg-cyan-400/10 px-2 text-xs text-cyan-200/60">{cards.length}</span>
        <button onClick={props.onDelete} className="text-cyan-200/40 hover:text-red-300" title="Excluir coluna">
          <CloseIcon />
        </button>
      </div>

      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`min-h-[12px] flex-1 overflow-y-auto rounded-xl p-1 transition ${
              snapshot.isDraggingOver ? 'bg-cyan-400/5' : ''
            }`}
          >
            {cards.map((c, i) => (
              <CardItem
                key={c.id}
                card={c}
                index={i}
                onSave={(patch) => props.onCardSave(c.id, patch)}
                onDelete={() => props.onCardDelete(c.id)}
                onToggle={() => props.onCardToggle(c.id)}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {adding ? (
        <div className="mt-2 flex flex-col gap-2">
          <input
            className="input"
            placeholder="Título do cartão..."
            value={newCard}
            autoFocus
            onChange={(e) => setNewCard(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCard()
              if (e.key === 'Escape') setAdding(false)
            }}
            onBlur={commitCard}
          />
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-2 rounded-lg border border-dashed border-cyan-300/20 py-2 text-xs title-track text-cyan-200/50 transition hover:border-cyan-300/50 hover:text-cyan-100"
        >
          + ADICIONAR CARTÃO
        </button>
      )}
    </motion.div>
  )
}

function CloseIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}
