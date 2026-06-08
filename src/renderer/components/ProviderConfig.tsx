import { useEffect, useMemo, useState } from 'react'
import { useAres } from '../lib/store'
import { PROVIDERS, detectProviderId, getProvider } from '../../shared/providers'

// Seletor de provedor do "cérebro" (LLM) reutilizado no onboarding e nas
// Configurações. Troca baseUrl/modelo/chave por presets, faz login OAuth do
// OpenRouter e testa a conexão. Toda a config vive em config.nineRouter.
export default function ProviderConfig({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const { config, saveConfig, testBrain, connectOpenRouter } = useAres()
  const [test, setTest] = useState('')
  const [busy, setBusy] = useState(false)
  const [advanced, setAdvanced] = useState(false)

  const currentId = useMemo(
    () => (config ? detectProviderId(config.nineRouter.baseUrl) : 'local'),
    [config?.nineRouter.baseUrl]
  )
  const preset = getProvider(currentId)
  const nr = config?.nineRouter
  const modelOptions = preset?.models || []

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
    // Ao trocar de provedor, não reaproveita a chave do anterior.
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
      <label className="block text-sm text-cyan-100/80">
        <span className="mb-1 block text-[12px] text-cyan-200/60">Provedor</span>
        <select className="input" value={currentId} onChange={(e) => pickProvider(e.target.value)}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {currentId === 'custom' && <option value="custom">Personalizado</option>}
        </select>
      </label>

      {preset && <p className="-mt-1 text-[11px] text-cyan-200/45">{preset.hint}</p>}

      {preset?.oauth === 'openrouter' && (
        <button onClick={doOAuth} disabled={busy} className="btn-ghost justify-center disabled:opacity-50">
          ENTRAR COM OPENROUTER
        </button>
      )}

      {(preset?.needsKey ?? true) && (
        <label className="block text-sm text-cyan-100/80">
          <span className="mb-1 flex items-center justify-between text-[12px] text-cyan-200/60">
            Chave de API
            {preset?.keyUrl && (
              <button
                onClick={() => void window.ares.system.openExternal(preset.keyUrl as string)}
                className="text-cyan-300/70 hover:text-cyan-100"
              >
                pegar chave →
              </button>
            )}
          </span>
          <input
            className="input"
            type="password"
            placeholder={preset?.keyPlaceholder || 'sk-...'}
            value={nr.apiKey}
            onChange={(e) => saveConfig({ nineRouter: { ...nr, apiKey: e.target.value } })}
          />
        </label>
      )}

      <label className="block text-sm text-cyan-100/80">
        <span className="mb-1 block text-[12px] text-cyan-200/60">Modelo</span>
        {modelOptions.length ? (
          <select
            className="input"
            value={modelOptions.some((m) => m.value === nr.model) ? nr.model : preset?.defaultModel}
            onChange={(e) => saveConfig({ nineRouter: { ...nr, model: e.target.value } })}
          >
            {modelOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
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
          <button onClick={() => setAdvanced((v) => !v)} className="text-[11px] text-cyan-300/60 hover:text-cyan-100">
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
