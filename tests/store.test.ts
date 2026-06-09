import { describe, expect, it } from 'vitest'
import { finalSpeechFallback } from '../src/renderer/lib/store'

describe('renderer store — fallback de fala final', () => {
  it('usa falaVoz quando a fase 2 nao enfileirou audio', () => {
    expect(
      finalSpeechFallback(
        { fala: 'Resposta completa com detalhes técnicos.', falaVoz: 'Resumo falável da análise.' },
        true,
        false
      )
    ).toBe('Resumo falável da análise.')
  })

  it('nao duplica falaVoz quando a fase 2 ja entrou na fila', () => {
    expect(
      finalSpeechFallback(
        { fala: 'Resposta completa com detalhes técnicos.', falaVoz: 'Resumo falável da análise.' },
        true,
        true
      )
    ).toBe('')
  })

  it('usa fala completa quando nenhum streaming de voz entrou na fila', () => {
    expect(finalSpeechFallback({ fala: 'Resposta final simples.' }, false, false)).toBe('Resposta final simples.')
  })
})
