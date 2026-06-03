import type { Acao, Board, Card, CardColor, CardLink, Column, Priority, Recurrence, Subtask } from '../shared/types'

// Aplica uma ação estruturada (tarefa.*/coluna.*) ao quadro Kanban, no processo main.
// Funções puras: recebem o board, devolvem um novo board + uma nota curta.

function uid(p: string): string {
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}
const norm = (s: unknown) => String(s ?? '').toLowerCase().trim()
const asColor = (c: unknown): CardColor | undefined =>
  ['cyan', 'blue', 'green', 'amber', 'pink'].includes(String(c)) ? (c as CardColor) : undefined
const asPriority = (p: unknown): Priority | undefined =>
  ['baixa', 'media', 'alta'].includes(String(p)) ? (p as Priority) : undefined
const asRecurrence = (r: unknown): Recurrence | undefined =>
  ['none', 'daily', 'weekly', 'monthly'].includes(String(r)) ? (r as Recurrence) : undefined
const asLabels = (v: unknown): string[] | undefined => {
  if (Array.isArray(v)) {
    const arr = v.map((x) => String(x).trim()).filter(Boolean)
    return arr.length ? Array.from(new Set(arr)) : undefined
  }
  if (typeof v === 'string' && v.trim()) {
    const arr = v.split(',').map((x) => x.trim()).filter(Boolean)
    return arr.length ? Array.from(new Set(arr)) : undefined
  }
  return undefined
}
const asLinks = (v: unknown): CardLink[] | undefined => {
  if (!Array.isArray(v)) return undefined
  const out: CardLink[] = []
  for (const item of v) {
    if (typeof item === 'string' && item.trim()) out.push({ label: item.trim(), url: item.trim() })
    else if (item && typeof item === 'object') {
      const url = String((item as any).url || '').trim()
      if (url) out.push({ label: String((item as any).label || url).trim(), url })
    }
  }
  return out.length ? out : undefined
}

/** Avança uma data ISO conforme a recorrência (próxima ocorrência). */
export function advanceISO(iso: string, rec: Recurrence): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  if (rec === 'daily') d.setDate(d.getDate() + 1)
  else if (rec === 'weekly') d.setDate(d.getDate() + 7)
  else if (rec === 'monthly') d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}

function findColumn(board: Board, name: unknown): Column | undefined {
  const n = norm(name)
  if (!n) return undefined
  return (
    board.columns.find((c) => norm(c.title) === n) ||
    board.columns.find((c) => norm(c.title).includes(n) || n.includes(norm(c.title)))
  )
}
function findCard(board: Board, title: unknown): { card: Card; col: Column } | undefined {
  const n = norm(title)
  if (!n) return undefined
  for (const col of board.columns) {
    for (const id of col.cardIds) {
      const card = board.cards[id]
      if (card && (norm(card.title) === n || norm(card.title).includes(n) || n.includes(norm(card.title))))
        return { card, col }
    }
  }
  return undefined
}
const doneColumn = (board: Board) => board.columns.find((c) => /conclu/i.test(c.title))

function clone(board: Board): Board {
  return { columns: board.columns.map((c) => ({ ...c, cardIds: [...c.cardIds] })), cards: { ...board.cards } }
}

export function applyBoardAction(input: Board, a: Acao): { board: Board; note?: string } {
  const board = clone(input)
  const get = (k: string) => (a as Record<string, unknown>)[k]

  const moveTo = (cardId: string, col: Column) => {
    for (const c of board.columns) {
      const i = c.cardIds.indexOf(cardId)
      if (i !== -1) c.cardIds.splice(i, 1)
    }
    board.columns.find((c) => c.id === col.id)?.cardIds.push(cardId)
  }

  switch (a.tipo) {
    case 'tarefa.criar': {
      const col = findColumn(board, get('coluna')) || board.columns[0]
      if (!col) break
      const subs = Array.isArray(get('subtarefas'))
        ? (get('subtarefas') as unknown[]).map((t): Subtask => ({ id: uid('st'), text: String(t), done: false }))
        : undefined
      const card: Card = {
        id: uid('card'),
        title: String(get('titulo') || 'Tarefa'),
        description: get('descricao') ? String(get('descricao')) : undefined,
        color: asColor(get('cor')) || 'cyan',
        priority: asPriority(get('prioridade')),
        due: get('prazo') ? String(get('prazo')) : undefined,
        reminderAt: get('lembrete') ? String(get('lembrete')) : undefined,
        subtasks: subs,
        labels: asLabels(get('etiquetas') ?? get('labels')),
        links: asLinks(get('links') ?? get('anexos')),
        recurrence: asRecurrence(get('repetir') ?? get('recorrencia')),
        done: false,
        createdAt: Date.now()
      }
      board.cards[card.id] = card
      col.cardIds.unshift(card.id)
      return { board, note: `+ "${card.title}" em ${col.title}` }
    }
    case 'tarefa.mover': {
      const f = findCard(board, get('titulo'))
      const target = findColumn(board, get('paraColuna') || get('coluna'))
      if (f && target) {
        moveTo(f.card.id, target)
        board.cards[f.card.id] = { ...f.card, done: /conclu/i.test(target.title) }
        return { board, note: `→ "${f.card.title}" para ${target.title}` }
      }
      break
    }
    case 'tarefa.concluir': {
      const f = findCard(board, get('titulo'))
      if (f) {
        board.cards[f.card.id] = { ...f.card, done: true }
        const dc = doneColumn(board)
        if (dc) moveTo(f.card.id, dc)
        // Tarefa recorrente: gera a próxima ocorrência (aberta) na coluna original.
        if (f.card.recurrence && f.card.recurrence !== 'none') {
          const next: Card = {
            ...f.card,
            id: uid('card'),
            done: false,
            reminded: false,
            due: f.card.due ? advanceISO(f.card.due, f.card.recurrence) : undefined,
            reminderAt: f.card.reminderAt ? advanceISO(f.card.reminderAt, f.card.recurrence) : undefined,
            subtasks: f.card.subtasks?.map((s) => ({ ...s, done: false })),
            createdAt: Date.now()
          }
          board.cards[next.id] = next
          f.col.cardIds.unshift(next.id)
          return { board, note: `✓ "${f.card.title}" · próxima recorrência criada` }
        }
        return { board, note: `✓ "${f.card.title}"` }
      }
      break
    }
    case 'tarefa.reabrir': {
      const f = findCard(board, get('titulo'))
      if (f) {
        board.cards[f.card.id] = { ...f.card, done: false }
        return { board, note: `↺ "${f.card.title}"` }
      }
      break
    }
    case 'tarefa.remover': {
      const f = findCard(board, get('titulo'))
      if (f) {
        for (const c of board.columns) c.cardIds = c.cardIds.filter((id) => id !== f.card.id)
        delete board.cards[f.card.id]
        return { board, note: `🗑 "${f.card.title}"` }
      }
      break
    }
    case 'tarefa.editar': {
      const f = findCard(board, get('titulo'))
      if (f) {
        board.cards[f.card.id] = {
          ...f.card,
          title: get('novoTitulo') ? String(get('novoTitulo')) : f.card.title,
          description: get('descricao') !== undefined ? String(get('descricao')) : f.card.description,
          priority: asPriority(get('prioridade')) ?? f.card.priority,
          color: asColor(get('cor')) ?? f.card.color,
          due: get('prazo') !== undefined ? String(get('prazo')) : f.card.due,
          labels: asLabels(get('etiquetas') ?? get('labels')) ?? f.card.labels,
          recurrence: asRecurrence(get('repetir') ?? get('recorrencia')) ?? f.card.recurrence
        }
        return { board, note: `✎ "${f.card.title}"` }
      }
      break
    }
    case 'tarefa.subtarefa.adicionar': {
      const f = findCard(board, get('titulo'))
      if (f) {
        const items = Array.isArray(get('itens')) ? (get('itens') as unknown[]).map(String) : [String(get('item') || '')]
        const subs = [...(f.card.subtasks || [])]
        for (const t of items) if (t.trim()) subs.push({ id: uid('st'), text: t.trim(), done: false })
        board.cards[f.card.id] = { ...f.card, subtasks: subs }
        return { board, note: `+ subtarefa em "${f.card.title}"` }
      }
      break
    }
    case 'tarefa.subtarefa.concluir': {
      const f = findCard(board, get('titulo'))
      if (f && f.card.subtasks) {
        const it = norm(get('item'))
        const subs = f.card.subtasks.map((s) => (norm(s.text).includes(it) ? { ...s, done: true } : s))
        board.cards[f.card.id] = { ...f.card, subtasks: subs }
        return { board, note: `✓ subtarefa de "${f.card.title}"` }
      }
      break
    }
    case 'tarefa.lembrete.definir': {
      const f = findCard(board, get('titulo'))
      if (f && get('quando')) {
        board.cards[f.card.id] = { ...f.card, reminderAt: String(get('quando')), reminded: false }
        return { board, note: `⏰ lembrete em "${f.card.title}"` }
      }
      break
    }
    case 'coluna.criar': {
      if (!findColumn(board, get('titulo'))) {
        board.columns.push({ id: uid('col'), title: String(get('titulo') || 'Coluna'), cardIds: [] })
        return { board, note: `+ coluna ${get('titulo')}` }
      }
      break
    }
    case 'coluna.renomear': {
      const col = findColumn(board, get('titulo'))
      if (col) {
        board.columns = board.columns.map((c) => (c.id === col.id ? { ...c, title: String(get('novoTitulo')) } : c))
        return { board, note: `coluna → ${get('novoTitulo')}` }
      }
      break
    }
    case 'coluna.remover': {
      const col = findColumn(board, get('titulo'))
      if (col) {
        col.cardIds.forEach((id) => delete board.cards[id])
        board.columns = board.columns.filter((c) => c.id !== col.id)
        return { board, note: `🗑 coluna ${get('titulo')}` }
      }
      break
    }
  }
  return { board: input }
}
