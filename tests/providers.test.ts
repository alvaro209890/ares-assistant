import { describe, expect, it } from 'vitest'
import { PROVIDERS, detectProviderId, getProvider } from '../src/shared/providers'

describe('provedores de IA (cérebro)', () => {
  it('todo preset fala o protocolo OpenAI (/v1) e tem modelo padrão', () => {
    for (const p of PROVIDERS) {
      expect(p.baseUrl).toMatch(/^https?:\/\//)
      expect(p.defaultModel.length).toBeGreaterThan(0)
      expect(p.keyPlaceholder.length).toBeGreaterThan(0)
    }
  })

  it('detecta o provedor pelo host do baseUrl', () => {
    expect(detectProviderId('https://api.deepseek.com/v1')).toBe('deepseek')
    expect(detectProviderId('https://api.groq.com/openai/v1')).toBe('groq')
    expect(detectProviderId('https://openrouter.ai/api/v1')).toBe('openrouter')
    expect(detectProviderId('https://api.openai.com/v1')).toBe('openai')
    expect(detectProviderId('http://localhost:20128/v1')).toBe('local')
  })

  it('ignora barra final e maiúsculas ao detectar', () => {
    expect(detectProviderId('https://API.DeepSeek.com/v1/')).toBe('deepseek')
  })

  it('retorna "custom" para URL desconhecida ou inválida', () => {
    expect(detectProviderId('https://exemplo.com/v1')).toBe('custom')
    expect(detectProviderId('')).toBe('custom')
    expect(detectProviderId('não-é-url')).toBe('custom')
  })

  it('só o OpenRouter oferece login OAuth; o local não exige chave', () => {
    expect(getProvider('openrouter')?.oauth).toBe('openrouter')
    expect(getProvider('deepseek')?.oauth).toBeUndefined()
    expect(getProvider('local')?.needsKey).toBe(false)
    expect(getProvider('deepseek')?.needsKey).toBe(true)
  })
})
