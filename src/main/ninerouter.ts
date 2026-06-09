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

/**
 * Chamada não-streaming ao 9 Router que retorna o conteúdo do assistente.
 * Tenta pedir resposta em JSON (response_format); se o upstream recusar, repete sem.
 */
export async function chatJSON(cfg: AppConfig, messages: ChatMessage[], wantJson = true): Promise<string> {
  const url = cfg.nineRouter.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.nineRouter.apiKey) headers['Authorization'] = `Bearer ${cfg.nineRouter.apiKey}`

  const call = async (useJson: boolean, withReasoning: boolean): Promise<Response> => {
    const body = buildChatBody(cfg, messages, { stream: false, json: useJson, withReasoning })
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  }

  let res: Response
  try {
    res = await call(wantJson, true)
    // Fallbacks de compatibilidade: 1) sem reasoning_effort, 2) sem response_format.
    if (!res.ok) res = await call(wantJson, false)
    if (!res.ok && wantJson) res = await call(false, false)
  } catch (err: any) {
    throw new Error(
      `Não consegui falar com o cérebro em ${cfg.nineRouter.baseUrl}. ` +
        `Verifique a conexão/credenciais. Detalhe: ${err?.message || err}`
    )
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`O provedor respondeu ${res.status}. ${txt.slice(0, 300)}`)
  }
  const json = (await res.json()) as any
  return json?.choices?.[0]?.message?.content ?? ''
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

  const open = (withReasoning: boolean): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildChatBody(cfg, messages, { stream: true, withReasoning })),
      signal
    })

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

  while (true) {
    const { done, value } = await reader.read()
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
