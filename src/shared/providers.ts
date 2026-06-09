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
  /** Provedor que oferece login OAuth (recebe a chave automaticamente). */
  oauth?: 'openrouter'
  /** Texto curto de ajuda mostrado abaixo do seletor. */
  hint: string
  /** Onde o usuário pega a chave (aberto no navegador). */
  keyUrl?: string
}

export const PROVIDERS: ProviderPreset[] = [
  {
    // Caminho recomendado: login OAuth (o mesmo usado nos instaladores) — uma conta
    // dá acesso a GPT-5.5 e DeepSeek V4 sem colar chave. Os slugs são os do OpenRouter.
    id: 'openrouter',
    label: 'OpenRouter (login)',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-5.5',
    models: [
      { label: 'GPT-5.5', value: 'openai/gpt-5.5' },
      { label: 'DeepSeek V4 Flash', value: 'deepseek/deepseek-v4-flash' },
      { label: 'DeepSeek V4 Pro', value: 'deepseek/deepseek-v4-pro' }
    ],
    needsKey: true,
    keyPlaceholder: 'sk-or-...',
    supportsReasoning: true,
    oauth: 'openrouter',
    hint: 'Faça login e o Ares recebe a chave sozinho. Acesso a GPT-5.5 e DeepSeek V4, com raciocínio ajustável.',
    keyUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek (chave própria)',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-flash',
    models: [
      { label: 'DeepSeek V4 Flash', value: 'deepseek-v4-flash' },
      { label: 'DeepSeek V4 Pro', value: 'deepseek-v4-pro' }
    ],
    needsKey: true,
    keyPlaceholder: 'sk-...',
    supportsReasoning: true,
    hint: 'API oficial da DeepSeek com chave própria: V4 Flash para velocidade e V4 Pro para raciocínio mais forte.',
    keyUrl: 'https://platform.deepseek.com/api_keys'
  },
  {
    id: 'openai',
    label: 'ChatGPT (chave própria)',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.5',
    models: [{ label: 'GPT-5.5', value: 'gpt-5.5' }],
    needsKey: true,
    keyPlaceholder: 'sk-...',
    supportsReasoning: true,
    hint: 'ChatGPT GPT-5.5 com raciocínio ajustável. Requer chave sk-... da plataforma OpenAI.',
    keyUrl: 'https://platform.openai.com/api-keys'
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
    // Avançado/auto-hospedado. Não é mais o padrão do Ares.
    id: 'local',
    label: 'Local (avançado)',
    baseUrl: 'http://localhost:20128/v1',
    defaultModel: 'cx/gpt-5.5',
    models: [{ label: 'GPT-5.5 (local)', value: 'cx/gpt-5.5' }],
    needsKey: false,
    keyPlaceholder: 'vazio para localhost',
    supportsReasoning: true,
    hint: 'Servidor de IA rodando neste computador (GPT-5.5, sem chave). Opção avançada/auto-hospedada.'
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

/**
 * O provedor apontado por baseUrl suporta ajuste de raciocínio? Usado para decidir
 * se enviamos reasoning_effort na chamada (evita 400 em provedores que não aceitam).
 * Provedores personalizados (custom) recebem o campo — o fallback de retry cobre rejeições.
 */
export function providerSupportsReasoning(baseUrl: string): boolean {
  const id = detectProviderId(baseUrl)
  if (id === 'custom') return true
  return !!getProvider(id)?.supportsReasoning
}
