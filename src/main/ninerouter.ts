import type { AppConfig, ChatMessage } from '../shared/types'

export type { ChatMessage }

/**
 * Chamada não-streaming ao 9 Router que retorna o conteúdo do assistente.
 * Tenta pedir resposta em JSON (response_format); se o upstream recusar, repete sem.
 */
export async function chatJSON(cfg: AppConfig, messages: ChatMessage[], wantJson = true): Promise<string> {
  const url = cfg.nineRouter.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.nineRouter.apiKey) headers['Authorization'] = `Bearer ${cfg.nineRouter.apiKey}`

  const call = async (useJson: boolean): Promise<Response> => {
    const body: Record<string, unknown> = {
      model: cfg.nineRouter.model,
      messages,
      stream: false,
      temperature: 0.6
    }
    if (useJson) body.response_format = { type: 'json_object' }
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  }

  let res: Response
  try {
    res = await call(wantJson)
    if (!res.ok && wantJson) res = await call(false) // fallback sem response_format
  } catch (err: any) {
    throw new Error(
      `Não consegui falar com o cérebro (9 Router) em ${cfg.nineRouter.baseUrl}. ` +
        `Verifique se o serviço está rodando. Detalhe: ${err?.message || err}`
    )
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`9 Router respondeu ${res.status}. ${txt.slice(0, 300)}`)
  }
  const json = (await res.json()) as any
  return json?.choices?.[0]?.message?.content ?? ''
}

/**
 * Faz a chamada de chat completions ao 9 Router (compatível com OpenAI) em modo
 * streaming. Para cada pedaço de texto recebido chama onDelta(texto). Retorna o
 * texto completo ao final. Usa o fetch nativo do Node 18 (sem dependências).
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

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.nineRouter.model,
        messages,
        stream: true,
        temperature: 0.7
      }),
      signal
    })
  } catch (err: any) {
    throw new Error(
      `Não consegui falar com o cérebro (9 Router) em ${cfg.nineRouter.baseUrl}. ` +
        `Verifique se o serviço está rodando. Detalhe: ${err?.message || err}`
    )
  }

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '')
    throw new Error(`9 Router respondeu ${res.status}. ${txt.slice(0, 300)}`)
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
