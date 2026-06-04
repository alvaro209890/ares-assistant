import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type {
  MemoryFact,
  MemoryCategory,
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
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABEL } from '../shared/types'

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
const normCat = (c: unknown): MemoryCategory =>
  MEMORY_CATEGORIES.includes(c as MemoryCategory) ? (c as MemoryCategory) : 'outros'

// Migra fatos antigos (sem categoria/origem/status) para o novo formato.
function normalizeFact(raw: any): MemoryFact {
  return {
    id: typeof raw?.id === 'string' ? raw.id : uid('fact'),
    text: String(raw?.text ?? '').trim(),
    category: normCat(raw?.category),
    source: raw?.source === 'auto' ? 'auto' : 'manual',
    status: raw?.status === 'pending' ? 'pending' : 'active',
    createdAt: typeof raw?.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : undefined
  }
}

export function loadMemory(): MemoryFact[] {
  return readJSON<any[]>('memory.json', []).map(normalizeFact).filter((f) => f.text)
}

function saveMemory(facts: MemoryFact[]): void {
  writeJSON('memory.json', facts)
}

const tokenize = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  )

// Sobreposição de tokens (Jaccard) para decidir se um fato é "o mesmo" de outro
// e deve ser atualizado em vez de duplicado.
function similarity(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

export interface AddFactOptions {
  category?: MemoryCategory
  source?: 'manual' | 'auto'
  status?: 'active' | 'pending'
}

/**
 * Adiciona um fato evitando duplicar: se houver um fato muito parecido, atualiza o
 * texto/categoria do existente em vez de criar outro. Fatos automáticos pendentes
 * não substituem fatos já ativos confirmados pelo usuário.
 */
export function addFact(text: string, opts: AddFactOptions = {}): MemoryFact[] {
  const t = text.trim()
  if (!t) return loadMemory()
  const facts = loadMemory()
  const category = opts.category ? normCat(opts.category) : undefined
  const source = opts.source ?? 'manual'
  const status = opts.status ?? 'active'

  const exact = facts.find((f) => f.text.toLowerCase() === t.toLowerCase())
  if (exact) {
    // Já existe igual: só promove de pending->active e ajusta categoria se vier.
    if (status === 'active') exact.status = 'active'
    if (category) exact.category = category
    exact.updatedAt = Date.now()
    saveMemory(facts)
    return facts
  }

  const similar = facts
    .map((f) => ({ f, score: similarity(f.text, t) }))
    .filter((x) => x.score >= 0.55)
    .sort((a, b) => b.score - a.score)[0]
  if (similar) {
    // Não sobrescreve um fato manual já confirmado com uma extração automática:
    // nesse caso ignora a duplicata para não poluir a memória.
    if (source === 'auto' && similar.f.status === 'active' && similar.f.source === 'manual') return facts
    similar.f.text = t
    if (category) similar.f.category = category
    if (status === 'active') similar.f.status = 'active'
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
    createdAt: Date.now()
  })
  saveMemory(facts)
  return facts
}

export function updateFact(id: string, patch: Partial<Pick<MemoryFact, 'text' | 'category' | 'status'>>): MemoryFact[] {
  const facts = loadMemory()
  const f = facts.find((x) => x.id === id)
  if (f) {
    if (typeof patch.text === 'string' && patch.text.trim()) f.text = patch.text.trim()
    if (patch.category) f.category = normCat(patch.category)
    if (patch.status) f.status = patch.status
    f.updatedAt = Date.now()
    saveMemory(facts)
  }
  return facts
}

export function approveFact(id: string): MemoryFact[] {
  return updateFact(id, { status: 'active' })
}

export function removeFact(id: string): MemoryFact[] {
  const facts = loadMemory().filter((f) => f.id !== id)
  saveMemory(facts)
  return facts
}

/**
 * Resumo da memória para injetar no prompt, agrupado por categoria e limitado em
 * tamanho (respeita o orçamento de contexto). Só fatos ativos entram.
 */
export function memorySummary(maxChars = 1400): string {
  const active = loadMemory().filter((f) => f.status === 'active')
  if (!active.length) return '(nada registrado)'
  const byCat = new Map<MemoryCategory, string[]>()
  for (const f of active) {
    const arr = byCat.get(f.category) || []
    arr.push(f.text)
    byCat.set(f.category, arr)
  }
  let out = ''
  for (const cat of MEMORY_CATEGORIES) {
    const items = byCat.get(cat)
    if (!items?.length) continue
    const block = `${MEMORY_CATEGORY_LABEL[cat]}: ${items.join('; ')}`
    if (out.length + block.length > maxChars) {
      out += (out ? '\n' : '') + block.slice(0, Math.max(0, maxChars - out.length))
      break
    }
    out += (out ? '\n' : '') + block
  }
  return out || '(nada registrado)'
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
