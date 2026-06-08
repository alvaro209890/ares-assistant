import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAres } from '../lib/store'
import ProviderConfig from './ProviderConfig'

// Assistente de primeiros passos. Aparece só no 1º uso (config.ui.onboarded=false).
// Reduz o atrito para quem não é técnico: nome, localização, voz e exemplos.
export default function Onboarding(): JSX.Element {
  const { ready, config, finishOnboarding, locateUser, testVoice, openHelp, saveConfig } = useAres()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')

  const show = ready && config && !config.ui.onboarded
  const finish = () => void finishOnboarding(name)

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="glass-strong w-[560px] max-w-[94vw] rounded-2xl p-7"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            <div className="mb-5 flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-glow" />
              <h2 className="font-display text-xl title-track text-cyan-100 neon-text">BEM-VINDO AO ARES</h2>
            </div>

            {step === 0 && (
              <div>
                <p className="text-sm text-cyan-100/85">
                  Sou seu assistente pessoal. Seus dados ficam neste computador. Para começar, como você gostaria que eu
                  te chamasse?
                </p>
                <input
                  className="input mt-4"
                  placeholder="Seu nome (opcional)"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setStep(1)}
                />
              </div>
            )}

            {step === 1 && (
              <div>
                <p className="text-sm text-cyan-100/85">
                  Escolha o cérebro de IA que vou usar. Faça login no OpenRouter ou cole uma chave (DeepSeek, Groq…) e
                  toque em <span className="text-cyan-200">Testar conexão</span>.
                </p>
                <div className="mt-4">
                  <ProviderConfig compact />
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <p className="text-sm text-cyan-100/85">
                  {name ? `Prazer, ${name}! ` : ''}Posso usar sua localização aproximada para melhorar clima, briefing e
                  contexto local?
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      await locateUser()
                      setStep(3)
                    }}
                    className="btn-ghost"
                  >
                    PERMITIR E DETECTAR
                  </button>
                  <button
                    onClick={async () => {
                      await saveConfig({ integrations: { location: { enabled: false } } })
                      setStep(3)
                    }}
                    className="btn-ghost"
                  >
                    USAR CIDADE PADRÃO
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => void testVoice('Olá! Aqui é o Ares, pronto para ajudar.')} className="btn-ghost">
                    TESTAR VOZ
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-cyan-200/45">
                  As coordenadas ficam neste computador. Você pode mudar isso depois em Configurações / Localização.
                </p>
              </div>
            )}

            {step === 3 && (
              <div>
                <p className="text-sm text-cyan-100/85">Pronto! Experimente pedir coisas como:</p>
                <ul className="mt-3 grid gap-1.5 text-sm text-cyan-100/80">
                  <li>• “Faça meu briefing”</li>
                  <li>• “Me lembra de tomar água às 15h”</li>
                  <li>• “Adiciona café na lista de compras”</li>
                  <li>• “Vai chover hoje?”</li>
                </ul>
                <button
                  onClick={() => {
                    finish()
                    openHelp(true)
                  }}
                  className="mt-4 text-xs text-cyan-200/60 hover:text-cyan-100"
                >
                  Ver todos os exemplos depois →
                </button>
              </div>
            )}

            <div className="mt-6 flex items-center justify-between">
              <button onClick={finish} className="text-xs text-cyan-200/45 hover:text-cyan-100">
                Pular
              </button>
              <div className="flex items-center gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-cyan-300' : 'bg-cyan-200/25'}`} />
                ))}
                {step < 3 ? (
                  <button onClick={() => setStep(step + 1)} className="btn-ghost ml-2">
                    PRÓXIMO
                  </button>
                ) : (
                  <button onClick={finish} className="btn-ghost ml-2">
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
