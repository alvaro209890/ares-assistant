import { describe, expect, it } from 'vitest'
import { createTrace, nullTrace } from '../src/main/agent/trace'

describe('TurnTrace', () => {
  it('emite eventos em ordem com ts relativo crescente', () => {
    const t = createTrace('sess-1')
    t.emit('tool:start', { tipo: 'codigo.workspace' })
    t.emit('tool:end', { tipo: 'codigo.workspace', ok: true })
    const summary = t.end({ mutations: 0 })
    expect(summary.id).toMatch(/^t-/)
    expect(summary.sessionId).toBe('sess-1')
    // turn:start automático + 2 manuais
    expect(summary.events.length).toBe(3)
    expect(summary.events[0].kind).toBe('turn:start')
    expect(summary.events[1].kind).toBe('tool:start')
    expect(summary.events[2].kind).toBe('tool:end')
    for (let i = 1; i < summary.events.length; i++) {
      expect(summary.events[i].ts).toBeGreaterThanOrEqual(summary.events[i - 1].ts)
    }
    expect(summary.summary).toEqual({ mutations: 0 })
  })

  it('preview devolve só o tail (≤50 eventos)', () => {
    const t = createTrace('sess-2')
    for (let i = 0; i < 80; i++) t.emit('phase', { n: i })
    const p = t.preview()
    expect(p.events.length).toBeLessThanOrEqual(50)
    expect(p.eventCount).toBeGreaterThan(50)
  })

  it('limita o tamanho do array de eventos (~200)', () => {
    const t = createTrace('sess-3')
    for (let i = 0; i < 500; i++) t.emit('phase', { n: i })
    const s = t.end()
    expect(s.events.length).toBeLessThanOrEqual(200)
  })

  it('nullTrace é no-op completo', () => {
    const t = nullTrace()
    expect(t.id).toBe('noop')
    t.emit('tool:start', { tipo: 'x' })
    expect(t.events.length).toBe(0)
    expect(t.end({ anything: 1 }).events.length).toBe(0)
    expect(t.preview().eventCount).toBe(0)
  })
})
