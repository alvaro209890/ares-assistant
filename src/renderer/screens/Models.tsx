import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAres } from '../lib/store'
import { detectProviderId, getProvider, providerSupportsReasoning } from '../../shared/providers'
import { REASONING_LEVELS, REASONING_LABEL, coerceReasoning } from '../../shared/reasoning'
import type { ReasoningLevel } from '../../shared/types'
import ProviderConfig from '../components/ProviderConfig'
import ReasoningSelect from '../components/ReasoningSelect'

interface LevelResult {
  ok: boolean
  ms: number
  detail: string
}

export default function Models(): JSX.Element {
  const { config } = useAres()
  const nr = config?.nineRouter
  const supports = nr ? providerSupportsReasoning(nr.baseUrl) : false
  const preset = nr ? getProvider(detectProviderId(nr.baseUrl)) : undefined
  const [results, setResults] = useState<Partial<Record<ReasoningLevel, LevelResult>>>({})
  const [testing, setTesting] = useState(false)

  const testAll = async (): Promise<void> => {
    setTesting(true)
    setResults({})
    try {
      for (const level of REASONING_LEVELS) {
        setResults((r) => ({ ...r, [level]: { ok: false, ms: 0, detail: 'testando…' } }))
        // eslint-disable-next-line no-await-in-loop
        const r = await window.ares.system.testReasoning(level)
        setResults((prev) => ({ ...prev, [level]: { ok: r.ok, ms: r.ms, detail: r.detail } }))
      }
    } finally {
      setTesting(false)
    }
  }

  return (
    <motion.div
      key="models"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="flex h-full min-h-[680px] flex-col p-5"
    >
      <div className="mb-4">
        <h2 className="font-display text-sm title-track text-cyan-300/60">MODELOS DE IA · CONEXÃO</h2>
        <p className="mt-1 text-xs text-cyan-200/40">
          Escolha o provedor e o modelo do cérebro do Ares, conecte (login OAuth ou chave) e ajuste o nível de
          raciocínio. Também é possível trocar por voz: “use o DeepSeek Pro”, “diminua seu raciocínio”.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="PROVEDOR E MODELO">
            <ProviderConfig />
          </Panel>

          <div className="flex flex-col gap-4">
            <Panel title="NÍVEL DE RACIOCÍNIO">
              <ReasoningSelect />
            </Panel>

            <Panel title="TESTAR NÍVEIS DE RACIOCÍNIO">
              {!supports ? (
                <p className="text-[12px] text-cyan-200/45">
                  O modelo atual ({preset?.label || 'personalizado'}) não tem ajuste de raciocínio. Selecione DeepSeek,
                  ChatGPT (GPT-5.5) ou OpenRouter para testar.
                </p>
              ) : (
                <>
                  <p className="text-[12px] text-cyan-200/45">
                    Faz uma chamada mínima ao modelo atual em cada nível e mede a latência. Requer conexão ativa
                    (login/chave).
                  </p>
                  <button onClick={() => void testAll()} disabled={testing} className="btn-ghost disabled:opacity-50">
                    {testing ? 'TESTANDO…' : 'TESTAR TODOS OS NÍVEIS'}
                  </button>
                  <div className="mt-1 grid gap-1.5">
                    {REASONING_LEVELS.map((l) => {
                      const r = results[l]
                      return (
                        <div
                          key={l}
                          className="flex items-center justify-between rounded-lg border border-cyan-300/12 bg-black/25 px-3 py-1.5 text-[12px]"
                        >
                          <span className="text-cyan-100/80">{REASONING_LABEL[l]}</span>
                          <span
                            className={
                              !r
                                ? 'text-cyan-200/35'
                                : r.detail === 'testando…'
                                  ? 'text-cyan-200/60'
                                  : r.ok
                                    ? 'text-emerald-300/85'
                                    : 'text-red-300/85'
                            }
                          >
                            {r ? `${r.ok ? '✓' : '✕'} ${r.detail}` : '—'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </Panel>

            <Panel title="MODELO ATIVO">
              <Row k="Provedor" v={preset?.label || 'personalizado'} />
              <Row k="Modelo" v={nr?.model || '—'} />
              <Row k="Raciocínio" v={supports ? REASONING_LABEL[coerceReasoning(nr?.reasoning)] : 'não suportado'} />
            </Panel>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="glass rounded-2xl p-4">
      <h3 className="mb-3 text-[11px] title-track text-cyan-300/55">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Row({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="text-cyan-200/50">{k}</span>
      <span className="truncate text-cyan-100/85">{v}</span>
    </div>
  )
}
