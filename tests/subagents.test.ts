import { describe, expect, it } from 'vitest'
import type { MemoryFact } from '../src/shared/types'
import { AUDITOR, ENGINEER, RESEARCHER, SUBAGENT_PROFILES, getSubagentProfile } from '../src/main/subagents/profiles'
import { buildTaskPrompt, relevantMemories, summarizeReport } from '../src/main/subagents/executor'

const fact = (text: string, over: Partial<MemoryFact> = {}): MemoryFact => ({
  id: `f-${text.slice(0, 8)}`,
  text,
  category: 'projetos',
  source: 'manual',
  status: 'active',
  createdAt: Date.now(),
  ...over
})

describe('colmeia — perfis dos subagentes', () => {
  it('tem os três especialistas com campos completos', () => {
    expect(SUBAGENT_PROFILES).toHaveLength(3)
    for (const p of [RESEARCHER, ENGINEER, AUDITOR]) {
      expect(p.label.length).toBeGreaterThan(2)
      expect(p.systemPrompt).toContain('subagente')
      expect(p.temperature).toBeGreaterThanOrEqual(0)
      expect(p.temperature).toBeLessThanOrEqual(0.5)
    }
  })

  it('temperaturas refletem a especialidade (auditor mais frio que pesquisador)', () => {
    expect(AUDITOR.temperature).toBeLessThan(RESEARCHER.temperature)
  })

  it('getSubagentProfile acha por id e devolve null para desconhecido', () => {
    expect(getSubagentProfile('engineer')).toBe(ENGINEER)
    expect(getSubagentProfile('chef')).toBeNull()
  })
})

describe('colmeia — buildTaskPrompt', () => {
  it('inclui objetivo, contexto, material e memórias quando presentes', () => {
    const prompt = buildTaskPrompt({
      goal: 'Comparar Vitest e Jest',
      context: 'O usuário usa Electron com Vite',
      evidence: 'Resultados de busca: ...',
      memories: ['Projeto Ares usa Vitest']
    })
    expect(prompt).toContain('OBJETIVO:\nComparar Vitest e Jest')
    expect(prompt).toContain('CONTEXTO DO ARES')
    expect(prompt).toContain('MATERIAL COLETADO')
    expect(prompt).toContain('- Projeto Ares usa Vitest')
  })

  it('omite seções vazias', () => {
    const prompt = buildTaskPrompt({ goal: 'Auditar o projeto' })
    expect(prompt).not.toContain('CONTEXTO DO ARES')
    expect(prompt).not.toContain('MATERIAL COLETADO')
    expect(prompt).not.toContain('MEMÓRIA DE LONGO PRAZO')
  })
})

describe('colmeia — relevantMemories (recuperação semântica por tokens)', () => {
  const facts = [
    fact('O projeto Ares é um app Electron com React e Vitest'),
    fact('O usuário prefere café sem açúcar', { category: 'preferencias' }),
    fact('O deploy do VendaFácil usa Vercel e Render')
  ]

  it('recupera o fato mais parecido com o objetivo', () => {
    const out = relevantMemories('auditar o projeto Ares Electron', facts)
    expect(out[0]).toContain('Ares')
    expect(out).not.toContain('O usuário prefere café sem açúcar')
  })

  it('ignora fatos pendentes e devolve vazio sem objetivo', () => {
    const pendentes = [fact('Ares Electron projeto', { status: 'pending' })]
    expect(relevantMemories('projeto Ares Electron', pendentes)).toEqual([])
    expect(relevantMemories('   ', facts)).toEqual([])
  })

  it('limita ao máximo pedido', () => {
    const many = Array.from({ length: 10 }, (_, i) => fact(`projeto Ares módulo ${i}`))
    expect(relevantMemories('projeto Ares', many, 3).length).toBeLessThanOrEqual(3)
  })
})

describe('colmeia — summarizeReport', () => {
  it('pega a primeira frase, curta', () => {
    expect(summarizeReport('Veredito: APROVADO. Nenhum problema real encontrado.\nDetalhes...')).toBe(
      'Veredito: APROVADO.'
    )
  })

  it('trunca relatórios sem pontuação', () => {
    expect(summarizeReport('x'.repeat(300)).length).toBeLessThanOrEqual(120)
  })
})
