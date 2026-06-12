// Streaming da fala do Ares + classificação de erro do provedor.
//
// Há dois eixos independentes que se cruzam no streamTurn:
//   1) O CANAL onDelta (texto bruto chega chunk a chunk; precisa decodificar
//      o campo "fala" do envelope JSON em construção em tempo real).
//   2) A POLÍTICA DE FALLBACK (stream caiu? algo já foi emitido? cair para
//      chatJSON ou finalizar com o que já existe?).
//
// classifyProviderError separa transitório vs estrutural — usada tanto aqui
// quanto pelo ninerouter para decidir retry. Mantida pura/testável.

import type { ChatMessage } from '../../shared/types'
import { parseEnvelope, extractFalaPrefix, validateAction } from '../../shared/protocol'
import type { Acao } from '../../shared/types'
import { chatJSON, streamChat } from '../ninerouter'
import type { AppConfig } from '../../shared/types'
import { stripRepeatedGreeting } from './prompt'
import type { DeltaFn, DeltaKind, DeltaTextTransform } from './types'

export type { DeltaFn, DeltaKind, DeltaTextTransform }

/** Saída final pós-streaming: a fala já normalizada para registro/aplicação. */
export function finalFala(text: string, suppressGreeting: boolean): string {
  const out = suppressGreeting ? stripRepeatedGreeting(text) : String(text || '')
  return out.trim()
}

/**
 * Remove ações EXATAMENTE duplicadas (mesmo JSON) na mesma rodada. O modelo às
 * vezes emite a mesma consulta/subagente duas vezes; rodar em dobro custa uma
 * chamada de LLM inteira (Colmeia) ou repete comandos sem ganho.
 */
export function dedupeActions(acoes: Acao[]): Acao[] {
  const seen = new Set<string>()
  return acoes.filter((a) => {
    const key = JSON.stringify(a)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Separa as ações válidas das inválidas, com notas para o usuário. */
export function validateActions(acoes: Acao[]): { valid: Acao[]; notes: string[] } {
  const valid: Acao[] = []
  const notes: string[] = []
  for (const a of acoes) {
    const v = validateAction(a)
    if (v.ok) valid.push(a)
    else notes.push(`ação ignorada (${v.error})`)
  }
  return { valid, notes }
}

/**
 * Classificação de erros do LLM/provedor. Permite ao caller decidir entre
 * retry, fallback, ou propagação. Pura — só lê a mensagem do erro.
 *
 *   - `abort`    : o usuário ou o caller abortou (não deve gerar retry/log de falha)
 *   - `timeout`  : o provedor parou de responder (transitório, mas pode ser retry caro)
 *   - `transient`: 5xx, falha de rede, fetch error (vale tentar de novo)
 *   - `auth`     : 401/403 ou credenciais (estrutural: trocar chave)
 *   - `rate`     : 429 (transitório com espera maior)
 *   - `bad_request`: 400 (estrutural: prompt/payload inválido)
 *   - `parse`    : envelope não pôde ser interpretado
 *   - `unknown`  : qualquer outra coisa
 */
export type ProviderErrorKind =
  | 'abort'
  | 'timeout'
  | 'transient'
  | 'auth'
  | 'rate'
  | 'bad_request'
  | 'parse'
  | 'unknown'

export interface ClassifiedError {
  kind: ProviderErrorKind
  retryable: boolean
  status?: number
  message: string
}

export function classifyProviderError(e: unknown): ClassifiedError {
  const message = e instanceof Error ? e.message : String(e || '')
  const lower = message.toLowerCase()
  const name = (e as { name?: string })?.name || ''
  if (name === 'AbortError' || /abort/i.test(message)) {
    return { kind: 'abort', retryable: false, message }
  }
  // O streamChat lança "parou de responder por Ns" no timeout interno.
  if (/parou de responder|timed?[\s-]?out|timeout/i.test(lower)) {
    return { kind: 'timeout', retryable: true, message }
  }
  // Mensagem padrão do ninerouter: "O provedor respondeu <status>. ..."
  const statusMatch = message.match(/respondeu\s+(\d{3})/i)
  const status = statusMatch ? Number(statusMatch[1]) : undefined
  if (status) {
    if (status === 401 || status === 403) return { kind: 'auth', retryable: false, status, message }
    if (status === 400 || status === 404 || status === 422) return { kind: 'bad_request', retryable: false, status, message }
    if (status === 429) return { kind: 'rate', retryable: true, status, message }
    if (status >= 500) return { kind: 'transient', retryable: true, status, message }
  }
  if (/n[aã]o consegui falar com o c[eé]rebro|fetch|network|enotfound|econnreset|etimedout/i.test(lower)) {
    return { kind: 'transient', retryable: true, message }
  }
  if (/json|envelope|parse|unexpected token/i.test(lower)) {
    return { kind: 'parse', retryable: false, message }
  }
  return { kind: 'unknown', retryable: false, message }
}

/**
 * Faz uma chamada do agente transmitindo a "fala" em tempo real (streaming) via
 * onDelta. Sem consumidor de streaming, cai na chamada JSON robusta. Em falha de
 * stream sem nada emitido, faz fallback para chatJSON; se já emitiu algo, finaliza
 * com o texto parcial em vez de deixar o turno pendente na UI.
 */
export async function streamTurn(
  cfg: AppConfig,
  messages: ChatMessage[],
  phase: number,
  onDelta?: DeltaFn,
  kind: DeltaKind = 'both',
  transform?: DeltaTextTransform,
  signal?: AbortSignal
): Promise<string> {
  if (!onDelta) return chatJSON(cfg, messages, true, { signal })
  let cumulative = ''
  let emitted = 0
  let lastText = ''
  const pump = (full: string): void => {
    const { text } = extractFalaPrefix(full)
    const rawOut = transform ? transform(text, phase, kind) : text
    const out = rawOut.length >= lastText.length ? rawOut : lastText
    lastText = out
    if (out.length > emitted) {
      onDelta(out.slice(emitted), phase, kind)
      emitted = out.length
    }
  }
  try {
    const full = await streamChat(cfg, messages, (delta) => {
      cumulative += delta
      pump(cumulative)
    }, signal)
    pump(full)
    if (emitted === 0) {
      const env = parseEnvelope(full)
      if (env.fala) onDelta(transform ? transform(env.fala, phase, kind) : env.fala, phase, kind)
    }
    onDelta('', phase, kind, true)
    return full
  } catch (e) {
    const cls = classifyProviderError(e)
    // Abort do usuário não vale fallback: respeita o cancelamento.
    if (cls.kind === 'abort') throw e
    // Se algo já saiu para a UI, prefere finalizar com o parcial: a alternativa
    // (cair para chatJSON) duplicaria a fala no chat.
    if (emitted > 0) {
      onDelta('', phase, kind, true)
      return JSON.stringify({ fala: lastText, acoes: [] })
    }
    // Stream falhou sem emitir nada: tenta a rota não-streaming uma vez.
    const full = await chatJSON(cfg, messages, true, { signal })
    const env = parseEnvelope(full)
    if (env.fala) onDelta(transform ? transform(env.fala, phase, kind) : env.fala, phase, kind)
    onDelta('', phase, kind, true)
    return full
  }
}
