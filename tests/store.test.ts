import { describe, expect, it } from 'vitest'
import type { AgentActivityEvent } from '../src/shared/types'
import { HIVE_IDLE, finalSpeechFallback, mergeActivityEvent, mergeHiveStatus } from '../src/renderer/lib/store'

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

  it('usa fala final quando fases anteriores falaram mas a fase final nao entrou na fila', () => {
    expect(finalSpeechFallback({ fala: 'Atena concluiu a pesquisa com as fontes recentes.' }, true, false)).toBe(
      'Atena concluiu a pesquisa com as fontes recentes.'
    )
  })

  it('atualiza atividade por id e agrupa os outputs sob a mesma atividade', () => {
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

    expect(merged).toHaveLength(1)
    expect(merged[0].status).toBe('done')
    expect(merged[0].output).toBe('passou')
  })
})

describe('renderer store — Colmeia (mergeHiveStatus)', () => {

  it('começa com os três especialistas ociosos', () => {
    expect(HIVE_IDLE.map((w) => w.id)).toEqual(['researcher', 'engineer', 'auditor'])
    expect(HIVE_IDLE.every((w) => w.phase === 'idle')).toBe(true)
  })

  it('atualiza o worker certo preservando os demais', () => {
    const next = mergeHiveStatus(HIVE_IDLE, {
      id: 'engineer',
      label: 'Construtor',
      phase: 'thinking',
      detail: 'Projetando módulo',
      updatedAt: 123
    })
    expect(next.find((w) => w.id === 'engineer')?.phase).toBe('thinking')
    expect(next.find((w) => w.id === 'researcher')?.phase).toBe('idle')
    expect(next).toHaveLength(3)
    expect(HIVE_IDLE.find((w) => w.id === 'engineer')?.phase).toBe('idle') // imutável
  })

  it('worker desconhecido é acrescentado (tolerante a versões futuras)', () => {
    const next = mergeHiveStatus([], { id: 'auditor', label: 'Crítico', phase: 'done', updatedAt: 1 })
    expect(next).toHaveLength(1)
  })
})
