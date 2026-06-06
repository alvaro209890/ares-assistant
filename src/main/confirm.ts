import type { Acao } from '../shared/types'

// ---------------------------------------------------------------------------
// Confiança na conversa: confirmação de ações destrutivas.
//
// Por voz, uma transcrição errada não pode virar uma exclusão. Antes de apagar/
// limpar/remover dados, o Ares pede confirmação e só executa após o "sim". O LLM
// é instruído a perguntar; este módulo é o PORTÃO de segurança que garante que
// nada destrutivo executa sem confirmação — mesmo se o LLM falhar.
//
// `decideConfirmation` é pura (testável); o restante é um store por sessão.
// ---------------------------------------------------------------------------

export const DESTRUCTIVE_TYPES = new Set([
  'tarefa.remover',
  'coluna.remover',
  'evento.remover',
  'lembrete.remover',
  'memoria.remover',
  'lista.limpar'
])

export function isDestructive(a: Acao): boolean {
  return DESTRUCTIVE_TYPES.has(a.tipo)
}

export function splitDestructive(actions: Acao[]): { destructive: Acao[]; safe: Acao[] } {
  const destructive: Acao[] = []
  const safe: Acao[] = []
  for (const a of actions) (isDestructive(a) ? destructive : safe).push(a)
  return { destructive, safe }
}

function targetOf(a: Acao): string {
  return String(a.titulo || a.texto || a.fato || a.lista || a.item || '').trim()
}

function phrase(a: Acao): string {
  const t = targetOf(a)
  const q = t ? ` "${t}"` : ''
  switch (a.tipo) {
    case 'tarefa.remover':
      return `apagar a tarefa${q}`
    case 'coluna.remover':
      return `apagar a coluna${q}`
    case 'evento.remover':
      return `remover o evento${q}`
    case 'lembrete.remover':
      return `remover o lembrete${q}`
    case 'memoria.remover':
      return `esquecer${q}`
    case 'lista.limpar':
      return `limpar a lista${q}`
    default:
      return `remover${q}`
  }
}

/** Monta a pergunta de confirmação a partir das ações destrutivas. */
export function describeConfirm(actions: Acao[]): string {
  const parts = actions.map(phrase)
  if (!parts.length) return 'Confirma?'
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
  return `Confirma que eu vou ${list}?`
}

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[.!?,;:]+$/, '')
}

const AFFIRM =
  /^(sim|s|isso|claro|pode( sim| apagar| remover| ser)?|confirmo|confirma(do|r)?|certo|ok(ay)?|positivo|com certeza|aham|aha|exato|exatamente|vai|manda|beleza|ta|por favor|faz|faca|quero|isso ai)\b/
const NEG = /^(nao|negativo|deixa|deixe|cancela(r)?|esquece|para|melhor nao|nem|de jeito nenhum|n)\b/

/** "sim", "pode", "confirmo"… (curto, para não confundir com um novo comando). */
export function isAffirmative(text: string): boolean {
  const t = norm(text)
  if (!t || t.length > 40) return false
  return AFFIRM.test(t)
}

/** "não", "deixa", "cancela"… */
export function isNegative(text: string): boolean {
  const t = norm(text)
  if (!t || t.length > 40) return false
  return NEG.test(t)
}

export interface ConfirmDecision {
  apply: Acao[] // ações a executar agora
  hold: Acao[] | null // ações destrutivas seguradas, aguardando "sim"
  outcome: 'none' | 'held' | 'applied' | 'confirmed' | 'cancelled'
  question?: string // pergunta a fazer quando outcome === 'held'
}

/**
 * Decide o que executar neste turno, dado o que ficou pendente, o que o LLM
 * propôs e o texto do usuário. Pura — todo o estado vive no store/agent.
 */
export function decideConfirmation(opts: { pending: Acao[] | null; proposed: Acao[]; userText: string }): ConfirmDecision {
  const { destructive, safe } = splitDestructive(opts.proposed)
  const hasPending = !!(opts.pending && opts.pending.length)

  if (hasPending) {
    if (isAffirmative(opts.userText)) {
      // "sim": executa o que estava segurado (ignora re-emissões deste turno).
      return { apply: [...safe, ...(opts.pending as Acao[])], hold: null, outcome: 'confirmed' }
    }
    if (isNegative(opts.userText)) {
      return { apply: safe, hold: null, outcome: 'cancelled' }
    }
    // Nem sim nem não: o usuário mudou de assunto — descarta o pendente e segue.
  }

  if (destructive.length) {
    if (isAffirmative(opts.userText)) {
      // Usuário já confirmou verbalmente no mesmo pedido (ex.: "sim, pode apagar").
      return { apply: [...safe, ...destructive], hold: null, outcome: 'applied' }
    }
    return { apply: safe, hold: destructive, outcome: 'held', question: describeConfirm(destructive) }
  }

  return { apply: safe, hold: null, outcome: 'none' }
}

// --- Store por sessão -------------------------------------------------------

interface PendingConfirm {
  actions: Acao[]
  question: string
  createdAt: number
}

const store = new Map<string, PendingConfirm>()
const TTL_MS = 5 * 60_000

export function setPendingConfirm(sessionId: string, actions: Acao[], question: string): void {
  store.set(sessionId, { actions, question, createdAt: Date.now() })
}

export function getPendingConfirm(sessionId: string): PendingConfirm | undefined {
  const p = store.get(sessionId)
  if (!p) return undefined
  if (Date.now() - p.createdAt > TTL_MS) {
    store.delete(sessionId)
    return undefined
  }
  return p
}

export function clearPendingConfirm(sessionId: string): boolean {
  return store.delete(sessionId)
}
