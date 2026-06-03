import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { MemoryFact, CalendarEvent, ChatSession, SessionMeta, StoredMessage } from '../shared/types'

// Persistência local (userData) de: memória de longo prazo, calendário e sessões de
// conversa. Tudo em JSON simples, sobrevive a fechar/abrir o app.

function dataPath(file: string): string {
  return join(app.getPath('userData'), file)
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

// ---------------- Memória de longo prazo ----------------
export function loadMemory(): MemoryFact[] {
  return readJSON<MemoryFact[]>('memory.json', [])
}
export function addFact(text: string): MemoryFact[] {
  const t = text.trim()
  const facts = loadMemory()
  if (t && !facts.some((f) => f.text.toLowerCase() === t.toLowerCase())) {
    facts.unshift({ id: uid('fact'), text: t, createdAt: Date.now() })
    writeJSON('memory.json', facts)
  }
  return facts
}
export function removeFact(id: string): MemoryFact[] {
  const facts = loadMemory().filter((f) => f.id !== id)
  writeJSON('memory.json', facts)
  return facts
}

// ---------------- Calendário ----------------
export function loadEvents(): CalendarEvent[] {
  return readJSON<CalendarEvent[]>('calendar.json', []).sort((a, b) => a.whenISO.localeCompare(b.whenISO))
}
export function addEvent(ev: { title: string; whenISO: string; description?: string }): CalendarEvent[] {
  const events = loadEvents()
  events.push({ id: uid('ev'), title: ev.title, whenISO: ev.whenISO, description: ev.description, createdAt: Date.now() })
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
export function setSessionSummary(id: string, summary: string, keepLast: number): void {
  const list = loadSessions()
  const s = list.find((x) => x.id === id)
  if (s) {
    s.summary = summary
    if (s.messages.length > keepLast) s.messages = s.messages.slice(-keepLast)
    saveSessions(list)
  }
}
