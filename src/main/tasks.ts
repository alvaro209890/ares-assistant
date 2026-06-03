import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { Board } from '../shared/types'

// Persistência do quadro Kanban em userData/tasks.json (sobrevive a fechar/abrir).
// O renderer é o dono do estado em memória; aqui só lemos/gravamos o arquivo e
// montamos um resumo textual do quadro para dar contexto ao LLM.

function tasksPath(): string {
  return join(app.getPath('userData'), 'tasks.json')
}

function defaultBoard(): Board {
  const mk = (title: string) => ({ id: `col-${title}-${Math.random().toString(36).slice(2, 7)}`, title, cardIds: [] })
  return {
    columns: [mk('A Fazer'), mk('Fazendo'), mk('Concluído')],
    cards: {}
  }
}

export function loadBoard(): Board {
  const path = tasksPath()
  try {
    if (existsSync(path)) {
      const board = JSON.parse(readFileSync(path, 'utf8')) as Board
      if (board && Array.isArray(board.columns) && board.cards) return board
    }
  } catch {
    /* arquivo corrompido: recria padrão */
  }
  const fresh = defaultBoard()
  saveBoard(fresh)
  return fresh
}

export function saveBoard(board: Board): void {
  const path = tasksPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(board, null, 2), 'utf8')
}

/** Resumo legível do quadro, injetado no system prompt para o LLM referenciar. */
export function boardSummary(board: Board): string {
  if (!board.columns.length) return '(quadro vazio)'
  return board.columns
    .map((col) => {
      const titles = col.cardIds
        .map((id) => board.cards[id])
        .filter(Boolean)
        .map((c) => {
          const bits = [
            c.done ? 'concluída' : 'aberta',
            c.priority ? `prioridade ${c.priority}` : '',
            c.due ? `prazo ${c.due}` : '',
            c.reminderAt ? `lembrete ${c.reminderAt}` : '',
            c.recurrence && c.recurrence !== 'none' ? `repete ${c.recurrence}` : '',
            c.labels?.length ? `etiquetas ${c.labels.join('/')}` : '',
            c.subtasks?.length ? `subtarefas ${c.subtasks.filter((s) => s.done).length}/${c.subtasks.length}` : ''
          ].filter(Boolean)
          return `"${c.title}" (${bits.join(', ')})`
        })
      return `- Coluna "${col.title}": ${titles.length ? titles.join(', ') : '(vazia)'}`
    })
    .join('\n')
}
