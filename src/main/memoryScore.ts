// Lógica PURA de score, orçamento, classificação, expiração, conflito autônomo,
// anti-fatos e consolidação de memória. Zero dependências de Electron/IO — tudo
// testável isoladamente com vitest.

import type { ConsolidationEvent, MemoryCategory, MemoryFact, MemoryStatus } from '../shared/types'
import { LOW_RISK_CATEGORIES, MEMORY_BUDGET_CHARS } from '../shared/types'
import { fuzzyMemorySimilarity, mergeMemoryText, cleanMemoryText } from './memory'

// ---- Score unificado ----

const CATEGORY_BOOST: Record<MemoryCategory, number> = {
  perfil: 0.75,
  preferencias: 0.7,
  restricoes: 0.55,
  rotina: 0.35,
  projetos: 0.25,
  trabalho: 0.25,
  interesses: 0.2,
  outros: 0.05
}

const DAY_MS = 1000 * 60 * 60 * 24
const DECAY_RATE_PER_DAY = 0.03
const PROBATIONARY_EXPIRY_DAYS = 30

/** Score unificado de um fato: combina categoria, recência, uso, corroboração e fonte. */
export function computeMemoryScore(fact: MemoryFact, now = Date.now()): number {
  if (fact.status === 'archived') return -Infinity
  if (fact.antiFact) return -Infinity // anti-fatos não competem por orçamento do prompt do usuário
  if (typeof fact.expiresAt === 'number' && fact.expiresAt <= now) return -Infinity

  const base = CATEGORY_BOOST[fact.category] || 0
  const ageMs = now - (fact.lastUsedAt || fact.updatedAt || fact.createdAt || now)
  const ageDays = Math.max(0, ageMs / DAY_MS)
  const decay = -(ageDays * DECAY_RATE_PER_DAY)
  const usage = Math.min(0.35, Math.log1p(fact.usageCount || 0) / 8)
  const corroboration = Math.min(0.3, (fact.corroborations || 0) * 0.08)
  const manualBonus = fact.source === 'manual' ? 0.15 : 0
  const probPenalty = fact.status === 'probationary' ? -0.1 : 0

  return base + decay + usage + corroboration + manualBonus + probPenalty
}

// ---- Seleção por orçamento ----

const FACT_DELIMITER = '\n§\n'

export interface BudgetSelection {
  selected: MemoryFact[]
  overflow: MemoryFact[]
}

/**
 * Seleciona fatos por score dentro do orçamento de chars.
 * Nunca trunca no meio de um fato: pára antes de estourar.
 */
export function selectFactsForBudget(
  facts: MemoryFact[],
  budgetChars = MEMORY_BUDGET_CHARS,
  now = Date.now()
): BudgetSelection {
  const eligible = facts.filter(
    (f) =>
      (f.status === 'active' || f.status === 'probationary') &&
      !f.antiFact &&
      !(typeof f.expiresAt === 'number' && f.expiresAt <= now)
  )
  const scored = eligible
    .map((f) => ({ fact: f, score: computeMemoryScore(f, now) }))
    .filter((x) => x.score > -Infinity)
    .sort((a, b) => b.score - a.score)

  const selected: MemoryFact[] = []
  const overflow: MemoryFact[] = []
  let usedChars = 0

  for (const { fact } of scored) {
    const entryLen = fact.text.length + (selected.length > 0 ? FACT_DELIMITER.length : 0)
    if (usedChars + entryLen <= budgetChars) {
      selected.push(fact)
      usedChars += entryLen
    } else {
      overflow.push(fact)
    }
  }

  return { selected, overflow }
}

// ---- Classificação autônoma de extração ----

/**
 * Matriz categoria × confiança para decidir o status de uma extração automática.
 * Retorna null se o fato deve ser descartado (confiança muito baixa).
 */
export function classifyExtraction(
  _text: string,
  category: MemoryCategory,
  confidence: number,
  isExplicit: boolean
): MemoryStatus | null {
  if (isExplicit) return 'active'
  if (confidence >= 0.8 && LOW_RISK_CATEGORIES.includes(category)) return 'active'
  if (confidence >= 0.5) return 'probationary'
  return null // descartado
}

// ---- Expiração de probatórios ----

/** Probatório sem corroboração há 30 dias deve expirar. */
export function shouldExpire(fact: MemoryFact, now = Date.now()): boolean {
  if (fact.status !== 'probationary') return false
  const ref = fact.lastCorroboratedAt || fact.createdAt
  return now - ref > PROBATIONARY_EXPIRY_DAYS * DAY_MS
}

// ---- Resolução autônoma de conflito ----

export interface ConflictResolution {
  action: 'replace_silent' | 'ask_user'
  question?: string
}

/**
 * Decide se um conflito pode ser resolvido silenciosamente ou precisa de pergunta.
 * - Auto-extraído com poucas corroborações: o novo vence sem perguntar.
 * - Manual ou multi-corroborado: gera pergunta verbal curta.
 */
export function resolveConflictAutonomously(
  existing: MemoryFact,
  incomingText: string
): ConflictResolution {
  if (existing.source === 'auto' && (existing.corroborations || 0) <= 1) {
    return { action: 'replace_silent' }
  }
  return {
    action: 'ask_user',
    question: `Senhor, eu tinha anotado que ${existing.text}, mas agora apareceu: ${incomingText}. Qual informação devo manter?`
  }
}

// ---- Anti-fatos ----

/** Gera o texto de um anti-fato a partir do texto original removido/corrigido. */
export function createAntiFactText(originalText: string): string {
  const clean = cleanMemoryText(originalText)
  return `NÃO assumir que: ${clean}`
}

/** Verifica se um texto candidato é bloqueado por algum anti-fato ativo. */
export function isBlockedByAntiFact(text: string, antiFacts: MemoryFact[]): boolean {
  const clean = cleanMemoryText(text)
  for (const af of antiFacts) {
    // O anti-fato tem prefixo "NÃO assumir que: " — comparamos com o conteúdo depois dele
    const afContent = af.text.replace(/^NÃO assumir que:\s*/i, '')
    if (fuzzyMemorySimilarity(clean, afContent) >= 0.63) return true
  }
  return false
}

/** Filtra apenas os anti-fatos ativos de uma lista de fatos. */
export function getAntiFacts(facts: MemoryFact[]): MemoryFact[] {
  return facts.filter((f) => f.antiFact && (f.status === 'active' || f.status === 'probationary'))
}

/** Formata anti-fatos para injeção no prompt do extrator. */
export function formatAntiFactsForExtractor(facts: MemoryFact[]): string {
  const afs = getAntiFacts(facts)
  if (!afs.length) return ''
  return afs.map((f) => `- ${f.text}`).join('\n')
}

// ---- Decaimento e reforço ----

/** Recalcula o score de todos os fatos com base nos timestamps atuais. */
export function applyDecay(facts: MemoryFact[], now = Date.now()): MemoryFact[] {
  for (const f of facts) {
    f.score = computeMemoryScore(f, now)
  }
  return facts
}

/** Reforça um fato quando ele é injetado/recuperado num turno. */
export function reinforceFact(fact: MemoryFact, now = Date.now()): void {
  fact.usageCount = (fact.usageCount || 0) + 1
  fact.lastUsedAt = now
  fact.score = computeMemoryScore(fact, now)
}

// ---- Consolidação ("sono") ----

export interface ConsolidationResult {
  facts: MemoryFact[]
  promoted: string[]
  archived: string[]
  merged: Array<{ into: string; from: string[] }>
  events: ConsolidationEvent[]
}

/**
 * Ciclo de consolidação (puro): funde duplicatas, promove probatórios corroborados,
 * arquiva fatos decaídos/expirados. Retorna o novo conjunto e a lista de eventos.
 */
export function consolidateMemory(facts: MemoryFact[], now = Date.now()): ConsolidationResult {
  const events: ConsolidationEvent[] = []
  const promoted: string[] = []
  const archived: string[] = []
  const merged: Array<{ into: string; from: string[] }> = []
  const removedIds = new Set<string>()

  // 1. Expirar probatórios sem corroboração
  for (const f of facts) {
    if (shouldExpire(f, now)) {
      f.status = 'archived'
      archived.push(f.id)
      events.push({ kind: 'expired', factId: f.id, text: f.text, ts: now })
    }
  }

  // 2. Promover probatórios corroborados
  for (const f of facts) {
    if (f.status === 'probationary' && (f.corroborations || 0) >= 2) {
      f.status = 'active'
      promoted.push(f.id)
      events.push({ kind: 'promoted', factId: f.id, text: f.text, ts: now })
    }
  }

  // 3. Fundir duplicatas/quase-duplicatas entre fatos ativos/probatórios
  const alive = facts.filter((f) => (f.status === 'active' || f.status === 'probationary') && !f.antiFact)
  for (let i = 0; i < alive.length; i++) {
    if (removedIds.has(alive[i].id)) continue
    for (let j = i + 1; j < alive.length; j++) {
      if (removedIds.has(alive[j].id)) continue
      const sim = fuzzyMemorySimilarity(alive[i].text, alive[j].text)
      if (sim >= 0.72) {
        // Funde j em i (i sobrevive)
        alive[i].text = mergeMemoryText(alive[i].text, alive[j].text)
        alive[i].corroborations = (alive[i].corroborations || 0) + (alive[j].corroborations || 0) + 1
        alive[i].usageCount = (alive[i].usageCount || 0) + (alive[j].usageCount || 0)
        alive[i].confidence = Math.max(alive[i].confidence ?? 0, alive[j].confidence ?? 0)
        alive[i].mergedFrom = [...(alive[i].mergedFrom || []), alive[j].id]
        alive[i].updatedAt = now
        if (alive[j].status === 'active') alive[i].status = 'active'
        removedIds.add(alive[j].id)
        merged.push({ into: alive[i].id, from: [alive[j].id] })
        events.push({ kind: 'merged', factId: alive[i].id, text: alive[i].text, ts: now })
      }
    }
  }

  // 4. Arquivar fatos com score muito baixo (decaídos a quase zero)
  for (const f of facts) {
    if (removedIds.has(f.id)) continue
    if (f.status === 'archived') continue
    if (f.antiFact) continue
    const score = computeMemoryScore(f, now)
    f.score = score
    if (score <= 0) {
      f.status = 'archived'
      archived.push(f.id)
      events.push({ kind: 'forgotten', factId: f.id, text: f.text, ts: now })
    }
  }

  // Filtrar fatos removidos por fusão
  const result = facts.filter((f) => !removedIds.has(f.id))

  return { facts: result, promoted, archived, merged, events }
}
