import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type {
  MemoryFact,
  MemoryCategory,
  MemoryTarget,
  MemoryContradictionAction,
  ConsolidationEvent,
  CalendarEvent,
  ChatSession,
  SessionMeta,
  StoredMessage,
  Checklist,
  ListItem,
  Note,
  Reminder,
  Recurrence
} from '../shared/types'
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABEL, MEMORY_BUDGET_CHARS } from '../shared/types'
import { formatCodingPreferences } from './preferences'
import {
  buildMemoryContextBlock,
  clampConfidence,
  cleanMemoryText,
  detectMemoryContradiction,
  fuzzyMemorySimilarity,
  hasPolarityConflict,
  inferMemoryCategory,
  memoryIdentity,
  mergeMemoryText,
  memoryTargetForCategory,
  memoryUsage,
  mergeEvidence,
  safeMemoryPromptText,
  scanMemoryThreat
} from './memory'
import {
  classifyExtraction,
  computeMemoryScore,
  createAntiFactText,
  getAntiFacts,
  isBlockedByAntiFact,
  reinforceFact,
  selectFactsForBudget,
  consolidateMemory as _consolidateMemory,
  resolveConflictAutonomously,
  formatAntiFactsForExtractor
} from './memoryScore'

// Persistência local (userData) de: memória de longo prazo, calendário e sessões de
// conversa. Tudo em JSON simples, sobrevive a fechar/abrir o app.

function dataPath(file: string): string {
  return join(app.getPath('userData'), file)
}
/** Diretório onde ficam os JSON de dados (usado pelo histórico de "desfazer"). */
export function userDataDir(): string {
  return app.getPath('userData')
}
function readJSON<T>(file: string, fallback: T): T {
  try {
    const p = dataPath(file)
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch {
    /* corrompido -> fallback */
  }
  return fallback
}
function writeJSON(file: string, data: unknown): void {
  const p = dataPath(file)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
}
function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function logMemoryEvent(event: { kind: string; factId: string; text: string; ts: number }): void {
  const logs = readJSON<{ kind: string; factId: string; text: string; ts: number }[]>('memory-log.json', [])
  logs.push(event)
  writeJSON('memory-log.json', logs.slice(-100))
}

// ---------------- Memória de longo prazo ----------------
const normCat = (c: unknown): MemoryCategory =>
  MEMORY_CATEGORIES.includes(c as MemoryCategory) ? (c as MemoryCategory) : 'outros'
const SESSION_CONTEXT_TTL_MS = 1000 * 60 * 60 * 24

// Migra fatos antigos (sem categoria/origem/status) para o novo formato.
// 'pending' antigos viram 'probationary' (migração suave).
function normalizeFact(raw: any): MemoryFact {
  const category = normCat(raw?.category)
  const evidence = Array.isArray(raw?.evidence)
    ? raw.evidence.map((x: unknown) => cleanMemoryText(x)).filter(Boolean).slice(0, 4)
    : undefined
  const target: MemoryTarget =
    raw?.target === 'user' || raw?.target === 'memory' ? raw.target : memoryTargetForCategory(category)
  // Migração: 'pending' → 'probationary'
  let status: MemoryFact['status'] = 'active'
  if (raw?.status === 'pending' || raw?.status === 'probationary') status = 'probationary'
  else if (raw?.status === 'archived') status = 'archived'
  else if (raw?.status === 'active') status = 'active'
  return {
    id: typeof raw?.id === 'string' ? raw.id : uid('fact'),
    text: cleanMemoryText(raw?.text ?? ''),
    category,
    source: raw?.source === 'auto' ? 'auto' : 'manual',
    status,
    createdAt: typeof raw?.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : undefined,
    target,
    confidence: raw?.confidence === undefined ? undefined : clampConfidence(raw.confidence),
    evidence,
    review: ['ok', 'possible_conflict', 'low_confidence'].includes(raw?.review) ? raw.review : undefined,
    usageCount: typeof raw?.usageCount === 'number' ? Math.max(0, raw.usageCount) : undefined,
    lastUsedAt: typeof raw?.lastUsedAt === 'number' ? raw.lastUsedAt : undefined,
    expiresAt: typeof raw?.expiresAt === 'number' ? raw.expiresAt : undefined,
    conflictWith: typeof raw?.conflictWith === 'string' ? raw.conflictWith : undefined,
    conflictQuestion: typeof raw?.conflictQuestion === 'string' ? cleanMemoryText(raw.conflictQuestion) : undefined,
    // Campos do sistema autônomo
    corroborations: typeof raw?.corroborations === 'number' ? Math.max(0, raw.corroborations) : 0,
    lastCorroboratedAt: typeof raw?.lastCorroboratedAt === 'number' ? raw.lastCorroboratedAt : undefined,
    score: typeof raw?.score === 'number' ? raw.score : undefined,
    antiFact: raw?.antiFact === true ? true : undefined,
    mergedFrom: Array.isArray(raw?.mergedFrom) ? raw.mergedFrom : undefined
  }
}

export function loadMemory(): MemoryFact[] {
  const all = readJSON<any[]>('memory.json', [])
    .map(normalizeFact)
    .filter((f) => f.text)
  const now = Date.now()
  const active = all.filter((f) => !(typeof f.expiresAt === 'number' && f.expiresAt <= now))
  if (active.length !== all.length) saveMemory(active)
  return active
}

function saveMemory(facts: MemoryFact[]): void {
  writeJSON('memory.json', facts)
}

export interface AddFactOptions {
  category?: MemoryCategory
  source?: 'manual' | 'auto'
  status?: 'active' | 'probationary' | 'archived'
  target?: MemoryTarget
  confidence?: number
  evidence?: string[]
  temporary?: boolean
  ttlMs?: number
  expiresAt?: number
  isExplicit?: boolean // usuário disse "lembre-se que..." — sempre ativo
}

/**
 * Adiciona um fato evitando duplicar: se houver um fato muito parecido, atualiza o
 * texto/categoria do existente em vez de criar outro. Usa classificação autônoma
 * (memória probatória) em vez de aprovação manual.
 */
export function addFact(text: string, opts: AddFactOptions = {}): MemoryFact[] {
  const t = cleanMemoryText(text)
  if (!t) return loadMemory()
  if (scanMemoryThreat(t)) return loadMemory()
  const facts = loadMemory()

  // Verificar anti-fatos: se bloqueado, descartar silenciosamente
  const antiFacts = getAntiFacts(facts)
  if (!opts.isExplicit && isBlockedByAntiFact(t, antiFacts)) return facts

  const category = opts.category ? normCat(opts.category) : inferMemoryCategory(t)
  const source = opts.source ?? 'manual'
  const isExplicit = opts.isExplicit ?? source === 'manual'
  const confidence = opts.confidence === undefined ? (source === 'auto' ? 0.7 : 1) : clampConfidence(opts.confidence)
  const target = opts.target || memoryTargetForCategory(category)
  const evidence = mergeEvidence(undefined, opts.evidence)
  const expiresAt =
    opts.expiresAt || (opts.temporary || opts.ttlMs ? Date.now() + Math.max(60_000, opts.ttlMs || SESSION_CONTEXT_TTL_MS) : undefined)

  // Classificação autônoma: determina o status via matriz categoria × confiança
  const classified = opts.status || classifyExtraction(t, category, confidence, isExplicit)
  if (!classified) return facts // confiança muito baixa → descartado
  const status = classified

  const identity = memoryIdentity(t)
  const exact = facts.find(
    (f) => f.text.toLowerCase() === t.toLowerCase() || (memoryIdentity(f.text) === identity && !hasPolarityConflict(f.text, t))
  )
  if (exact) {
    // Já existe igual: corroborar e promover se for o caso
    if (status === 'active') exact.status = 'active'
    exact.category = category
    exact.target = target
    exact.confidence = Math.max(exact.confidence ?? 0, confidence)
    exact.evidence = mergeEvidence(exact.evidence, evidence)
    exact.text = mergeMemoryText(exact.text, t)
    if (expiresAt && (!exact.expiresAt || expiresAt > exact.expiresAt)) exact.expiresAt = expiresAt
    exact.review = exact.review === 'possible_conflict' && status !== 'active' ? exact.review : 'ok'
    // Corroboração: incrementar contagem
    exact.corroborations = (exact.corroborations || 0) + 1
    exact.lastCorroboratedAt = Date.now()
    // Promoção por corroboração: ≥2 corroborações → ativo
    if (exact.status === 'probationary' && (exact.corroborations || 0) >= 2) exact.status = 'active'
    exact.updatedAt = Date.now()
    saveMemory(facts)
    logMemoryEvent({ kind: 'corroborated', factId: exact.id, text: exact.text, ts: Date.now() })
    return facts
  }

  const conflict = facts
    .filter((f) => f.status === 'active' || f.status === 'probationary')
    .map((f) => detectMemoryContradiction(f, t))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.score - a.score)[0]
  if (conflict) {
    // Resolução autônoma de conflito
    const existing = facts.find((f) => f.id === conflict.existingId)
    if (existing) {
      const resolution = resolveConflictAutonomously(existing, t)
      if (resolution.action === 'replace_silent') {
        // Substituir silenciosamente (preferências mudam)
        existing.text = t
        existing.category = category
        existing.target = target
        existing.confidence = confidence
        existing.evidence = mergeEvidence(existing.evidence, evidence)
        existing.updatedAt = Date.now()
        existing.review = 'ok'
        existing.conflictWith = undefined
        existing.conflictQuestion = undefined
        saveMemory(facts)
        return facts
      }
    }
    // ask_user: criar pendência com pergunta verbal
    facts.unshift({
      id: uid('fact'),
      text: t,
      category,
      source,
      status: 'probationary',
      createdAt: Date.now(),
      target,
      confidence: Math.min(confidence, 0.65),
      evidence,
      expiresAt,
      review: 'possible_conflict',
      conflictWith: conflict.existingId,
      conflictQuestion: conflict.question,
      corroborations: 0
    })
    saveMemory(facts)
    return facts
  }

  const similar = facts
    .map((f) => ({ f, score: fuzzyMemorySimilarity(f.text, t), conflict: hasPolarityConflict(f.text, t) }))
    .filter((x) => x.score >= 0.52)
    .sort((a, b) => b.score - a.score)[0]
  if (similar) {
    if (similar.conflict) {
      // Resolução autônoma
      const resolution = resolveConflictAutonomously(similar.f, t)
      if (resolution.action === 'replace_silent') {
        similar.f.text = t
        similar.f.category = category
        similar.f.target = target
        similar.f.confidence = confidence
        similar.f.evidence = mergeEvidence(similar.f.evidence, evidence)
        similar.f.updatedAt = Date.now()
        similar.f.review = 'ok'
        saveMemory(facts)
        return facts
      }
      const question = resolution.question || `Senhor, encontrei uma possivel contradicao entre "${similar.f.text}" e "${t}". Qual informacao devo manter?`
      facts.unshift({
        id: uid('fact'),
        text: t,
        category,
        source,
        status: 'probationary',
        createdAt: Date.now(),
        target,
        confidence: Math.min(confidence, 0.55),
        evidence,
        expiresAt,
        review: 'possible_conflict',
        conflictWith: similar.f.id,
        conflictQuestion: question,
        corroborations: 0
      })
      saveMemory(facts)
      return facts
    }

    // Não sobrescreve um fato manual já confirmado com uma extração automática:
    // nesse caso ignora a duplicata para não poluir a memória.
    if (source === 'auto' && similar.f.status === 'active' && similar.f.source === 'manual') return facts
    if (similar.score < 0.68) {
      facts.unshift({
        id: uid('fact'),
        text: t,
        category,
        source,
        status,
        createdAt: Date.now(),
        target,
        confidence,
        evidence,
        expiresAt,
        review: source === 'auto' && confidence < 0.7 ? 'low_confidence' : 'ok',
        corroborations: 0
      })
      saveMemory(facts)
      logMemoryEvent({ kind: 'learned', factId: facts[0].id, text: t, ts: Date.now() })
      return facts
    }
    similar.f.text = mergeMemoryText(similar.f.text, t)
    similar.f.category = category
    similar.f.target = target
    similar.f.confidence = Math.max(similar.f.confidence ?? 0, confidence)
    similar.f.evidence = mergeEvidence(similar.f.evidence, evidence)
    if (expiresAt && (!similar.f.expiresAt || expiresAt > similar.f.expiresAt)) similar.f.expiresAt = expiresAt
    if (status === 'active') similar.f.status = 'active'
    similar.f.review = similar.f.review === 'possible_conflict' && status !== 'active' ? similar.f.review : 'ok'
    similar.f.corroborations = (similar.f.corroborations || 0) + 1
    similar.f.lastCorroboratedAt = Date.now()
    if (similar.f.status === 'probationary' && (similar.f.corroborations || 0) >= 2) similar.f.status = 'active'
    similar.f.updatedAt = Date.now()
    saveMemory(facts)
    return facts
  }

  facts.unshift({
    id: uid('fact'),
    text: t,
    category: category ?? 'outros',
    source,
    status,
    createdAt: Date.now(),
    target,
    confidence,
    evidence,
    expiresAt,
    review: source === 'auto' && confidence < 0.7 ? 'low_confidence' : 'ok',
    corroborations: 0
  })
  saveMemory(facts)
  logMemoryEvent({ kind: 'learned', factId: facts[0].id, text: t, ts: Date.now() })
  return facts
}

export function updateFact(id: string, patch: Partial<Pick<MemoryFact, 'text' | 'category' | 'status'>>): MemoryFact[] {
  const facts = loadMemory()
  const f = facts.find((x) => x.id === id)
  if (f) {
    if (typeof patch.text === 'string') {
      const text = cleanMemoryText(patch.text)
      if (text && !scanMemoryThreat(text)) f.text = text
    }
    if (patch.category) {
      f.category = normCat(patch.category)
      f.target = memoryTargetForCategory(f.category)
    }
    if (patch.status === 'active' || patch.status === 'probationary' || patch.status === 'archived') {
      f.status = patch.status
    }
    if (patch.status === 'active') f.review = 'ok'
    f.updatedAt = Date.now()
    saveMemory(facts)
  }
  return facts
}

export function approveFact(id: string): MemoryFact[] {
  return updateFact(id, { status: 'active' })
}

export function resolveContradiction(id: string, action: MemoryContradictionAction): MemoryFact[] {
  const facts = loadMemory()
  const pending = facts.find((f) => f.id === id)
  if (!pending) return facts
  const old = pending.conflictWith ? facts.find((f) => f.id === pending.conflictWith) : undefined
  const now = Date.now()

  if (action === 'keep_old') {
    const next = facts.filter((f) => f.id !== pending.id)
    saveMemory(next)
    return next
  }

  if (!old) {
    pending.status = 'active'
    pending.review = 'ok'
    pending.conflictWith = undefined
    pending.conflictQuestion = undefined
    pending.updatedAt = now
    saveMemory(facts)
    return facts
  }

  if (action === 'update_to_new') {
    old.text = pending.text
    old.category = pending.category
    old.target = pending.target || memoryTargetForCategory(pending.category)
  } else {
    old.text = mergeMemoryText(old.text, pending.text)
    if (old.category === 'outros' && pending.category !== 'outros') old.category = pending.category
    old.target = memoryTargetForCategory(old.category)
  }
  old.confidence = Math.max(old.confidence ?? 0, pending.confidence ?? 0)
  old.evidence = mergeEvidence(old.evidence, pending.evidence)
  old.status = 'active'
  old.review = 'ok'
  old.updatedAt = now
  old.conflictWith = undefined
  old.conflictQuestion = undefined

  const next = facts.filter((f) => f.id !== pending.id)
  saveMemory(next)
  return next
}

export function removeFact(id: string, createAntiFact = false): MemoryFact[] {
  const facts = loadMemory()
  const removed = facts.find((f) => f.id === id)
  const next = facts.filter((f) => f.id !== id)
  // Criar anti-fato para evitar reaprendizado
  if (createAntiFact && removed && !removed.antiFact) {
    next.unshift({
      id: uid('fact'),
      text: createAntiFactText(removed.text),
      category: removed.category,
      source: 'manual',
      status: 'active',
      createdAt: Date.now(),
      target: removed.target || memoryTargetForCategory(removed.category),
      confidence: 1,
      antiFact: true,
      corroborations: 0
    })
    logMemoryEvent({ kind: 'forgotten', factId: id, text: removed.text, ts: Date.now() })
  }
  saveMemory(next)
  return next
}

function touchMemoryUse(ids: string[]): void {
  if (!ids.length) return
  const wanted = new Set(ids)
  const facts = loadMemory()
  const now = Date.now()
  let changed = false
  for (const f of facts) {
    if (!wanted.has(f.id)) continue
    f.usageCount = (f.usageCount || 0) + 1
    f.lastUsedAt = now
    changed = true
  }
  if (changed) saveMemory(facts)
}

/**
 * Resumo da memória para injetar no prompt, com orçamento rígido de MEMORY_BUDGET_CHARS.
 * Usa seleção por score (nunca trunca no meio de um fato). Só fatos ativos e
 * probatórios (não-anti-fatos) entram.
 */
export function memorySummary(maxChars = MEMORY_BUDGET_CHARS): string {
  const allFacts = loadMemory()
  const { selected } = selectFactsForBudget(allFacts, maxChars)
  if (!selected.length) return '(nada registrado)'
  const usage = memoryUsage(selected)
  const byCat = new Map<MemoryCategory, string[]>()
  const usedIds: string[] = []
  for (const f of selected) {
    const arr = byCat.get(f.category) || []
    arr.push(safeMemoryPromptText(f.text))
    byCat.set(f.category, arr)
    usedIds.push(f.id)
  }
  let out = `Perfil ${usage.user.pct}% (${usage.user.chars}/${usage.user.limit}); notas ${usage.memory.pct}% (${usage.memory.chars}/${usage.memory.limit}).`
  for (const cat of MEMORY_CATEGORIES) {
    const items = byCat.get(cat)
    if (!items?.length) continue
    const block = `\n${MEMORY_CATEGORY_LABEL[cat]}: ${items.join('; ')}`
    if (out.length + block.length > maxChars) break // corte por fato inteiro, nunca no meio
    out += block
  }
  touchMemoryUse(usedIds)
  return out || '(nada registrado)'
}

export function memoryPromptBlock(maxChars = MEMORY_BUDGET_CHARS): string {
  return buildMemoryContextBlock(memorySummary(maxChars))
}


/**
 * "Pílulas de Contexto": resumo das preferências de CODIFICAÇÃO do usuário (aspas,
 * funções nomeadas, indentação…), derivadas da memória de longo prazo. Injetado na
 * seção de Programação do prompt para o Ares respeitar o estilo do usuário.
 */
export function codingPreferencesSummary(): string {
  return formatCodingPreferences(loadMemory())
}

// ---------------- Memória de Sessão Curta ----------------
// Contexto operacional volátil porém persistido: o último arquivo editado e o último
// comando de terminal bem-sucedido. Permite ao Ares retomar o fio ("rodo o teste
// naquele arquivo?") sem o usuário repetir o caminho.
export interface ShortSessionContext {
  lastEditedFile?: string
  lastEditedRoot?: string
  lastTerminalCommand?: string
  lastTerminalRoot?: string
  updatedAt?: number
}

export function getSessionContext(): ShortSessionContext {
  const ctx = readJSON<ShortSessionContext>('session-context.json', {})
  if (ctx.updatedAt && Date.now() - ctx.updatedAt > SESSION_CONTEXT_TTL_MS) {
    writeJSON('session-context.json', {})
    return {}
  }
  return ctx
}
function writeSessionContext(patch: Partial<ShortSessionContext>): ShortSessionContext {
  const next = { ...getSessionContext(), ...patch, updatedAt: Date.now() }
  writeJSON('session-context.json', next)
  return next
}
/** Registra o último arquivo criado/editado (com a raiz do workspace, se houver). */
export function setLastEditedFile(file: string, root?: string): void {
  const f = String(file || '').trim()
  if (f) writeSessionContext({ lastEditedFile: f, lastEditedRoot: root })
}
/** Registra o último comando de terminal que rodou com sucesso. */
export function setLastTerminalCommand(command: string, root?: string): void {
  const c = String(command || '').trim()
  if (c) writeSessionContext({ lastTerminalCommand: c, lastTerminalRoot: root })
}
/** Resumo curto da memória de sessão para o prompt (vazio se nada relevante). */
export function sessionContextSummary(): string {
  const ctx = getSessionContext()
  const lines: string[] = []
  if (ctx.lastEditedFile) lines.push(`Último arquivo editado: ${ctx.lastEditedFile}`)
  if (ctx.lastTerminalCommand) lines.push(`Último comando de terminal OK: ${ctx.lastTerminalCommand}`)
  return lines.join('\n')
}

// ---------------- Calendário ----------------
export function loadEvents(): CalendarEvent[] {
  return readJSON<CalendarEvent[]>('calendar.json', []).sort((a, b) => a.whenISO.localeCompare(b.whenISO))
}
export function addEvent(ev: {
  title: string
  whenISO: string
  description?: string
  remindMinutes?: number
  recurrence?: CalendarEvent['recurrence']
}): CalendarEvent[] {
  const events = loadEvents()
  events.push({
    id: uid('ev'),
    title: ev.title,
    whenISO: ev.whenISO,
    description: ev.description,
    remindMinutes: typeof ev.remindMinutes === 'number' && ev.remindMinutes > 0 ? ev.remindMinutes : undefined,
    recurrence: ev.recurrence && ev.recurrence !== 'none' ? ev.recurrence : undefined,
    createdAt: Date.now()
  })
  writeJSON('calendar.json', events)
  return loadEvents()
}
export function removeEvent(id: string): CalendarEvent[] {
  const events = loadEvents().filter((e) => e.id !== id)
  writeJSON('calendar.json', events)
  return events
}
export function setEvents(events: CalendarEvent[]): CalendarEvent[] {
  writeJSON('calendar.json', events)
  return loadEvents()
}

// ---------------- Sessões de conversa ----------------
function loadSessions(): ChatSession[] {
  return readJSON<ChatSession[]>('sessions.json', [])
}
function saveSessions(list: ChatSession[]): void {
  writeJSON('sessions.json', list)
}
export function listSessions(): SessionMeta[] {
  return loadSessions()
    .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
export function getSession(id: string): ChatSession | null {
  return loadSessions().find((s) => s.id === id) ?? null
}
export function createSession(title = 'Nova conversa'): ChatSession {
  const list = loadSessions()
  const s: ChatSession = { id: uid('sess'), title, createdAt: Date.now(), updatedAt: Date.now(), messages: [] }
  list.push(s)
  saveSessions(list)
  return s
}
export function renameSession(id: string, title: string): void {
  const list = loadSessions()
  const s = list.find((x) => x.id === id)
  if (s) {
    s.title = title.trim() || s.title
    s.updatedAt = Date.now()
    saveSessions(list)
  }
}
export function deleteSession(id: string): void {
  saveSessions(loadSessions().filter((s) => s.id !== id))
}
export function appendMessages(id: string, msgs: StoredMessage[]): ChatSession | null {
  const list = loadSessions()
  const s = list.find((x) => x.id === id)
  if (!s) return null
  s.messages.push(...msgs)
  s.updatedAt = Date.now()
  // título automático a partir da 1ª fala do usuário
  if (s.title === 'Nova conversa') {
    const firstUser = s.messages.find((m) => m.role === 'user')
    if (firstUser) s.title = firstUser.content.slice(0, 40)
  }
  saveSessions(list)
  return s
}

export function searchSessions(query: string, limit = 5): {
  query: string
  matches: Array<{ sessionId: string; title: string; updatedAt: number; role: StoredMessage['role']; content: string; score: number }>
} {
  const q = cleanMemoryText(query)
  if (!q) return { query: q, matches: [] }
  const terms = memoryIdentity(q).split(/\s+/).filter(Boolean)
  if (!terms.length) return { query: q, matches: [] }
  const matches: Array<{ sessionId: string; title: string; updatedAt: number; role: StoredMessage['role']; content: string; score: number }> = []
  for (const s of loadSessions()) {
    for (const m of s.messages) {
      const text = cleanMemoryText(m.content)
      if (!text) continue
      const hay = memoryIdentity(text)
      const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0)
      if (score <= 0) continue
      matches.push({
        sessionId: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        role: m.role,
        content: text.slice(0, 360),
        score
      })
    }
  }
  return {
    query: q,
    matches: matches
      .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, Math.min(Number(limit) || 5, 20)))
  }
}
export function setSessionSummary(id: string, summary: string, keepLast: number): void {
  const list = loadSessions()
  const s = list.find((x) => x.id === id)
  if (s) {
    s.summary = summary
    if (s.messages.length > keepLast) s.messages = s.messages.slice(-keepLast)
    saveSessions(list)
  }
}

// ---------------- Listas simples (compras/afazeres) ----------------
const normTxt = (s: unknown) => String(s ?? '').toLowerCase().trim()

export function loadLists(): Checklist[] {
  return readJSON<Checklist[]>('lists.json', [])
}
function saveLists(lists: Checklist[]): void {
  writeJSON('lists.json', lists)
}
/** Garante uma lista pelo título (cria se não existir). */
function ensureList(lists: Checklist[], title: string): Checklist {
  const t = title.trim() || 'Lista'
  let l = lists.find((x) => normTxt(x.title) === normTxt(t) || normTxt(x.title).includes(normTxt(t)))
  if (!l) {
    l = { id: uid('list'), title: t, items: [], createdAt: Date.now() }
    lists.push(l)
  }
  return l
}
export function listCreate(title: string): Checklist[] {
  const lists = loadLists()
  ensureList(lists, title)
  saveLists(lists)
  return loadLists()
}
export function listAddItem(title: string, text: string): Checklist[] {
  const t = text.trim()
  if (!t) return loadLists()
  const lists = loadLists()
  const l = ensureList(lists, title || 'Compras')
  if (!l.items.some((i) => normTxt(i.text) === normTxt(t))) {
    l.items.push({ id: uid('li'), text: t, done: false })
  }
  saveLists(lists)
  return loadLists()
}
export function listToggleItem(title: string, text: string, done?: boolean): Checklist[] {
  const lists = loadLists()
  const l = lists.find((x) => normTxt(x.title).includes(normTxt(title)))
  if (l) {
    const it = l.items.find((i) => normTxt(i.text).includes(normTxt(text)))
    if (it) it.done = typeof done === 'boolean' ? done : !it.done
    saveLists(lists)
  }
  return loadLists()
}
export function listRemoveItem(title: string, text: string): Checklist[] {
  const lists = loadLists()
  const l = lists.find((x) => normTxt(x.title).includes(normTxt(title)))
  if (l) {
    l.items = l.items.filter((i) => !normTxt(i.text).includes(normTxt(text)))
    saveLists(lists)
  }
  return loadLists()
}
export function listClear(title: string): Checklist[] {
  const lists = loadLists()
  const l = lists.find((x) => normTxt(x.title).includes(normTxt(title)))
  if (l) {
    l.items = []
    saveLists(lists)
  }
  return loadLists()
}
export function listRemove(title: string): Checklist[] {
  const lists = loadLists().filter((x) => !normTxt(x.title).includes(normTxt(title)) || !title.trim())
  saveLists(lists)
  return loadLists()
}
/** Substitui o conjunto de listas (usado pela edição manual no renderer). */
export function setLists(lists: Checklist[]): Checklist[] {
  saveLists(lists)
  return loadLists()
}
/** Resumo curto das listas para o prompt do agente. */
export function listsSummary(): string {
  const lists = loadLists()
  if (!lists.length) return '(nenhuma lista)'
  return lists
    .map((l) => `- "${l.title}": ${l.items.filter((i) => !i.done).map((i) => i.text).join(', ') || '(vazia)'}`)
    .join('\n')
}

// ---------------- Notas rápidas ----------------
export function loadNotes(): Note[] {
  return readJSON<Note[]>('notes.json', []).sort((a, b) => b.createdAt - a.createdAt)
}
export function addNote(text: string): Note[] {
  const t = text.trim()
  if (!t) return loadNotes()
  const notes = loadNotes()
  notes.unshift({ id: uid('note'), text: t, createdAt: Date.now() })
  writeJSON('notes.json', notes)
  return loadNotes()
}
export function removeNote(id: string): Note[] {
  writeJSON('notes.json', loadNotes().filter((n) => n.id !== id))
  return loadNotes()
}

// ---------------- Lembretes (remédio/rotina, timer, despertador) ----------------
export function loadReminders(): Reminder[] {
  return readJSON<Reminder[]>('reminders.json', []).sort((a, b) => a.whenISO.localeCompare(b.whenISO))
}
export function setReminders(rs: Reminder[]): Reminder[] {
  writeJSON('reminders.json', rs)
  return loadReminders()
}
export function addReminder(r: {
  text: string
  whenISO: string
  recurrence?: Recurrence
  kind?: Reminder['kind']
}): Reminder[] {
  const rs = loadReminders()
  rs.push({
    id: uid('rem'),
    text: r.text.trim() || 'Lembrete',
    whenISO: r.whenISO,
    recurrence: r.recurrence && r.recurrence !== 'none' ? r.recurrence : undefined,
    kind: r.kind || 'reminder',
    createdAt: Date.now()
  })
  writeJSON('reminders.json', rs)
  return loadReminders()
}
export function removeReminder(id: string): Reminder[] {
  writeJSON('reminders.json', loadReminders().filter((r) => r.id !== id))
  return loadReminders()
}
export function removeReminderByText(text: string): Reminder[] {
  const rs = loadReminders()
  const idx = rs.findIndex((r) => normTxt(r.text).includes(normTxt(text)))
  if (idx >= 0) rs.splice(idx, 1)
  writeJSON('reminders.json', rs)
  return loadReminders()
}
/** Resumo curto dos próximos lembretes para o prompt do agente. */
export function remindersSummary(): string {
  const now = Date.now()
  const up = loadReminders()
    .filter((r) => r.recurrence || new Date(r.whenISO).getTime() > now - 3600_000)
    .slice(0, 8)
  if (!up.length) return '(nenhum)'
  return up
    .map((r) => `- ${new Date(r.whenISO).toLocaleString('pt-BR')}${r.recurrence ? ` (repete ${r.recurrence})` : ''}: ${r.text}`)
    .join('\n')
}

export function runConsolidation(): { promoted: string[]; archived: string[]; merged: any[]; events: ConsolidationEvent[] } {
  const facts = loadMemory()
  const res = _consolidateMemory(facts)
  saveMemory(res.facts)
  for (const ev of res.events) {
    logMemoryEvent(ev)
  }
  return { promoted: res.promoted, archived: res.archived, merged: res.merged, events: res.events }
}

export function loadMemoryLog(): ConsolidationEvent[] {
  return readJSON<ConsolidationEvent[]>('memory-log.json', [])
}

export function getAntiFactsForExtractor(): string {
  return formatAntiFactsForExtractor(loadMemory())
}
