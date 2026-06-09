import { afterEach, describe, expect, it } from 'vitest'
import { activeRunCount, cancelAll, cancelSession, registerRun } from '../src/main/running'

afterEach(() => cancelAll())

describe('registro de execuções canceláveis', () => {
  it('registra e dá baixa por sessão', () => {
    const c = new AbortController()
    const off = registerRun('s1', c)
    expect(activeRunCount('s1')).toBe(1)
    off()
    expect(activeRunCount('s1')).toBe(0)
  })

  it('cancelSession aborta os controllers e retorna a contagem', () => {
    const a = new AbortController()
    const b = new AbortController()
    registerRun('s2', a)
    registerRun('s2', b)
    expect(activeRunCount('s2')).toBe(2)

    const n = cancelSession('s2')
    expect(n).toBe(2)
    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(true)
    expect(activeRunCount('s2')).toBe(0)
  })

  it('isola sessões diferentes', () => {
    registerRun('s3', new AbortController())
    registerRun('s4', new AbortController())
    cancelSession('s3')
    expect(activeRunCount('s3')).toBe(0)
    expect(activeRunCount('s4')).toBe(1)
  })

  it('cancelAll limpa tudo', () => {
    registerRun('s5', new AbortController())
    registerRun('s6', new AbortController())
    expect(activeRunCount()).toBeGreaterThanOrEqual(2)
    cancelAll()
    expect(activeRunCount()).toBe(0)
  })
})
