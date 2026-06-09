import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAres } from '../lib/store'
import ProviderConfig from './ProviderConfig'
import Select from './Select'
import { detectProviderId, getProvider } from '../../shared/providers'
import { BRAZIL_STATES } from '../../shared/locations'

const STEPS = ['Perfil', 'Groq', 'Local', 'IA', 'Voz']

export default function Onboarding(): JSX.Element {
  const { ready, config, finishOnboarding, testVoice, saveConfig } = useAres()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [groqKey, setGroqKey] = useState('')
  const [city, setCity] = useState('')
  const [stateUf, setStateUf] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!config) return
    setGroqKey((current) => current || config.grog.apiKey || '')
    setCity((current) => current || config.integrations.location.city || '')
    setStateUf((current) => {
      const saved = config.integrations.location.region || ''
      return current || (saved.length === 2 ? saved.toUpperCase() : '')
    })
  }, [config])

  const provider = useMemo(() => {
    if (!config) return null
    return getProvider(detectProviderId(config.nineRouter.baseUrl)) || null
  }, [config?.nineRouter.baseUrl])

  const show = ready && config && !config.ui.onboarded
  const groqReady = groqKey.trim().startsWith('gsk_') && groqKey.trim().length > 16
  const locationReady = city.trim().length >= 2 && !!stateUf
  const brainReady = !provider?.needsKey || !!config?.nineRouter.apiKey.trim() && config.nineRouter.apiKey.trim().length > 8
  const canContinue = step === 0 || (step === 1 && groqReady) || (step === 2 && locationReady) || (step === 3 && brainReady) || step === 4
  const canFinish = groqReady && locationReady && brainReady

  const saveGroq = async (): Promise<void> => {
    if (!config) return
    if (!groqReady) throw new Error('Cole uma chave Groq válida começando com gsk_.')
    await saveConfig({ grog: { ...config.grog, apiKey: groqKey.trim() } })
  }

  const saveLocation = async (): Promise<void> => {
    if (!config) return
    if (!locationReady) throw new Error('Escolha o estado e informe a cidade.')
    const cleanCity = city.trim()
    const label = `${cleanCity}, ${stateUf}`
    await saveConfig({
      integrations: {
        weatherCity: label,
        location: {
          enabled: true,
          city: cleanCity,
          region: stateUf,
          country: 'BR',
          label,
          updatedAt: Date.now()
        }
      }
    })
  }

  const next = async (): Promise<void> => {
    setError('')
    try {
      if (step === 1) await saveGroq()
      if (step === 2) await saveLocation()
      setStep((s) => Math.min(s + 1, STEPS.length - 1))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const finish = async (): Promise<void> => {
    setError('')
    try {
      if (!canFinish) throw new Error('Complete Groq, cidade/estado e provedor de IA para começar.')
      await saveGroq()
      await saveLocation()
      await finishOnboarding(name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[60] grid place-items-center bg-[radial-gradient(circle_at_top,#0f3a53_0%,#02050b_48%,#000_100%)] p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="glass-strong w-[720px] max-w-[96vw] overflow-hidden rounded-2xl border border-cyan-300/25"
            initial={{ y: 20, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
          >
            <div className="border-b border-cyan-300/10 bg-cyan-300/5 px-7 py-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300/70">Configuração inicial</p>
                  <h2 className="mt-1 font-display text-2xl text-cyan-100 neon-text">ARES</h2>
                </div>
                <div className="hidden items-center gap-2 sm:flex">
                  {STEPS.map((label, i) => (
                    <span
                      key={label}
                      className={`rounded-full border px-3 py-1 text-[11px] ${
                        i === step ? 'border-cyan-200 bg-cyan-200/15 text-cyan-50' : 'border-cyan-300/10 text-cyan-200/45'
                      }`}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-7">
              {step === 0 && (
                <Panel title="Perfil local" subtitle="Esse nome fica salvo só neste computador.">
                  <input
                    className="input"
                    placeholder="Seu nome (opcional)"
                    value={name}
                    autoFocus
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void next()}
                  />
                </Panel>
              )}

              {step === 1 && (
                <Panel title="Groq para microfone" subtitle="Obrigatório para fala virar texto com Whisper.">
                  <label className="block text-sm text-cyan-100/80">
                    <span className="mb-1 flex items-center justify-between text-[12px] text-cyan-200/60">
                      Chave Groq
                      <button
                        onClick={() => void window.ares.system.openExternal('https://console.groq.com/keys')}
                        className="text-cyan-300/70 hover:text-cyan-100"
                      >
                        pegar chave
                      </button>
                    </span>
                    <input
                      className="input"
                      type="password"
                      placeholder="gsk_..."
                      value={groqKey}
                      onChange={(e) => setGroqKey(e.target.value)}
                    />
                  </label>
                  <Status ok={groqReady} text={groqReady ? 'Groq configurada para voz.' : 'A chave precisa começar com gsk_.'} />
                </Panel>
              )}

              {step === 2 && (
                <Panel title="Cidade e estado" subtitle="Obrigatório para clima, briefing e contexto local.">
                  <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                    <label className="block text-sm text-cyan-100/80">
                      <span className="mb-1 block text-[12px] text-cyan-200/60">Estado</span>
                      <Select
                        ariaLabel="Estado (UF)"
                        placeholder="UF"
                        value={stateUf}
                        onChange={setStateUf}
                        options={[
                          { value: '', label: 'UF' },
                          ...BRAZIL_STATES.map((state) => ({ value: state.uf, label: `${state.uf} - ${state.name}` }))
                        ]}
                      />
                    </label>
                    <label className="block text-sm text-cyan-100/80">
                      <span className="mb-1 block text-[12px] text-cyan-200/60">Cidade</span>
                      <input className="input" placeholder="Ex.: São Paulo" value={city} onChange={(e) => setCity(e.target.value)} />
                    </label>
                  </div>
                  <Status ok={locationReady} text={locationReady ? `${city.trim()}, ${stateUf}` : 'Escolha a UF e digite a cidade.'} />
                </Panel>
              )}

              {step === 3 && (
                <Panel title="Cérebro de IA" subtitle="DeepSeek mostra somente V4 Flash e V4 Pro.">
                  <ProviderConfig compact />
                  {!brainReady && <Status ok={false} text="Este provedor precisa de uma chave de API antes de continuar." />}
                </Panel>
              )}

              {step === 4 && (
                <Panel title="Voz" subtitle="No Windows, o Ares prioriza vozes pt-BR naturais/neural quando disponíveis.">
                  <button onClick={() => void testVoice('Olá. Aqui é o Ares, com uma voz mais natural para te ajudar.')} className="btn-ghost">
                    TESTAR VOZ
                  </button>
                  <div className="mt-4 grid gap-2 text-xs text-cyan-100/75 sm:grid-cols-3">
                    <Summary label="Groq" value={groqReady ? 'pronto' : 'pendente'} />
                    <Summary label="Local" value={locationReady ? `${city.trim()}, ${stateUf}` : 'pendente'} />
                    <Summary label="IA" value={provider?.label || 'personalizado'} />
                  </div>
                </Panel>
              )}

              {error && <p className="mt-5 rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{error}</p>}

              <div className="mt-7 flex items-center justify-between">
                <button
                  onClick={() => {
                    setError('')
                    setStep((s) => Math.max(0, s - 1))
                  }}
                  disabled={step === 0}
                  className="text-xs text-cyan-200/55 hover:text-cyan-100 disabled:opacity-30"
                >
                  VOLTAR
                </button>
                {step < STEPS.length - 1 ? (
                  <button onClick={() => void next()} disabled={!canContinue} className="btn-ghost ml-2 disabled:opacity-40">
                    CONTINUAR
                  </button>
                ) : (
                  <button onClick={() => void finish()} disabled={!canFinish} className="btn-ghost ml-2 disabled:opacity-40">
                    COMEÇAR
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <h3 className="font-display text-lg text-cyan-100">{title}</h3>
      <p className="mt-1 text-sm text-cyan-100/65">{subtitle}</p>
      <div className="mt-5">{children}</div>
    </div>
  )
}

function Status({ ok, text }: { ok: boolean; text: string }): JSX.Element {
  return (
    <p className={`mt-3 rounded-lg border px-3 py-2 text-xs ${ok ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100' : 'border-amber-300/25 bg-amber-400/10 text-amber-100'}`}>
      {text}
    </p>
  )
}

function Summary({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-cyan-300/15 bg-black/20 p-3">
      <span className="block text-[10px] uppercase tracking-[0.18em] text-cyan-300/45">{label}</span>
      <span className="mt-1 block truncate text-cyan-100">{value}</span>
    </div>
  )
}
