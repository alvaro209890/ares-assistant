import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { HiveWorkerStatus } from '../src/shared/types'
import HiveDashboard, { bubbleText } from '../src/renderer/components/HiveDashboard'
import { HIVE_IDLE } from '../src/renderer/lib/store'

const worker = (over: Partial<HiveWorkerStatus> = {}): HiveWorkerStatus => ({
  id: 'researcher',
  label: 'Atena',
  phase: 'idle',
  updatedAt: 0,
  ...over
})

describe('Colmeia — bubbleText (balões condizentes com a fase)', () => {
  it('ocioso usa a frase de prontidão do especialista', () => {
    expect(bubbleText(worker())).toContain('investigação')
    expect(bubbleText(worker({ id: 'engineer', label: 'Hefesto' }))).toContain('Forja')
    expect(bubbleText(worker({ id: 'auditor', label: 'Têmis' }))).toContain('balança')
  })

  it('trabalhando mostra o detalhe real do trabalho', () => {
    expect(bubbleText(worker({ phase: 'thinking', detail: 'Reunindo fontes na web...' }))).toBe(
      'Reunindo fontes na web...'
    )
    expect(bubbleText(worker({ phase: 'thinking' }))).toContain('Trabalhando')
  })

  it('entregue e erro têm fallbacks claros', () => {
    expect(bubbleText(worker({ phase: 'done' }))).toContain('entregue')
    expect(bubbleText(worker({ phase: 'error' }))).toContain('errado')
  })
})

describe('Colmeia — HiveDashboard', () => {
  it('renderiza o Ares e os três especialistas pelo nome', () => {
    const html = renderToStaticMarkup(<HiveDashboard workers={HIVE_IDLE} aresState="idle" />)
    expect(html).toContain('ARES')
    expect(html).toContain('Atena')
    expect(html).toContain('Hefesto')
    expect(html).toContain('Têmis')
    expect(html).toContain('PRONTIDÃO')
  })

  it('mostra ORQUESTRANDO e o balão do trabalho quando um worker está ativo', () => {
    const workers = HIVE_IDLE.map((w) =>
      w.id === 'engineer' ? { ...w, phase: 'thinking' as const, detail: 'Mapeando o projeto...' } : w
    )
    const html = renderToStaticMarkup(<HiveDashboard workers={workers} aresState="thinking" />)
    expect(html).toContain('ORQUESTRANDO')
    expect(html).toContain('Mapeando o projeto...')
  })
})
