import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// O demoManager importa o demoExporter, que importa 'electron'. Mockamos os dois
// para isolar a lógica de avanço de slides (timer/fila) do resto.
vi.mock('electron', () => ({
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

import { demoManager } from '../src/main/demoManager'
import type { DemoSlide, DemoState } from '../src/shared/types'

const slide = (id: string): DemoSlide => ({ id, title: `Slide ${id}`, points: [`ponto ${id}`] })

describe('DemoManager — apresentação com avanço por timer', () => {
  beforeEach(() => {
    demoManager.stop()
    demoManager.removeAllListeners()
    vi.useFakeTimers()
  })
  afterEach(() => {
    demoManager.removeAllListeners()
    vi.useRealTimers()
  })

  it('queueSlides exibe o primeiro slide imediatamente e ativa o Modo Apresentação', () => {
    const states: DemoState[] = []
    demoManager.on('state-changed', (s: DemoState) => states.push(s))

    demoManager.queueSlides([slide('a'), slide('b'), slide('c')])

    expect(demoManager.getState().isActive).toBe(true)
    expect(demoManager.getState().currentSlide?.id).toBe('a')
    // Deve ter emitido pelo menos um estado ativo com o primeiro slide.
    expect(states.some((s) => s.isActive && s.currentSlide?.id === 'a')).toBe(true)
  })

  it('avança automaticamente para os próximos slides com o tempo', () => {
    const shown: string[] = []
    demoManager.on('slide', (s: DemoSlide) => shown.push(s.id))

    demoManager.queueSlides([slide('a'), slide('b'), slide('c')])
    expect(shown).toEqual(['a'])

    vi.advanceTimersByTime(7000)
    expect(shown).toEqual(['a', 'b'])

    vi.advanceTimersByTime(7000)
    expect(shown).toEqual(['a', 'b', 'c'])
    expect(demoManager.getState().currentSlide?.id).toBe('c')

    // Sem mais slides na fila, não avança mais.
    vi.advanceTimersByTime(7000)
    expect(shown).toEqual(['a', 'b', 'c'])
  })

  it('pause congela o avanço; resume retoma', () => {
    const shown: string[] = []
    demoManager.on('slide', (s: DemoSlide) => shown.push(s.id))

    demoManager.queueSlides([slide('a'), slide('b')])
    expect(shown).toEqual(['a'])

    demoManager.pause()
    vi.advanceTimersByTime(20000)
    expect(shown).toEqual(['a']) // pausado: não avançou

    demoManager.resume()
    vi.advanceTimersByTime(7000)
    expect(shown).toEqual(['a', 'b'])
  })

  it('stop limpa a fila e zera o estado', () => {
    demoManager.queueSlides([slide('a'), slide('b'), slide('c')])
    demoManager.stop()

    expect(demoManager.getState().isActive).toBe(false)
    expect(demoManager.getState().currentSlide).toBeUndefined()

    const shown: string[] = []
    demoManager.on('slide', (s: DemoSlide) => shown.push(s.id))
    vi.advanceTimersByTime(20000)
    expect(shown).toEqual([]) // fila foi limpa, nada avança
  })

  it('queueSlide (singular) continua funcionando para um slide só', () => {
    demoManager.queueSlide(slide('solo'))
    expect(demoManager.getState().currentSlide?.id).toBe('solo')
    expect(demoManager.getState().isActive).toBe(true)
  })
})
