import { describe, expect, it } from 'vitest'
import { PROVIDERS, detectProviderId, getProvider, providerSupportsReasoning } from '../src/shared/providers'

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
  })

  it('retorna "custom" para URL desconhecida ou inválida', () => {
    expect(detectProviderId('https://exemplo.com/v1')).toBe('custom')
    expect(detectProviderId('')).toBe('custom')
    expect(detectProviderId('não-é-url')).toBe('custom')
  })

  it('limita DeepSeek aos modelos oficiais atuais', () => {
    const models = getProvider('deepseek')?.models?.map((m) => m.value)
    expect(getProvider('deepseek')?.defaultModel).toBe('deepseek-chat')
    expect(models).toEqual(['deepseek-chat', 'deepseek-reasoner'])
  })

  it('marca quais provedores suportam ajuste de raciocínio', () => {
    expect(providerSupportsReasoning('https://api.deepseek.com/v1')).toBe(true)
    expect(providerSupportsReasoning('https://exemplo.com/v1')).toBe(true)
  })
})
