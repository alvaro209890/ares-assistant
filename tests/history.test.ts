import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySnapshot, captureSnapshot, canUndo, clearUndo, pushUndo, undoDepth, undoLast } from '../src/main/history'

let dir = ''
const tasks = () => join(dir, 'tasks.json')
const notes = () => join(dir, 'notes.json')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ares-hist-'))
  clearUndo()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('histórico de desfazer', () => {
  it('restaura o conteúdo anterior de um arquivo', () => {
    writeFileSync(tasks(), '{"v":1}', 'utf8')
    pushUndo(dir, 'estado 1')
    writeFileSync(tasks(), '{"v":2}', 'utf8')

    expect(canUndo()).toBe(true)
    const r = undoLast(dir)
    expect(r.ok).toBe(true)
    expect(r.label).toBe('estado 1')
    expect(readFileSync(tasks(), 'utf8')).toBe('{"v":1}')
    expect(canUndo()).toBe(false)
  })

  it('apaga no desfazer um arquivo que não existia no snapshot', () => {
    // notes.json não existe quando o snapshot é tirado
    pushUndo(dir, 'sem notas')
    writeFileSync(notes(), '[{"x":1}]', 'utf8')
    expect(existsSync(notes())).toBe(true)

    undoLast(dir)
    expect(existsSync(notes())).toBe(false)
  })

  it('empilha (LIFO) e desfaz na ordem inversa', () => {
    writeFileSync(tasks(), 'A', 'utf8')
    pushUndo(dir, 'p1') // snapshot com "A"
    writeFileSync(tasks(), 'B', 'utf8')
    pushUndo(dir, 'p2') // snapshot com "B"
    writeFileSync(tasks(), 'C', 'utf8')

    expect(undoDepth()).toBe(2)
    expect(undoLast(dir).label).toBe('p2')
    expect(readFileSync(tasks(), 'utf8')).toBe('B')
    expect(undoLast(dir).label).toBe('p1')
    expect(readFileSync(tasks(), 'utf8')).toBe('A')
    expect(undoLast(dir).ok).toBe(false)
  })

  it('captureSnapshot/applySnapshot funcionam isolados', () => {
    writeFileSync(tasks(), 'orig', 'utf8')
    const snap = captureSnapshot(dir, 'x')
    writeFileSync(tasks(), 'mudado', 'utf8')
    applySnapshot(dir, snap)
    expect(readFileSync(tasks(), 'utf8')).toBe('orig')
  })
})
