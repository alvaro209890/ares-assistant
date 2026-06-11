import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildChatBody, chatJSON } from '../src/main/ninerouter'
import type { AppConfig, ChatMessage, ReasoningLevel } from '../src/shared/types'

const cfgWith = (baseUrl: string, reasoning: ReasoningLevel = 'alto', model = 'm'): AppConfig =>
  ({ nineRouter: { baseUrl, model, apiKey: '', reasoning } }) as AppConfig

const msgs: ChatMessage[] = [{ role: 'user', content: 'oi' }]

describe('buildChatBody (reasoning_effort)', () => {
  it('inclui reasoning_effort para provedores que raciocinam (OpenRouter/DeepSeek/ChatGPT/Local)', () => {
    expect(buildChatBody(cfgWith('https://openrouter.ai/api/v1', 'alto'), msgs, { stream: false }).reasoning_effort).toBe('high')
    expect(buildChatBody(cfgWith('https://api.deepseek.com/v1', 'baixo'), msgs, { stream: false }).reasoning_effort).toBe('low')
    expect(buildChatBody(cfgWith('https://api.openai.com/v1', 'medio'), msgs, { stream: false }).reasoning_effort).toBe('medium')
    expect(buildChatBody(cfgWith('http://localhost:20128/v1', 'alto'), msgs, { stream: false }).reasoning_effort).toBe('high')
  })

  it('NÃO inclui reasoning_effort para o Groq (não suporta)', () => {
    const body = buildChatBody(cfgWith('https://api.groq.com/openai/v1'), msgs, { stream: false })
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('respeita withReasoning:false (fallback de compatibilidade)', () => {
    const body = buildChatBody(cfgWith('https://api.deepseek.com/v1'), msgs, { stream: false, withReasoning: false })
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('coage reasoning inválido para medium', () => {
    const cfg = cfgWith('https://api.openai.com/v1')
    ;(cfg.nineRouter as { reasoning: unknown }).reasoning = 'turbo'
    expect(buildChatBody(cfg, msgs, { stream: false }).reasoning_effort).toBe('medium')
  })

  it('adiciona response_format quando json=true e seta stream/temperature', () => {
    const j = buildChatBody(cfgWith('https://api.openai.com/v1'), msgs, { stream: false, json: true })
    expect(j.response_format).toEqual({ type: 'json_object' })
    expect(j.stream).toBe(false)
    const s = buildChatBody(cfgWith('https://api.openai.com/v1'), msgs, { stream: true })
    expect(s.stream).toBe(true)
    expect(s.response_format).toBeUndefined()
  })
})

describe('chatJSON retry transitório', () => {
  let realFetch: typeof globalThis.fetch
  beforeEach(() => {
    realFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  const okResp = (content: string): Response =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const errResp = (status: number, body = 'fail'): Response =>
    new Response(body, { status })

  it('retentativa após 503 transitório, terminando em sucesso', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(errResp(503))
      .mockResolvedValueOnce(okResp('pronto'))
    globalThis.fetch = fetchMock
    const out = await chatJSON(cfgWith('http://localhost:20128/v1'), msgs, false)
    expect(out).toBe('pronto')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('NÃO retenta 401 (auth não é transitório)', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(errResp(401, 'unauthorized'))
    globalThis.fetch = fetchMock
    await expect(chatJSON(cfgWith('http://localhost:20128/v1'), msgs, false)).rejects.toThrow(/401/)
    // 2 chamadas no máximo (sem reasoning fallback): a chamada inicial e a sem-reasoning de compat.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('desiste após esgotar tentativas em 5xx', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(errResp(502))
    globalThis.fetch = fetchMock
    await expect(chatJSON(cfgWith('http://localhost:20128/v1'), msgs, false)).rejects.toThrow(/502/)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3) // 1 + 2 retries
  })

  it('respeita aborto do usuário sem nova tentativa', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(errResp(503))
    globalThis.fetch = fetchMock
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(chatJSON(cfgWith('http://localhost:20128/v1'), msgs, false, { signal: ctrl.signal })).rejects.toThrow(/abort/i)
  })
})
