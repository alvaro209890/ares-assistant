import type { AppConfig } from './config'

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
  if (!cfg.grog.apiKey) {
    throw new Error(
      'Sem chave da Grog configurada — não dá para transcrever. Você pode digitar a mensagem, ' +
        'ou colar uma chave Groq (gsk_...) no painel de Configurações.'
    )
  }

  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm'
  const form = new FormData()
  form.append('file', new Blob([audio], { type: mimeType }), `fala.${ext}`)
  form.append('model', cfg.grog.sttModel)
  form.append('language', 'pt')
  form.append('response_format', 'json')

  const url = cfg.grog.baseUrl.replace(/\/$/, '') + '/audio/transcriptions'
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.grog.apiKey}` },
      body: form
    })
  } catch (err: any) {
    throw new Error(`Falha ao contatar a Grog (STT): ${err?.message || err}`)
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Grog (STT) respondeu ${res.status}. ${txt.slice(0, 300)}`)
  }
  const json = (await res.json()) as { text?: string }
  return (json.text || '').trim()
}
