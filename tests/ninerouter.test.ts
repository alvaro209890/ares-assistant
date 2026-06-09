import { describe, expect, it } from 'vitest'
import { buildChatBody } from '../src/main/ninerouter'
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
