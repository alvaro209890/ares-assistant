import { AnimatePresence, motion } from 'framer-motion'
import { useAres } from '../lib/store'
import { ptVoices } from '../lib/tts'

export default function SettingsPanel(): JSX.Element {
  const { settingsOpen, openSettings, config, voices, piper, saveConfig, testVoice, locateUser, navigate } = useAres()
  const pt = ptVoices(voices)

  return (
    <AnimatePresence>
      {settingsOpen && config && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => openSettings(false)}
          />
          <motion.aside
            className="glass-strong fixed right-0 top-0 z-50 h-full w-[440px] max-w-[92vw] overflow-y-auto p-6"
            initial={{ x: 460 }}
            animate={{ x: 0 }}
            exit={{ x: 460 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-display text-lg title-track text-cyan-100 neon-text">CONFIGURAÇÕES</h2>
              <button onClick={() => openSettings(false)} className="text-cyan-200/60 hover:text-cyan-100" title="Fechar">
                <CloseIcon />
              </button>
            </div>

            <Section title="VOZ">
              <Toggle
                label="Falar respostas"
                checked={config.tts.enabled}
                onChange={(v) => saveConfig({ tts: { ...config.tts, enabled: v } })}
              />
              <Field label="Motor">
                <select
                  value={config.tts.engine}
                  onChange={(e) => saveConfig({ tts: { ...config.tts, engine: e.target.value as 'auto' | 'piper' | 'web' } })}
                  className="input"
                >
                  <option value="auto">Automático (Piper no Linux)</option>
                  <option value="piper">Piper neural local</option>
                  <option value="web">Chromium Web Speech</option>
                </select>
              </Field>

              <Field label="Voz Piper">
                <select
                  value={config.tts.piperVoice}
                  onChange={(e) => saveConfig({ tts: { ...config.tts, piperVoice: e.target.value } })}
                  className="input"
                >
                  {(piper?.voices.length ? piper.voices : [config.tts.piperVoice]).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-cyan-200/45">
                  {piper?.ready ? 'Piper pronto: voz neural local ativa.' : 'Piper ainda indisponível; o Ares usa Web Speech como reserva.'}
                </p>
              </Field>

              <Field label="Voz Chromium">
                <select
                  value={config.tts.webVoiceURI}
                  onChange={(e) => saveConfig({ tts: { ...config.tts, webVoiceURI: e.target.value } })}
                  className="input"
                >
                  <option value="">Automática (prioriza pt-BR)</option>
                  {pt.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} - {v.lang}
                    </option>
                  ))}
                </select>
                {pt.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-300/80">
                    Nenhuma voz pt-BR do Chromium foi carregada. O Piper neural continua sendo a opção recomendada no Linux.
                  </p>
                )}
              </Field>

              <Slider
                label={`Velocidade: ${config.tts.rate.toFixed(2)}`}
                min={0.5}
                max={1.6}
                step={0.05}
                value={config.tts.rate}
                onChange={(v) => saveConfig({ tts: { ...config.tts, rate: v } })}
              />
              <Slider
                label={`Tom: ${config.tts.pitch.toFixed(2)} (Chromium)`}
                min={0.5}
                max={1.6}
                step={0.05}
                value={config.tts.pitch}
                onChange={(v) => saveConfig({ tts: { ...config.tts, pitch: v } })}
              />
              <Slider
                label={`Volume: ${Math.round(config.tts.volume * 100)}%`}
                min={0}
                max={1}
                step={0.05}
                value={config.tts.volume}
                onChange={(v) => saveConfig({ tts: { ...config.tts, volume: v } })}
              />
              <button onClick={() => testVoice()} className="btn-ghost mt-1">
                TESTAR VOZ
              </button>
            </Section>

            <Section title="CONVERSA CONTÍNUA">
              <Slider
                label={`Sensibilidade do microfone: ${Math.round(config.ui.micSensitivity * 100)}%`}
                min={0}
                max={1}
                step={0.05}
                value={config.ui.micSensitivity}
                onChange={(v) => saveConfig({ ui: { micSensitivity: v } })}
              />
              <Slider
                label={`Silêncio para encerrar a fala: ${(config.ui.silenceMs / 1000).toFixed(2)}s`}
                min={600}
                max={3000}
                step={50}
                value={config.ui.silenceMs}
                onChange={(v) => saveConfig({ ui: { silenceMs: v } })}
              />
              <Slider
                label={`Pausa após o Ares falar: ${(config.ui.postSpeechPauseMs / 1000).toFixed(2)}s`}
                min={0}
                max={2000}
                step={50}
                value={config.ui.postSpeechPauseMs}
                onChange={(v) => saveConfig({ ui: { postSpeechPauseMs: v } })}
              />
              <p className="text-[11px] text-cyan-200/45">
                Mais sensibilidade capta vozes baixas; mais silêncio evita cortar frases. A pausa após a fala impede o Ares de se
                ouvir.
              </p>
            </Section>

            <Section title="MEMÓRIA">
              <Toggle
                label="Extrair fatos automaticamente"
                checked={config.memory.autoExtract}
                onChange={(v) => saveConfig({ memory: { autoExtract: v } })}
              />
              <Toggle
                label="Aprovar fatos automaticamente"
                checked={config.memory.autoApprove}
                onChange={(v) => saveConfig({ memory: { autoApprove: v } })}
              />
              <p className="text-[11px] text-cyan-200/45">
                Com aprovação automática desligada, os fatos extraídos ficam em “Para revisar” na tela Memória antes de serem
                salvos.
              </p>
            </Section>

            <Section title="PROATIVIDADE">
              <Toggle
                label="Sugestões proativas no briefing"
                checked={config.ui.proactiveSuggestions}
                onChange={(v) => saveConfig({ ui: { proactiveSuggestions: v } })}
              />
              <p className="text-[11px] text-cyan-200/45">
                Sugestões discretas sobre tarefas vencidas, eventos próximos, chuva e conflitos de agenda.
              </p>
            </Section>

            <Section title="CÉREBRO - 9 ROUTER">
              <Field label="URL base">
                <input
                  className="input"
                  value={config.nineRouter.baseUrl}
                  onChange={(e) => saveConfig({ nineRouter: { ...config.nineRouter, baseUrl: e.target.value } })}
                />
              </Field>
              <Field label="Modelo">
                <input
                  className="input"
                  value={config.nineRouter.model}
                  onChange={(e) => saveConfig({ nineRouter: { ...config.nineRouter, model: e.target.value } })}
                />
              </Field>
              <Field label="Chave">
                <input
                  className="input"
                  type="password"
                  placeholder="vazio para localhost"
                  value={config.nineRouter.apiKey}
                  onChange={(e) => saveConfig({ nineRouter: { ...config.nineRouter, apiKey: e.target.value } })}
                />
              </Field>
            </Section>

            <Section title="TRANSCRIÇÃO - GROQ">
              <Field label="URL base">
                <input
                  className="input"
                  value={config.grog.baseUrl}
                  onChange={(e) => saveConfig({ grog: { ...config.grog, baseUrl: e.target.value } })}
                />
              </Field>
              <Field label="Modelo Whisper">
                <input
                  className="input"
                  value={config.grog.sttModel}
                  onChange={(e) => saveConfig({ grog: { ...config.grog, sttModel: e.target.value } })}
                />
              </Field>
              <Field label="Chave Groq">
                <input
                  className="input"
                  type="password"
                  value={config.grog.apiKey}
                  onChange={(e) => saveConfig({ grog: { ...config.grog, apiKey: e.target.value } })}
                />
              </Field>
            </Section>

            <Section title="INTEGRAÇÕES">
              <Toggle
                label="Usar localização aproximada"
                checked={config.integrations.location.enabled}
                onChange={(v) =>
                  saveConfig({ integrations: { ...config.integrations, location: { ...config.integrations.location, enabled: v } } })
                }
              />
              <div className="rounded-lg border border-cyan-300/15 bg-black/20 p-3">
                <p className="text-xs text-cyan-100/85">
                  {config.integrations.location.label ||
                    config.integrations.location.city ||
                    'Localização ainda não detectada.'}
                </p>
                {config.integrations.location.updatedAt && (
                  <p className="mt-1 text-[11px] text-cyan-200/45">
                    Atualizada em {new Date(config.integrations.location.updatedAt).toLocaleString('pt-BR')}
                    {config.integrations.location.accuracy
                      ? ` · precisão aprox. ${Math.round(config.integrations.location.accuracy)}m`
                      : ''}
                  </p>
                )}
                <button onClick={() => locateUser()} className="btn-ghost mt-3">
                  DETECTAR AGORA
                </button>
              </div>
              <Field label="Cidade padrão do clima">
                <input
                  className="input"
                  value={config.integrations.weatherCity}
                  onChange={(e) =>
                    saveConfig({ integrations: { ...config.integrations, weatherCity: e.target.value } })
                  }
                />
              </Field>
              <Field label="Tema padrão de notícias">
                <input
                  className="input"
                  placeholder="vazio = manchetes gerais"
                  value={config.integrations.newsTopic}
                  onChange={(e) => saveConfig({ integrations: { ...config.integrations, newsTopic: e.target.value } })}
                />
              </Field>
            </Section>

            <button
              onClick={() => {
                openSettings(false)
                navigate('system')
              }}
              className="btn-ghost mb-2 w-full justify-center text-center"
            >
              ABRIR DIAGNÓSTICO DO SISTEMA
            </button>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-7">
      <h3 className="mb-3 text-xs title-track text-cyan-300/60">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block text-sm text-cyan-100/80">
      <span className="mb-1 block text-[12px] text-cyan-200/60">{label}</span>
      {children}
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between rounded-lg border border-cyan-300/20 bg-black/20 px-3 py-2 text-sm text-cyan-100/90"
    >
      {label}
      <span className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-emerald-400/70' : 'bg-cyan-200/20'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <label className="block text-sm text-cyan-100/80">
      <span className="mb-1 block text-[12px] text-cyan-200/60">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-cyan-400"
      />
    </label>
  )
}

function CloseIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}
