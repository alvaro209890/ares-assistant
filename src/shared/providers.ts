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
  /** Provedor que oferece login OAuth (recebe a chave automaticamente). */
  oauth?: 'openrouter'
  /** Texto curto de ajuda mostrado abaixo do seletor. */
  hint: string
  /** Onde o usuário pega a chave (aberto no navegador). */
  keyUrl?: string
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-flash',
    models: [
      { label: 'DeepSeek V4 Flash', value: 'deepseek-v4-flash' },
      { label: 'DeepSeek V4 Pro', value: 'deepseek-v4-pro' }
    ],
    needsKey: true,
    keyPlaceholder: 'sk-...',
    hint: 'Modelos V4 atuais da API oficial: V4 Flash para velocidade e V4 Pro para raciocínio mais forte.',
    keyUrl: 'https://platform.deepseek.com/api_keys'
  },
  {
    id: 'groq',
    label: 'Groq (grátis)',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    needsKey: true,
    keyPlaceholder: 'gsk_...',
    hint: 'Rápido e gratuito. A mesma chave gsk_... também serve para a transcrição de voz.',
    keyUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (login)',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    needsKey: true,
    keyPlaceholder: 'sk-or-...',
    oauth: 'openrouter',
    hint: 'Faça login e o Ares recebe a chave sozinho. Acesso a vários modelos (alguns grátis).',
    keyUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    needsKey: true,
    keyPlaceholder: 'sk-...',
    hint: 'GPT-4o / GPT-4o-mini. Requer chave paga sk-... da plataforma OpenAI.',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'local',
    label: 'Local (9 Router)',
    baseUrl: 'http://localhost:20128/v1',
    defaultModel: 'cx/gpt-5.5',
    needsKey: false,
    keyPlaceholder: 'vazio para localhost',
    hint: 'Usa um servidor de IA rodando neste computador (não precisa de chave).'
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
  return PROVIDERS.find((p) => p.id === id)
}
