import { useMemo } from 'react'
import { useAres } from '../lib/store'
import { providerSupportsReasoning } from '../../shared/providers'
import { REASONING_LEVELS, REASONING_LABEL, REASONING_HINT, coerceReasoning } from '../../shared/reasoning'
import Select, { type SelectOption } from './Select'

const ICON: Record<string, string> = { baixo: '🌙', medio: '⚖️', alto: '🔥' }

// Seletor do nível de raciocínio do cérebro (reasoning_effort). Desabilita-se com
// um aviso quando o provedor/modelo atual não suporta raciocínio.
export default function ReasoningSelect({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const { config, saveConfig } = useAres()
  const nr = config?.nineRouter
  const supports = nr ? providerSupportsReasoning(nr.baseUrl) : false
  const level = coerceReasoning(nr?.reasoning)

  const options: SelectOption[] = useMemo(
    () =>
      REASONING_LEVELS.map((l) => ({
        value: l,
        label: REASONING_LABEL[l],
        icon: ICON[l],
        hint: compact ? undefined : REASONING_HINT[l]
      })),
    [compact]
  )

  if (!config || !nr) return null

  return (
    <div className="flex flex-col gap-1">
      {!compact && <span className="text-[12px] text-cyan-200/60">Nível de raciocínio</span>}
      <Select
        ariaLabel="Nível de raciocínio"
        value={level}
        disabled={!supports}
        onChange={(v) => saveConfig({ nineRouter: { ...nr, reasoning: v as typeof level } })}
        options={options}
      />
      {!compact && (
        <p className="text-[11px] text-cyan-200/45">
          {supports
            ? `Esforço de raciocínio do modelo — ${REASONING_HINT[level]}.`
            : 'O modelo atual não tem ajuste de raciocínio.'}
        </p>
      )}
    </div>
  )
}
