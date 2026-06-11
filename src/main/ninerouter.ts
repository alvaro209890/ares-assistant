import type { AppConfig, ChatMessage } from '../shared/types'
import { providerSupportsReasoning } from '../shared/providers'
import { reasoningEffort as toEffort, coerceReasoning } from '../shared/reasoning'

export type { ChatMessage }

interface BodyOpts {
  stream: boolean
  json?: boolean
  withReasoning?: boolean // false = repete sem reasoning_effort (fallback de compatibilidade)
  temperature?: number
}

/**
 * Monta o corpo da chamada /chat/completions. Inclui reasoning_effort (low/medium/high)
 * quando o provedor suporta raciocínio e withReasoning != false. Pura e testável.
 */
export function buildChatBody(cfg: AppConfig, messages: ChatMessage[], opts: BodyOpts): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.nineRouter.model,
    messages,
    stream: opts.stream,
    temperature: opts.temperature ?? (opts.stream ? 0.7 : 0.6)
  }
  if (opts.json) body.response_format = { type: 'json_object' }
  const wantReasoning = opts.withReasoning !== false && providerSupportsReasoning(cfg.nineRouter.baseUrl)
  if (wantReasoning) body.reasoning_effort = toEffort(coerceReasoning(cfg.nineRouter.reasoning))
  return body
}

// Quanto tempo esperar entre tentativas em falha TRANSITÓRIA. Pequeno o suficiente
// para não atrasar a UX, mas evita que uma flap de rede mate o turno todo.
const TRANSIENT_RETRY_DELAYS_MS = [300, 900]
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(), ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('abort')) })
  })
}

/**
 * Chamada não-streaming ao 9 Router que retorna o conteúdo do assistente.
 * Política em camadas:
 *   1) Tenta com response_format JSON + reasoning_effort quando suportado.
 *   2) Se a resposta vier 4xx que não seja 408/425/429, repete sem reasoning_effort
 *      (compat com provedores que recusam o campo).
 *   3) Se ainda for ruim e wantJson=true, repete sem response_format.
 *   4) Em status TRANSITÓRIO (408/425/429/5xx) ou erro de rede, faz retry com
 *      backoff (TRANSIENT_RETRY_DELAYS_MS), no máximo 2 tentativas adicionais.
 *      AbortSignal interrompe o retry imediatamente.
 * Em sucesso, lê o content do assistente. Em falha definitiva, lança Error com
 * mensagem padronizada que o classifyProviderError consegue parsear.
 */
export async function chatJSON(
  cfg: AppConfig,
  messages: ChatMessage[],
  wantJson = true,
  opts: { temperature?: number; signal?: AbortSignal } = {}
): Promise<string> {
  const url = cfg.nineRouter.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.nineRouter.apiKey) headers['Authorization'] = `Bearer ${cfg.nineRouter.apiKey}`

  const call = async (useJson: boolean, withReasoning: boolean): Promise<Response> => {
    const body = buildChatBody(cfg, messages, { stream: false, json: useJson, withReasoning, temperature: opts.temperature })
    const signals = [AbortSignal.timeout(90_000)]
    if (opts.signal) signals.push(opts.signal)
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.any(signals) })
  }

  // Tentativa única. Só desce pros fallbacks de compat (sem reasoning_effort,
  // depois sem response_format) quando o status sugere recusa do CAMPO — 400/422.
  // Outros 4xx (auth/not found) ou 5xx caem direto para a camada de retry externa.
  const isCompatFallback = (status: number): boolean => status === 400 || status === 422
  const tryOnce = async (): Promise<Response> => {
    let res = await call(wantJson, true)
    if (!res.ok && isCompatFallback(res.status)) res = await call(wantJson, false)
    if (!res.ok && wantJson && isCompatFallback(res.status)) res = await call(false, false)
    return res
  }

  const maxAttempts = 1 + TRANSIENT_RETRY_DELAYS_MS.length
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts.signal?.aborted) throw new Error('abort')
    let res: Response | null = null
    try {
      res = await tryOnce()
    } catch (err: any) {
      if (err?.name === 'AbortError' || /abort/i.test(String(err?.message || ''))) {
        throw err instanceof Error ? err : new Error(String(err))
      }
      lastError = err
      // Falha de rede (sem status): vale tentar de novo até esgotar.
      if (attempt === maxAttempts - 1) {
        throw new Error(
          `Não consegui falar com o cérebro em ${cfg.nineRouter.baseUrl}. ` +
            `Verifique a conexão/credenciais. Detalhe: ${err?.message || err}`
        )
      }
      const delay = TRANSIENT_RETRY_DELAYS_MS[attempt]
      if (delay) {
        try { await sleep(delay, opts.signal) } catch { throw new Error('abort') }
      }
      continue
    }
    if (res.ok) {
      const json = (await res.json()) as any
      return json?.choices?.[0]?.message?.content ?? ''
    }
    // Falha de status: erro padronizado para o classifyProviderError ler depois.
    const txt = await res.text().catch(() => '')
    const err = new Error(`O provedor respondeu ${res.status}. ${txt.slice(0, 300)}`)
    lastError = err
    // 4xx que não seja transitório (auth/notfound/...): lança imediatamente.
    if (!TRANSIENT_STATUSES.has(res.status) || attempt === maxAttempts - 1) throw err
    // 5xx/transitório: espera e retenta.
    const delay = TRANSIENT_RETRY_DELAYS_MS[attempt]
    if (delay) {
      try { await sleep(delay, opts.signal) } catch { throw new Error('abort') }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'falha desconhecida'))
}

/**
 * Faz a chamada de chat completions ao provedor (compatível com OpenAI) em modo
 * streaming. Para cada pedaço de texto recebido chama onDelta(texto). Retorna o
 * texto completo ao final. Usa o fetch nativo do Node (sem dependências).
 */
export async function streamChat(
  cfg: AppConfig,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const url = cfg.nineRouter.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Em localhost o 9 Router não exige chave; só mandamos o header se existir.
  if (cfg.nineRouter.apiKey) headers['Authorization'] = `Bearer ${cfg.nineRouter.apiKey}`

  const open = (withReasoning: boolean): Promise<Response> => {
    const signals = [AbortSignal.timeout(90_000)]
    if (signal) signals.push(signal)
    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildChatBody(cfg, messages, { stream: true, withReasoning })),
      signal: AbortSignal.any(signals)
    })
  }

  let res: Response
  try {
    res = await open(true)
    // Se o provedor recusar reasoning_effort, repete uma vez sem ele.
    if (!res.ok) res = await open(false)
  } catch (err: any) {
    throw new Error(
      `Não consegui falar com o cérebro em ${cfg.nineRouter.baseUrl}. ` +
        `Verifique a conexão/credenciais. Detalhe: ${err?.message || err}`
    )
  }

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '')
    throw new Error(`O provedor respondeu ${res.status}. ${txt.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  /** Lê o próximo chunk com timeout — evita travar se o provedor parar de mandar dados. */
  const readWithTimeout = (ms = 60_000): Promise<ReadableStreamReadResult<Uint8Array>> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reader.cancel().catch(() => {})
        reject(new Error(`O provedor parou de responder por ${ms / 1000}s durante o streaming.`))
      }, ms)
      reader.read().then(
        (result) => { clearTimeout(timer); resolve(result) },
        (err) => { clearTimeout(timer); reject(err) }
      )
    })
  }

  while (true) {
    const { done, value } = await readWithTimeout()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Eventos SSE são separados por linha; cada um começa com "data: ".
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return full
      try {
        const json = JSON.parse(payload)
        const delta: string = json?.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          full += delta
          onDelta(delta)
        }
      } catch {
        /* linha parcial/keepalive: ignora */
      }
    }
  }
  return full
}
