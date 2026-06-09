import { describe, expect, it } from 'vitest'
import type { AgentActivityEvent } from '../src/shared/types'
import { finalSpeechFallback, mergeActivityEvent } from '../src/renderer/lib/store'

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

  it('atualiza atividade por id e preserva outputs como eventos separados', () => {
    const base: AgentActivityEvent = {
      id: 'act-1',
      kind: 'command',
      status: 'running',
      phase: 1,
      title: 'Rodando comando',
      ts: 1,
      command: 'npm test'
    }
    const output: AgentActivityEvent = { ...base, status: 'output', ts: 2, output: 'passou', stream: 'stdout' }
    const done: AgentActivityEvent = { ...base, status: 'done', ts: 3, ok: true }

    const merged = mergeActivityEvent(mergeActivityEvent(mergeActivityEvent([], base), output), done)

    expect(merged).toHaveLength(2)
    expect(merged[0].status).toBe('done')
    expect(merged[1].status).toBe('output')
  })
})
