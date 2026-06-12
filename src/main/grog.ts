import type { AppConfig } from './config'

const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo'
const STT_MODEL_FALLBACKS = [DEFAULT_STT_MODEL, 'whisper-large-v3']
const FALLBACK_STATUSES = new Set([400, 404])

/**
 * Transcrição (fala -> texto) via Grog/Groq, endpoint compatível com OpenAI
 * (/audio/transcriptions) usando um modelo Whisper grátis. Recebe os bytes de
 * áudio capturados no renderer (geralmente audio/webm do MediaRecorder).
 */
export async function transcribe(
  cfg: AppConfig,
  audio: ArrayBuffer,
  mimeType = 'audio/webm'
): Promise<string> {
  const apiKey = cfg.grog.apiKey.trim()
  if (!apiKey) {
    throw new Error(
      'Sem chave da Grog configurada — não dá para transcrever. Você pode digitar a mensagem, ' +
        'ou colar uma chave Groq (gsk_...) no painel de Configurações.'
    )
  }

  const models = [
    cfg.grog.sttModel?.trim() || DEFAULT_STT_MODEL,
    ...STT_MODEL_FALLBACKS
  ].filter((model, idx, all) => model && all.indexOf(model) === idx)
  const url = (cfg.grog.baseUrl?.trim() || DEFAULT_GROQ_BASE_URL).replace(/\/$/, '') + '/audio/transcriptions'
  let lastError = ''

  for (const model of models) {
    const res = await callGroqStt(url, apiKey, model, audio, mimeType)
    if (res.ok) {
      const json = (await res.json()) as { text?: string }
      return (json.text || '').trim()
    }

    const txt = await res.text().catch(() => '')
    lastError = `Grog (STT) respondeu ${res.status}. ${txt.slice(0, 300)}`
    if (!FALLBACK_STATUSES.has(res.status)) break
  }

  throw new Error(lastError || 'Grog (STT) não retornou transcrição.')
}

async function callGroqStt(
  url: string,
  apiKey: string,
  model: string,
  audio: ArrayBuffer,
  mimeType: string
): Promise<Response> {
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm'
  const form = new FormData()
  form.append('file', new Blob([audio], { type: mimeType }), `fala.${ext}`)
  form.append('model', model)
  form.append('language', 'pt')
  form.append('response_format', 'json')

  try {
    return await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    })
  } catch (err: any) {
    throw new Error(`Falha ao contatar a Grog (STT): ${err?.message || err}`)
  }
}
