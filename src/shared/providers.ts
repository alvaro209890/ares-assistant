// Presets de provedores do "cérebro" (LLM). Todos falam o protocolo OpenAI
// (/chat/completions), então mudar de provedor é só trocar baseUrl + modelo +
// chave. Compartilhado entre o onboarding e as Configurações.

export interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  models?: Array<{ label: string; value: string }>
  needsKey: boolean
  keyPlaceholder: string
  /** Modelos deste provedor suportam ajuste de raciocínio (reasoning_effort). */
  supportsReasoning?: boolean
  /** Onde o usuário pega a chave (aberto no navegador). */
  keyUrl?: string
  /** Texto curto de ajuda mostrado abaixo do seletor. */
  hint: string
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: [
      { label: 'DeepSeek Chat (V3)', value: 'deepseek-chat' },
      { label: 'DeepSeek Reasoner (R1)', value: 'deepseek-reasoner' }
    ],
    needsKey: true,
    keyPlaceholder: 'sk-...',
    supportsReasoning: true,
    hint: 'Ares usa DeepSeek como seu cérebro de IA. Insira sua chave API oficial da DeepSeek.',
    keyUrl: 'https://platform.deepseek.com/api_keys'
  }
]

const host = (url: string): string => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

/** Descobre o preset atual a partir do baseUrl salvo (para selecionar no menu). */
export function detectProviderId(baseUrl: string): string {
  const h = host(baseUrl)
  if (!h) return 'custom'
  const match = PROVIDERS.find((p) => host(p.baseUrl) === h)
  return match ? match.id : 'custom'
}

export function getProvider(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0]
}

/**
 * O provedor apontado por baseUrl suporta ajuste de raciocínio? Usado para decidir
 * se enviamos reasoning_effort na chamada (evita 400 em provedores que não aceitam).
 * Provedores personalizados (custom) recebem o campo — o fallback de retry cobre rejeições.
 */
export function providerSupportsReasoning(baseUrl: string): boolean {
  const h = baseUrl.toLowerCase()
  // Groq não suporta reasoning_effort e responde 400.
  if (h.includes('groq.com')) return false
  return true
}
