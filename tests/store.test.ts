import { describe, expect, it } from 'vitest'
import type { AgentActivityEvent, TaskProgressEvent } from '../src/shared/types'
import {
  HIVE_IDLE,
  finalSpeechFallback,
  mergeActivityEvent,
  mergeHiveStatus,
  mergeTaskProgress
} from '../src/renderer/lib/store'

describe('renderer store — fallback de fala final', () => {
  it('usa falaVoz quando a fase 2 nao enfileirou audio', () => {
    expect(
      finalSpeechFallback(
        { fala: 'Resposta completa com detalhes tecnicos.', falaVoz: 'Resumo falavel da analise.' },
        true,
        false
      )
    ).toBe('Resumo falavel da analise.')
  })

  it('nao duplica falaVoz quando a fase 2 ja entrou na fila', () => {
    expect(
      finalSpeechFallback(
        { fala: 'Resposta completa com detalhes tecnicos.', falaVoz: 'Resumo falavel da analise.' },
        true,
        true
      )
    ).toBe('')
  })

  it('usa fala completa quando nenhum streaming de voz entrou na fila', () => {
    expect(finalSpeechFallback({ fala: 'Resposta final simples.' }, false, false)).toBe('Resposta final simples.')
  })

  it('nao refala o texto completo quando fases anteriores ja falaram sem falaVoz (anti-repeticao)', () => {
    // Anti-repetição: queuedSpeech=true e sem falaVoz → não repete o texto completo.
    expect(finalSpeechFallback({ fala: 'Atena concluiu a pesquisa com as fontes recentes.' }, true, false)).toBe('')
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
  it('comeca com os quatro especialistas ociosos', () => {
    expect(HIVE_IDLE.map((w) => w.id)).toEqual(['researcher', 'engineer', 'auditor', 'debugger'])
    expect(HIVE_IDLE.every((w) => w.phase === 'idle')).toBe(true)
  })

  it('atualiza o worker certo preservando os demais', () => {
    const next = mergeHiveStatus(HIVE_IDLE, {
      id: 'engineer',
      label: 'Construtor',
      phase: 'thinking',
      detail: 'Projetando modulo',
      updatedAt: 123
    })
    expect(next.find((w) => w.id === 'engineer')?.phase).toBe('thinking')
    expect(next.find((w) => w.id === 'researcher')?.phase).toBe('idle')
    expect(next).toHaveLength(4)
    expect(HIVE_IDLE.find((w) => w.id === 'engineer')?.phase).toBe('idle')
  })

  it('worker desconhecido e acrescentado (tolerante a versoes futuras)', () => {
    const next = mergeHiveStatus([], { id: 'auditor', label: 'Critico', phase: 'done', updatedAt: 1 })
    expect(next).toHaveLength(1)
  })
})

describe('renderer store — HUD de progresso (mergeTaskProgress)', () => {
  const start: TaskProgressEvent = {
    id: 'task-1',
    tool: 'codigo.testar',
    status: 'start',
    label: 'Rodando testes...',
    ts: 1
  }

  it('ativa o HUD em start/update e preserva o mesmo item', () => {
    const started = mergeTaskProgress(null, start)
    const updated = mergeTaskProgress(started, {
      id: 'task-1',
      tool: 'codigo.testar',
      status: 'update',
      label: 'Executando suite...',
      percent: 40,
      ts: 2
    })

    expect(started?.label).toBe('Rodando testes...')
    expect(updated?.label).toBe('Executando suite...')
    expect(updated?.percent).toBe(40)
  })

  it('limpa o HUD quando a tarefa atual termina', () => {
    const ended = mergeTaskProgress(start, {
      id: 'task-1',
      tool: 'codigo.testar',
      status: 'end',
      label: 'Rodando testes...',
      ok: true,
      ts: 3
    })

    expect(ended).toBeNull()
  })

  it('ignora end de outra tarefa quando a atual e diferente', () => {
    const kept = mergeTaskProgress(start, {
      id: 'task-2',
      tool: 'web.buscar',
      status: 'end',
      label: 'Buscando...',
      ok: true,
      ts: 3
    })

    expect(kept?.id).toBe('task-1')
  })
})
