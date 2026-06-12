// Telemetria por turno do agente — observabilidade pragmática.
//
// Cada turno cria um TurnTrace com um id estável. Eventos são acumulados em
// memória (struct enxuto: kind/ts/data), com tamanho-limite para evitar
// vazamento. Pode ser inspecionado pelos testes ou ativado em desenvolvimento
// via `ARES_TRACE=1`. NÃO é logado por padrão; o objetivo é responder
// "que decisão o agente tomou neste turno" sem poluir produção.

import { logger } from '../logger'

export type TraceEventKind =
  | 'turn:start'
  | 'turn:end'
  | 'phase'
  | 'tool:start'
  | 'tool:end'
  | 'hive:gather'
  | 'hive:report'
  | 'hive:inferred'
  | 'demo:inferred'
  | 'fallback'
  | 'error'
  | 'mutation'
  | 'note'

export interface TraceEvent {
  ts: number
  kind: TraceEventKind
  data?: Record<string, unknown>
}

export interface TurnTrace {
  id: string
  sessionId: string
  startedAt: number
  events: TraceEvent[]
  /** Encerra o trace e devolve o `data` final para registro/inspeção. */
  end(summary?: Record<string, unknown>): TraceSummary
  /** Registra um evento. */
  emit(kind: TraceEventKind, data?: Record<string, unknown>): void
  /** Encurta `data` para inspeção (texto longo vira preview). */
  preview(): TraceSummary
}

export interface TraceSummary {
  id: string
  sessionId: string
  durationMs: number
  eventCount: number
  events: TraceEvent[]
  summary?: Record<string, unknown>
}

const MAX_EVENTS = 200
let counter = 0

function shouldLog(): boolean {
  const env = process.env?.ARES_TRACE
  return env === '1' || env === 'true'
}

export function createTrace(sessionId: string): TurnTrace {
  const id = `t-${Date.now().toString(36)}-${(++counter).toString(36)}`
  const startedAt = Date.now()
  const events: TraceEvent[] = []
  const trace: TurnTrace = {
    id,
    sessionId,
    startedAt,
    events,
    emit(kind, data) {
      if (events.length >= MAX_EVENTS) return
      events.push({ ts: Date.now() - startedAt, kind, data })
      if (shouldLog()) {
        try {
          logger.debug('agent.trace', `[${id}] ${kind} ${JSON.stringify(data || {})}`)
        } catch {
          /* logger pode não estar disponível em alguns testes */
        }
      }
    },
    preview() {
      return {
        id,
        sessionId,
        durationMs: Date.now() - startedAt,
        eventCount: events.length,
        events: events.slice(-50)
      }
    },
    end(summary) {
      const out: TraceSummary = {
        id,
        sessionId,
        durationMs: Date.now() - startedAt,
        eventCount: events.length,
        events,
        summary
      }
      if (shouldLog()) {
        try {
          logger.debug('agent.trace', `[${id}] end (${out.durationMs}ms, ${events.length} ev) ${JSON.stringify(summary || {})}`)
        } catch {
          /* idem */
        }
      }
      return out
    }
  }
  trace.emit('turn:start', { sessionId })
  return trace
}

/** Trace "vazio" para callers que não querem rastreio (todos os métodos no-op). */
const NULL_TRACE: TurnTrace = {
  id: 'noop',
  sessionId: '',
  startedAt: 0,
  events: [],
  emit() {},
  preview() { return { id: 'noop', sessionId: '', durationMs: 0, eventCount: 0, events: [] } },
  end() { return { id: 'noop', sessionId: '', durationMs: 0, eventCount: 0, events: [] } }
}
export function nullTrace(): TurnTrace {
  return NULL_TRACE
}
