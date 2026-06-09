import { useEffect, useMemo, useState } from 'react'
import { useAres } from '../lib/store'
import { PROVIDERS, detectProviderId, getProvider } from '../../shared/providers'
import Select, { type SelectOption } from './Select'

// Ícone e cor de borda por provedor (visual distinto sem dependências externas).
const PROVIDER_STYLE: Record<string, { icon: string; border: string; glow: string }> = {
  deepseek: { icon: '🧠', border: 'border-blue-400/45 hover:border-blue-300/70 focus:border-blue-300/80', glow: 'hover:shadow-[0_0_14px_rgba(96,165,250,0.16)] focus:shadow-[0_0_16px_rgba(96,165,250,0.22)]' },
  groq: { icon: '⚡', border: 'border-orange-400/45 hover:border-orange-300/70 focus:border-orange-300/80', glow: 'hover:shadow-[0_0_14px_rgba(251,146,60,0.16)] focus:shadow-[0_0_16px_rgba(251,146,60,0.22)]' },
  openrouter: { icon: '🔀', border: 'border-purple-400/45 hover:border-purple-300/70 focus:border-purple-300/80', glow: 'hover:shadow-[0_0_14px_rgba(192,132,252,0.16)] focus:shadow-[0_0_16px_rgba(192,132,252,0.22)]' },
  openai: { icon: '🤖', border: 'border-emerald-400/45 hover:border-emerald-300/70 focus:border-emerald-300/80', glow: 'hover:shadow-[0_0_14px_rgba(52,211,153,0.16)] focus:shadow-[0_0_16px_rgba(52,211,153,0.22)]' },
  local: { icon: '💻', border: 'border-cyan-300/40 hover:border-cyan-200/70 focus:border-cyan-200/80', glow: 'hover:shadow-[0_0_14px_rgba(56,225,255,0.14)] focus:shadow-[0_0_16px_rgba(56,225,255,0.2)]' }
}

const fallbackStyle = { icon: '🔧', border: 'border-cyan-300/40 hover:border-cyan-200/70 focus:border-cyan-200/80', glow: 'hover:shadow-[0_0_14px_rgba(56,225,255,0.14)] focus:shadow-[0_0_16px_rgba(56,225,255,0.2)]' }

// Seletor de provedor do "cérebro" (LLM) reutilizado no onboarding e nas
// Configurações. Troca baseUrl/modelo/chave por presets, faz login OAuth do
// OpenRouter e testa a conexão. Toda a config vive em config.nineRouter.
export default function ProviderConfig({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const { config, saveConfig, testBrain, connectOpenRouter } = useAres()
  const [test, setTest] = useState('')
  const [busy, setBusy] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const currentId = useMemo(
    () => (config ? detectProviderId(config.nineRouter.baseUrl) : 'local'),
    [config?.nineRouter.baseUrl]
  )
  const preset = getProvider(currentId)
  const nr = config?.nineRouter
  const modelOptions = preset?.models || []
  const style = PROVIDER_STYLE[currentId] || fallbackStyle

  const providerOptions: SelectOption[] = useMemo(() => {
    const base = PROVIDERS.map((p) => ({
      value: p.id,
      label: p.label,
      icon: (PROVIDER_STYLE[p.id] || fallbackStyle).icon
    }))
    if (currentId === 'custom') base.push({ value: 'custom', label: 'Personalizado', icon: '🔧' })
    return base
  }, [currentId])

  useEffect(() => {
    if (!nr) return
    if (!preset?.models?.length) return
    if (preset.models.some((m) => m.value === nr.model)) return
    void saveConfig({ nineRouter: { ...nr, model: preset.defaultModel } })
  }, [preset?.id, preset?.defaultModel, nr?.model])

  if (!config || !nr) return null

  const pickProvider = (id: string): void => {
    const p = getProvider(id)
    if (!p) return
    setTest('')
    setShowKey(false)
    const sameHost = id === currentId
    void saveConfig({
      nineRouter: { baseUrl: p.baseUrl, model: p.defaultModel, apiKey: sameHost ? nr.apiKey : '' }
    })
  }

  const runTest = async (): Promise<void> => {
    setBusy(true)
    setTest('testando…')
    try {
      const r = await testBrain()
      setTest(r.ok ? '✓ ' + r.detail : '✕ ' + r.detail)
    } finally {
      setBusy(false)
    }
  }

  const doOAuth = async (): Promise<void> => {
    setBusy(true)
    setTest('aguardando login no navegador…')
    try {
      const r = await connectOpenRouter()
      setTest(r.ok ? '✓ conectado ao OpenRouter' : '✕ ' + (r.error || 'falhou'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Seletor de provedor com icone e borda colorida. */}
      <label className="block text-sm text-cyan-100/80">
        <span className="mb-1 block text-[12px] text-cyan-200/60">Provedor</span>
        <Select
          ariaLabel="Provedor de IA"
          className={`transition-all duration-200 ${style.border} ${style.glow}`}
          value={currentId}
          onChange={pickProvider}
          options={providerOptions}
        />
      </label>

      {preset && <p className="-mt-1 text-[11px] text-cyan-200/45">{preset.hint}</p>}

      {preset?.oauth === 'openrouter' && (
        <button onClick={doOAuth} disabled={busy} className="btn-ghost justify-center disabled:opacity-50">
          ENTRAR COM OPENROUTER
        </button>
      )}

      {/* Chave de API com toggle de visibilidade */}
      {(preset?.needsKey ?? true) && (
        <label className="block text-sm text-cyan-100/80">
          <span className="mb-1 flex items-center justify-between text-[12px] text-cyan-200/60">
            <span>🔑 Chave de API</span>
            {preset?.keyUrl && (
              <button
                onClick={() => void window.ares.system.openExternal(preset.keyUrl as string)}
                className="text-cyan-300/70 hover:text-cyan-100 transition-colors"
              >
                pegar chave →
              </button>
            )}
          </span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-cyan-200/70">🔑</span>
            <input
              className="input pl-9 pr-10 transition-all duration-200 hover:border-cyan-200/50 hover:shadow-[0_0_12px_rgba(56,225,255,0.12)] focus:shadow-[0_0_14px_rgba(56,225,255,0.18)]"
              type={showKey ? 'text' : 'password'}
              placeholder={preset?.keyPlaceholder || 'sk-...'}
              value={nr.apiKey}
              onChange={(e) => saveConfig({ nineRouter: { ...nr, apiKey: e.target.value } })}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cyan-200/50 hover:text-cyan-100 transition-colors text-sm"
              title={showKey ? 'Ocultar chave' : 'Mostrar chave'}
            >
              {showKey ? '🙈' : '👁️'}
            </button>
          </div>
        </label>
      )}

      {/* Seletor de modelo com borda do provedor */}
      <label className="block text-sm text-cyan-100/80">
        <span className="mb-1 block text-[12px] text-cyan-200/60">Modelo</span>
        {modelOptions.length ? (
          <Select
            ariaLabel="Modelo"
            className={`transition-all duration-200 ${style.border} ${style.glow}`}
            value={modelOptions.some((m) => m.value === nr.model) ? nr.model : preset?.defaultModel ?? ''}
            onChange={(v) => saveConfig({ nineRouter: { ...nr, model: v } })}
            options={modelOptions.map((m) => ({ value: m.value, label: m.label }))}
          />
        ) : (
          <input
            className="input"
            value={nr.model}
            onChange={(e) => saveConfig({ nineRouter: { ...nr, model: e.target.value } })}
          />
        )}
      </label>

      {!compact && (
        <div>
          <button onClick={() => setAdvanced((v) => !v)} className="text-[11px] text-cyan-300/60 hover:text-cyan-100 transition-colors">
            {advanced ? 'ocultar avançado' : 'avançado (URL base)'}
          </button>
          {advanced && (
            <input
              className="input mt-2"
              value={nr.baseUrl}
              onChange={(e) => saveConfig({ nineRouter: { ...nr, baseUrl: e.target.value } })}
            />
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={runTest} disabled={busy} className="btn-ghost disabled:opacity-50">
          TESTAR CONEXÃO
        </button>
        {test && <span className="text-[11px] text-cyan-200/60">{test}</span>}
      </div>
    </div>
  )
}
