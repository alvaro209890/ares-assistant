import { useMemo } from 'react'
import { useAres } from '../lib/store'
import { PROVIDERS, detectProviderId, getProvider } from '../../shared/providers'
import Select, { type SelectOption } from './Select'
import ReasoningSelect from './ReasoningSelect'

const PROVIDER_ICON: Record<string, string> = {
  deepseek: '🧠',
  local: '💻'
}

// Troca rápida de provedor/modelo/raciocínio direto na tela principal (sobre a orbe).
// A configuração completa (chave/login/teste) fica na aba "Modelos de IA".
export default function ModelBar(): JSX.Element | null {
  const { config, saveConfig, navigate } = useAres()
  const nr = config?.nineRouter
  const currentId = nr ? detectProviderId(nr.baseUrl) : 'deepseek'
  const preset = getProvider(currentId)

  const providerOptions: SelectOption[] = useMemo(() => {
    const base = PROVIDERS.map((p) => ({ value: p.id, label: p.label, icon: PROVIDER_ICON[p.id] }))
    if (currentId === 'custom') base.push({ value: 'custom', label: 'Personalizado', icon: '🔧' })
    return base
  }, [currentId])

  if (!config || !nr) return null

  const pickProvider = (id: string): void => {
    const p = getProvider(id)
    if (!p) return
    const sameHost = id === currentId
    void saveConfig({
      nineRouter: { ...nr, baseUrl: p.baseUrl, model: p.defaultModel, apiKey: sameHost ? nr.apiKey : '' }
    })
  }

  const modelOptions = preset?.models || []

  return (
    <div className="pointer-events-auto flex flex-wrap items-end gap-2 rounded-xl border border-cyan-300/15 bg-black/30 px-2.5 py-2 backdrop-blur-md">
      <Field label="Provedor">
        <Select ariaLabel="Provedor de IA" value={currentId} onChange={pickProvider} options={providerOptions} />
      </Field>
      {modelOptions.length > 0 && (
        <Field label="Modelo">
          <Select
            ariaLabel="Modelo de IA"
            value={modelOptions.some((m) => m.value === nr.model) ? nr.model : preset?.defaultModel ?? ''}
            onChange={(v) => saveConfig({ nineRouter: { ...nr, model: v } })}
            options={modelOptions.map((m) => ({ value: m.value, label: m.label }))}
          />
        </Field>
      )}
      <Field label="Raciocínio">
        <ReasoningSelect compact />
      </Field>
      <button
        onClick={() => navigate('models')}
        className="mb-0.5 ml-auto rounded-lg border border-cyan-300/20 px-2 py-1.5 text-[11px] text-cyan-200/70 transition hover:border-cyan-300/45 hover:text-cyan-50"
        title="Configurar e conectar modelos"
      >
        configurar →
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="flex min-w-[120px] flex-col gap-1">
      <span className="px-0.5 text-[10px] uppercase tracking-wide text-cyan-300/45">{label}</span>
      {children}
    </label>
  )
}
