import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transcribe } from '../src/main/grog'
import type { AppConfig } from '../src/shared/types'

const cfgWithKey = (key: string): AppConfig =>
  ({ grog: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: key, sttModel: 'whisper-large-v3-turbo' } }) as AppConfig

describe('transcribe — Speech to Text via Grog/Groq', () => {
  let realFetch: typeof globalThis.fetch

  beforeEach(() => {
    realFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('exige chave de API configurada', async () => {
    const cfg = cfgWithKey('')
    const audio = new ArrayBuffer(10)
    await expect(transcribe(cfg, audio)).rejects.toThrow('Sem chave da Grog configurada')
  })

  it('retorna texto transcrito em caso de sucesso', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ text: 'Olá Ares' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    globalThis.fetch = fetchMock

    const cfg = cfgWithKey('test_key')
    const audio = new ArrayBuffer(20)
    const result = await transcribe(cfg, audio, 'audio/webm')

    expect(result).toBe('Olá Ares')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer test_key')
  })

  it('usa defaults internos quando URL/modelo vierem vazios', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ text: 'comando local' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    globalThis.fetch = fetchMock

    const cfg = ({ grog: { baseUrl: '', apiKey: '  test_key  ', sttModel: '' } }) as AppConfig
    const result = await transcribe(cfg, new ArrayBuffer(20), 'audio/webm')

    expect(result).toBe('comando local')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer test_key')
    expect((init?.body as FormData).get('model')).toBe('whisper-large-v3-turbo')
  })

  it('tenta modelo Whisper reserva quando o configurado é recusado', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('model not found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: 'fallback ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    globalThis.fetch = fetchMock

    const cfg = ({ grog: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'test_key', sttModel: 'modelo-antigo' } }) as AppConfig
    const result = await transcribe(cfg, new ArrayBuffer(20), 'audio/webm')

    expect(result).toBe('fallback ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[0][1]?.body as FormData).get('model')).toBe('modelo-antigo')
    expect((fetchMock.mock.calls[1][1]?.body as FormData).get('model')).toBe('whisper-large-v3-turbo')
  })

  it('trata erros de resposta HTTP HTTP != 200', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response('Error processing request', { status: 400 })
    )
    globalThis.fetch = fetchMock

    const cfg = cfgWithKey('test_key')
    const audio = new ArrayBuffer(20)
    await expect(transcribe(cfg, audio)).rejects.toThrow(/Grog \(STT\) respondeu 400/)
  })

  it('trata falhas de rede no fetch', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Network Fail'))
    globalThis.fetch = fetchMock

    const cfg = cfgWithKey('test_key')
    const audio = new ArrayBuffer(20)
    await expect(transcribe(cfg, audio)).rejects.toThrow(/Falha ao contatar a Grog \(STT\)/)
  })
})
