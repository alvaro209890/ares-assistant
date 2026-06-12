import { describe, expect, it } from 'vitest'
import type { MemoryFact, MemoryCategory } from '../src/shared/types'
import {
  computeMemoryScore,
  selectFactsForBudget,
  classifyExtraction,
  shouldExpire,
  resolveConflictAutonomously,
  createAntiFactText,
  isBlockedByAntiFact,
  consolidateMemory
} from '../src/main/memoryScore'

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: `fact-${Math.random().toString(36).slice(2, 7)}`,
    text: 'fato de teste',
    category: 'outros',
    source: 'auto',
    status: 'active',
    createdAt: Date.now(),
    corroborations: 0,
    ...overrides
  }
}

describe('MemoryScore Logic', () => {
  describe('computeMemoryScore', () => {
    it('deve priorizar categoria perfil sobre outros', () => {
      const f1 = makeFact({ category: 'perfil', createdAt: Date.now() })
      const f2 = makeFact({ category: 'outros', createdAt: Date.now() })
      expect(computeMemoryScore(f1)).toBeGreaterThan(computeMemoryScore(f2))
    })

    it('deve aplicar decaimento temporal', () => {
      const now = Date.now()
      const f1 = makeFact({ category: 'perfil', createdAt: now })
      const f2 = makeFact({ category: 'perfil', createdAt: now - 1000 * 60 * 60 * 24 * 10 }) // 10 dias atrás
      expect(computeMemoryScore(f1, now)).toBeGreaterThan(computeMemoryScore(f2, now))
    })

    it('deve pontuar melhor com maior uso (reinforce)', () => {
      const now = Date.now()
      const f1 = makeFact({ category: 'perfil', createdAt: now, usageCount: 0 })
      const f2 = makeFact({ category: 'perfil', createdAt: now, usageCount: 5 })
      expect(computeMemoryScore(f2, now)).toBeGreaterThan(computeMemoryScore(f1, now))
    })

    it('deve aplicar bônus de corroboração', () => {
      const now = Date.now()
      const f1 = makeFact({ category: 'perfil', createdAt: now, corroborations: 0 })
      const f2 = makeFact({ category: 'perfil', createdAt: now, corroborations: 3 })
      expect(computeMemoryScore(f2, now)).toBeGreaterThan(computeMemoryScore(f1, now))
    })

    it('deve aplicar bônus manual', () => {
      const now = Date.now()
      const f1 = makeFact({ category: 'perfil', createdAt: now, source: 'auto' })
      const f2 = makeFact({ category: 'perfil', createdAt: now, source: 'manual' })
      expect(computeMemoryScore(f2, now)).toBeGreaterThan(computeMemoryScore(f1, now))
    })

    it('deve aplicar penalidade para probatório', () => {
      const now = Date.now()
      const f1 = makeFact({ category: 'perfil', createdAt: now, status: 'active' })
      const f2 = makeFact({ category: 'perfil', createdAt: now, status: 'probationary' })
      expect(computeMemoryScore(f1, now)).toBeGreaterThan(computeMemoryScore(f2, now))
    })

    it('deve retornar -Infinity para fatos arquivados, anti-fatos ou expirados', () => {
      const now = Date.now()
      const fArchived = makeFact({ status: 'archived' })
      const fAnti = makeFact({ antiFact: true })
      const fExpired = makeFact({ expiresAt: now - 1000 })
      expect(computeMemoryScore(fArchived, now)).toBe(-Infinity)
      expect(computeMemoryScore(fAnti, now)).toBe(-Infinity)
      expect(computeMemoryScore(fExpired, now)).toBe(-Infinity)
    })
  })

  describe('selectFactsForBudget', () => {
    it('deve ordenar por score e respeitar limite de caracteres sem truncar fatos', () => {
      const facts = [
        makeFact({ id: '1', text: 'Usuario prefere Python', category: 'preferencias', usageCount: 10 }),
        makeFact({ id: '2', text: 'Usuario gosta de cafe', category: 'interesses', usageCount: 5 }),
        makeFact({ id: '3', text: 'Usuario trabalha na empresa X', category: 'trabalho', usageCount: 1 })
      ]
      // Tamanhos dos fatos:
      // 'Usuario prefere Python' -> 22 chars
      // 'Usuario gosta de cafe' -> 21 chars
      // 'Usuario trabalha na empresa X' -> 29 chars
      // Se limitamos a 50 chars, deve caber 'Usuario prefere Python' + '\n§\n' (3) + 'Usuario gosta de cafe' (21) = 46 chars.
      // O terceiro estoura (46 + 3 + 29 = 78 chars).
      const { selected, overflow } = selectFactsForBudget(facts, 50)
      expect(selected).toHaveLength(2)
      expect(selected[0].id).toBe('1')
      expect(selected[1].id).toBe('2')
      expect(overflow).toHaveLength(1)
      expect(overflow[0].id).toBe('3')
    })
  })

  describe('classifyExtraction', () => {
    it('deve classificar como active se for explicito', () => {
      expect(classifyExtraction('lembre-se', 'outros', 0.1, true)).toBe('active')
    })

    it('deve classificar como active se confianca >= 0.8 e for de baixo risco', () => {
      expect(classifyExtraction('texto', 'preferencias', 0.8, false)).toBe('active')
      expect(classifyExtraction('texto', 'outros', 0.8, false)).toBe('probationary') // outros não é baixo risco
    })

    it('deve classificar como probationary se confianca >= 0.5', () => {
      expect(classifyExtraction('texto', 'outros', 0.5, false)).toBe('probationary')
    })

    it('deve retornar null se confianca < 0.5', () => {
      expect(classifyExtraction('texto', 'preferencias', 0.4, false)).toBeNull()
    })
  })

  describe('shouldExpire', () => {
    it('deve expirar fatos probatorios velhos', () => {
      const now = Date.now()
      const f1 = makeFact({ status: 'probationary', createdAt: now - 1000 * 60 * 60 * 24 * 31 }) // 31 dias atrás
      const f2 = makeFact({ status: 'probationary', createdAt: now - 1000 * 60 * 60 * 24 * 10 }) // 10 dias atrás
      const f3 = makeFact({ status: 'active', createdAt: now - 1000 * 60 * 60 * 24 * 35 }) // active não expira aqui
      expect(shouldExpire(f1, now)).toBe(true)
      expect(shouldExpire(f2, now)).toBe(false)
      expect(shouldExpire(f3, now)).toBe(false)
    })
  })

  describe('resolveConflictAutonomously', () => {
    it('deve resolver silenciosamente para auto com pouca corroboracao', () => {
      const existing = makeFact({ source: 'auto', corroborations: 1 })
      const res = resolveConflictAutonomously(existing, 'Novo fato')
      expect(res.action).toBe('replace_silent')
    })

    it('deve perguntar ao usuario para fatos manuais ou com alta corroboracao', () => {
      const fManual = makeFact({ source: 'manual', corroborations: 0 })
      const fCorroborated = makeFact({ source: 'auto', corroborations: 2 })
      expect(resolveConflictAutonomously(fManual, 'Novo').action).toBe('ask_user')
      expect(resolveConflictAutonomously(fCorroborated, 'Novo').action).toBe('ask_user')
    })
  })

  describe('antiFacts', () => {
    it('deve gerar texto anti-fato e bloquear similar', () => {
      const original = 'Usuario nao gosta de cebola'
      const antiText = createAntiFactText(original)
      expect(antiText).toContain('NÃO assumir que:')
      expect(antiText).toContain('gosta de cebola')

      const antiFact = makeFact({ text: antiText, antiFact: true })
      expect(isBlockedByAntiFact('Usuario odeia cebola', [antiFact])).toBe(true)
      expect(isBlockedByAntiFact('Usuario gosta de alho', [antiFact])).toBe(false)
    })
  })

  describe('consolidateMemory', () => {
    it('deve fundir duplicatas, expirar probatorios velhos, arquivar de score <= 0', () => {
      const now = Date.now()
      const facts = [
        makeFact({ id: 'f1', text: 'Gosta de café expresso', status: 'active' }),
        makeFact({ id: 'f2', text: 'gosta de cafe expresso', status: 'probationary' }), // similar >= 0.72
        makeFact({ id: 'f3', text: 'Mora em Sao Paulo', status: 'probationary', createdAt: now - 1000 * 60 * 60 * 24 * 31 }), // expira
        makeFact({ id: 'f4', text: 'Mora em Rio', status: 'active', usageCount: 0, createdAt: now - 1000 * 60 * 60 * 24 * 365 }) // score <= 0
      ]

      const res = consolidateMemory(facts, now)
      expect(res.facts.map(f => f.id)).toContain('f1')
      expect(res.facts.map(f => f.id)).not.toContain('f2') // fundido
      expect(res.archived).toContain('f3') // expirado
      expect(res.archived).toContain('f4') // esquecido
      expect(res.events.some(e => e.kind === 'merged')).toBe(true)
      expect(res.events.some(e => e.kind === 'expired')).toBe(true)
      expect(res.events.some(e => e.kind === 'forgotten')).toBe(true)
    })
  })
})
