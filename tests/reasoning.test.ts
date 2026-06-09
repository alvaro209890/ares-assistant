import { describe, expect, it } from 'vitest'
import {
  REASONING_LEVELS,
  REASONING_LABEL,
  reasoningEffort,
  coerceReasoning,
  adjustReasoning,
  resolveReasoning
} from '../src/shared/reasoning'

describe('nível de raciocínio', () => {
  it('mapeia para reasoning_effort low/medium/high', () => {
    expect(reasoningEffort('baixo')).toBe('low')
    expect(reasoningEffort('medio')).toBe('medium')
    expect(reasoningEffort('alto')).toBe('high')
  })

  it('tem três níveis com rótulos', () => {
    expect(REASONING_LEVELS).toEqual(['baixo', 'medio', 'alto'])
    expect(REASONING_LABEL.alto).toBe('Alto')
  })

  it('coerceReasoning normaliza valores inválidos para medio', () => {
    expect(coerceReasoning('alto')).toBe('alto')
    expect(coerceReasoning('baixo')).toBe('baixo')
    expect(coerceReasoning(undefined)).toBe('medio')
    expect(coerceReasoning('turbo')).toBe('medio')
    expect(coerceReasoning(null)).toBe('medio')
  })

  it('adjustReasoning sobe/desce saturando nas pontas', () => {
    expect(adjustReasoning('baixo', 'subir')).toBe('medio')
    expect(adjustReasoning('medio', 'subir')).toBe('alto')
    expect(adjustReasoning('alto', 'subir')).toBe('alto') // satura
    expect(adjustReasoning('alto', 'descer')).toBe('medio')
    expect(adjustReasoning('baixo', 'descer')).toBe('baixo') // satura
  })

  it('resolve nível absoluto por palavra (com e sem acento)', () => {
    expect(resolveReasoning('medio', 'baixo')).toBe('baixo')
    expect(resolveReasoning('medio', 'máximo')).toBe('alto')
    expect(resolveReasoning('medio', 'mínimo')).toBe('baixo')
    expect(resolveReasoning('baixo', 'alto')).toBe('alto')
    expect(resolveReasoning('alto', 'médio')).toBe('medio')
  })

  it('resolve comandos relativos a partir do atual', () => {
    // "diminua o seu nível de raciocínio" a partir de alto -> medio
    expect(resolveReasoning('alto', 'diminua o seu nível de raciocínio')).toBe('medio')
    // "aumente o raciocínio" a partir de baixo -> medio
    expect(resolveReasoning('baixo', 'aumente o raciocínio')).toBe('medio')
    expect(resolveReasoning('medio', 'reduza')).toBe('baixo')
  })

  it('o exemplo do usuário "diminua para baixo" cai em baixo (absoluto vence relativo)', () => {
    expect(resolveReasoning('alto', { direcao: 'diminua', nivel: 'baixo' })).toBe('baixo')
    expect(resolveReasoning('alto', 'diminua o seu nível de raciocínio para baixo')).toBe('baixo')
  })

  it('devolve null quando não entende', () => {
    expect(resolveReasoning('medio', '')).toBeNull()
    expect(resolveReasoning('medio', 'qualquer coisa sem sentido')).toBeNull()
    expect(resolveReasoning('medio', undefined)).toBeNull()
  })
})
