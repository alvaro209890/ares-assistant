import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

// ---------------------------------------------------------------------------
// Histórico para "desfazer" por voz.
//
// Antes de cada turno que altera dados, tiramos um snapshot dos arquivos JSON do
// usuário (tarefas, agenda, listas, notas, lembretes, memória). "Desfaz" restaura
// o último snapshot — um undo universal e robusto, independente da ação que mudou
// o estado. NÃO inclui sessões de conversa nem config.
//
// Sem dependência de Electron (recebe o diretório por parâmetro), para ser
// testável fora do processo principal.
// ---------------------------------------------------------------------------

export const UNDO_FILES = ['tasks.json', 'calendar.json', 'lists.json', 'notes.json', 'reminders.json', 'memory.json']

const MAX_UNDO = 15

export interface UndoSnapshot {
  label: string
  ts: number
  files: Record<string, string | null> // null = arquivo não existia
}

/** Lê o conteúdo atual dos arquivos de dados (null quando o arquivo não existe). */
export function captureSnapshot(dir: string, label: string): UndoSnapshot {
  const files: Record<string, string | null> = {}
  for (const f of UNDO_FILES) {
    const p = join(dir, f)
    try {
      files[f] = existsSync(p) ? readFileSync(p, 'utf8') : null
    } catch {
      files[f] = null
    }
  }
  return { label, ts: Date.now(), files }
}

/** Restaura os arquivos para o estado do snapshot (apaga os que não existiam). */
export function applySnapshot(dir: string, snap: UndoSnapshot): void {
  for (const f of UNDO_FILES) {
    const p = join(dir, f)
    const content = snap.files[f]
    if (content == null) {
      if (existsSync(p)) rmSync(p, { force: true })
    } else {
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content, 'utf8')
    }
  }
}

// Pilha em memória (vale dentro da execução atual do app).
const stack: UndoSnapshot[] = []

export function pushUndo(dir: string, label: string): void {
  stack.push(captureSnapshot(dir, label))
  while (stack.length > MAX_UNDO) stack.shift()
}

export function canUndo(): boolean {
  return stack.length > 0
}

export function undoDepth(): number {
  return stack.length
}

export function undoLast(dir: string): { ok: boolean; label?: string } {
  const snap = stack.pop()
  if (!snap) return { ok: false }
  applySnapshot(dir, snap)
  return { ok: true, label: snap.label }
}

export function clearUndo(): void {
  stack.length = 0
}
