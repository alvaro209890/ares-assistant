import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAres } from '../lib/store'
import { ptVoices } from '../lib/tts'

export default function SettingsPanel(): JSX.Element {
  const {
    settingsOpen,
    openSettings,
    config,
    voices,
    piper,
    saveConfig,
    testVoice,
    locateUser,
    navigate,
    setOverlay,
    exportData,
    importData,
    setGlobalShortcut,
    setAutostart,
    testBrain,
    testHermes
  } = useAres()
  const pt = ptVoices(voices)
  const [brainTest, setBrainTest] = useState<string>('')
  const [hermesTest, setHermesTest] = useState<string>('')

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
              <Toggle
                label="Permitir interromper a fala (barge-in)"
                checked={config.ui.bargeIn}
                onChange={(v) => saveConfig({ ui: { bargeIn: v } })}
              />
              <p className="text-[11px] text-cyan-200/45">
                Na conversa contínua, comece a falar por cima para o Ares parar na hora e te ouvir. A tecla Esc também
                interrompe a fala a qualquer momento.
              </p>
              <Toggle
                label="Exigir palavra de ativação"
                checked={config.ui.wakeWordEnabled}
                onChange={(v) => saveConfig({ ui: { wakeWordEnabled: v } })}
              />
              <Field label="Palavra de ativação">
                <input
                  className="input"
                  value={config.ui.wakeWord}
                  onChange={(e) => saveConfig({ ui: { wakeWord: e.target.value.trim() || 'ares' } })}
                />
                <p className="mt-1 text-[11px] text-cyan-200/45">
                  Com isto ligado, na conversa contínua o Ares só responde quando você começa pela palavra (ex.: “Ares, que horas
                  são?”). Diga só “Ares” para ele confirmar e aguardar o comando.
                </p>
              </Field>
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

            <Section title="ORBE FLUTUANTE">
              <Toggle
                label="Mini-orbe sempre no topo"
                checked={config.ui.overlayEnabled}
                onChange={(v) => void setOverlay(v)}
              />
              <p className="text-[11px] text-cyan-200/45">
                Um companion flutuante que reflete o estado do Ares. Clique na orbe para abrir o app; no microfone para falar.
                Arraste pela borda para reposicionar.
              </p>
            </Section>

            <Section title="ACESSIBILIDADE">
              <Slider
                label={`Tamanho do texto: ${Math.round(config.ui.fontScale * 100)}%`}
                min={0.85}
                max={1.5}
                step={0.05}
                value={config.ui.fontScale}
                onChange={(v) => saveConfig({ ui: { fontScale: v } })}
              />
              <Toggle
                label="Alto contraste"
                checked={config.ui.highContrast}
                onChange={(v) => saveConfig({ ui: { highContrast: v } })}
              />
              <Toggle
                label="Modo simples (menos HUD)"
                checked={config.ui.simpleMode}
                onChange={(v) => saveConfig({ ui: { simpleMode: v } })}
              />
            </Section>

            <Section title="SISTEMA E ATALHOS">
              <Toggle
                label="Falar briefing ao abrir (1x/dia)"
                checked={config.ui.morningBriefing}
                onChange={(v) => saveConfig({ ui: { morningBriefing: v } })}
              />
              <Toggle
                label="Atalho global (Ctrl+Shift+Espaço)"
                checked={config.ui.globalShortcut}
                onChange={(v) => void setGlobalShortcut(v)}
              />
              <Toggle
                label="Iniciar com o sistema"
                checked={config.ui.autostart}
                onChange={(v) => void setAutostart(v)}
              />
              <p className="text-[11px] text-cyan-200/45">Iniciar com o sistema fica plenamente efetivo após o empacotamento.</p>
              <div className="flex gap-2">
                <button onClick={() => void exportData()} className="btn-ghost">
                  EXPORTAR DADOS
                </button>
                <button onClick={() => void importData()} className="btn-ghost">
                  IMPORTAR DADOS
                </button>
              </div>
              <p className="text-[11px] text-cyan-200/45">Backup de tarefas, agenda, memória, listas, notas e lembretes (não inclui chaves).</p>
            </Section>

            <Section title="PONTE COM O HERMES (avançado)">
              <Toggle
                label="Ativar ponte com o Hermes"
                checked={config.integrations.hermes.enabled}
                onChange={(v) =>
                  saveConfig({ integrations: { ...config.integrations, hermes: { ...config.integrations.hermes, enabled: v } } })
                }
              />
              <Field label="Endpoint do Hermes">
                <input
                  className="input"
                  value={config.integrations.hermes.baseUrl}
                  onChange={(e) =>
                    saveConfig({
                      integrations: { ...config.integrations, hermes: { ...config.integrations.hermes, baseUrl: e.target.value } }
                    })
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Rota de comando">
                  <input
                    className="input"
                    placeholder="/message"
                    value={config.integrations.hermes.messagePath}
                    onChange={(e) =>
                      saveConfig({
                        integrations: { ...config.integrations, hermes: { ...config.integrations.hermes, messagePath: e.target.value } }
                      })
                    }
                  />
                </Field>
                <Field label="Rota de código">
                  <input
                    className="input"
                    placeholder="/code"
                    value={config.integrations.hermes.codePath}
                    onChange={(e) =>
                      saveConfig({
                        integrations: { ...config.integrations, hermes: { ...config.integrations.hermes, codePath: e.target.value } }
                      })
                    }
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Rota de status">
                  <input
                    className="input"
                    placeholder="/health"
                    value={config.integrations.hermes.healthPath}
                    onChange={(e) =>
                      saveConfig({
                        integrations: { ...config.integrations, hermes: { ...config.integrations.hermes, healthPath: e.target.value } }
                      })
                    }
                  />
                </Field>
                <Field label="Timeout (ms)">
                  <input
                    className="input"
                    type="number"
                    min={1000}
                    max={60000}
                    step={500}
                    value={config.integrations.hermes.timeoutMs}
                    onChange={(e) =>
                      saveConfig({
                        integrations: {
                          ...config.integrations,
                          hermes: { ...config.integrations.hermes, timeoutMs: Number(e.target.value) || 4000 }
                        }
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Token do Hermes">
                <input
                  className="input"
                  type="password"
                  placeholder="opcional"
                  value={config.integrations.hermes.apiKey}
                  onChange={(e) =>
                    saveConfig({
                      integrations: { ...config.integrations, hermes: { ...config.integrations.hermes, apiKey: e.target.value } }
                    })
                  }
                />
              </Field>
              <Field label="Cabeçalho auth">
                <input
                  className="input"
                  value={config.integrations.hermes.authHeader}
                  onChange={(e) =>
                    saveConfig({
                      integrations: { ...config.integrations, hermes: { ...config.integrations.hermes, authHeader: e.target.value } }
                    })
                  }
                />
              </Field>
              <Field label="Caminho da resposta">
                <input
                  className="input"
                  placeholder="ex.: data.reply (opcional)"
                  value={config.integrations.hermes.responsePath}
                  onChange={(e) =>
                    saveConfig({
                      integrations: { ...config.integrations, hermes: { ...config.integrations.hermes, responsePath: e.target.value } }
                    })
                  }
                />
              </Field>
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    setHermesTest('testando…')
                    const r = await testHermes()
                    setHermesTest(r.ok ? '✓ ' + r.detail : '✕ ' + r.detail)
                  }}
                  className="btn-ghost"
                >
                  TESTAR PONTE
                </button>
                {hermesTest && <span className="text-[11px] text-cyan-200/60">{hermesTest}</span>}
              </div>
              <p className="text-[11px] text-cyan-200/45">
                Quando ligada, o Ares delega comandos ao Hermes por voz e envia o id da sessão para preservar contexto.
              </p>
            </Section>

            <Section title="PROGRAMAÇÃO">
              <Toggle
                label="Ativar ferramentas locais de código"
                checked={config.integrations.code.enabled}
                onChange={(v) =>
                  saveConfig({ integrations: { ...config.integrations, code: { ...config.integrations.code, enabled: v } } })
                }
              />
              <Field label="Workspace padrão">
                <input
                  className="input"
                  value={config.integrations.code.workspaceRoot}
                  onChange={(e) =>
                    saveConfig({
                      integrations: { ...config.integrations, code: { ...config.integrations.code, workspaceRoot: e.target.value } }
                    })
                  }
                />
              </Field>
              <Field label="Raízes permitidas">
                <input
                  className="input"
                  value={config.integrations.code.allowedRoots.join(', ')}
                  onChange={(e) =>
                    saveConfig({
                      integrations: {
                        ...config.integrations,
                        code: {
                          ...config.integrations.code,
                          allowedRoots: e.target.value
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean)
                        }
                      }
                    })
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Arquivo máx. (KB)">
                  <input
                    className="input"
                    type="number"
                    min={16}
                    max={4096}
                    step={16}
                    value={config.integrations.code.maxFileKB}
                    onChange={(e) =>
                      saveConfig({
                        integrations: {
                          ...config.integrations,
                          code: { ...config.integrations.code, maxFileKB: Number(e.target.value) || 256 }
                        }
                      })
                    }
                  />
                </Field>
                <Field label="Resultados busca">
                  <input
                    className="input"
                    type="number"
                    min={5}
                    max={200}
                    step={5}
                    value={config.integrations.code.maxSearchResults}
                    onChange={(e) =>
                      saveConfig({
                        integrations: {
                          ...config.integrations,
                          code: { ...config.integrations.code, maxSearchResults: Number(e.target.value) || 40 }
                        }
                      })
                    }
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Timeout comandos (ms)">
                  <input
                    className="input"
                    type="number"
                    min={5000}
                    max={600000}
                    step={5000}
                    value={config.integrations.code.commandTimeoutMs}
                    onChange={(e) =>
                      saveConfig({
                        integrations: {
                          ...config.integrations,
                          code: { ...config.integrations.code, commandTimeoutMs: Number(e.target.value) || 120000 }
                        }
                      })
                    }
                  />
                </Field>
                <Field label="Arquivos no índice">
                  <input
                    className="input"
                    type="number"
                    min={20}
                    max={5000}
                    step={20}
                    value={config.integrations.code.indexMaxFiles}
                    onChange={(e) =>
                      saveConfig({
                        integrations: {
                          ...config.integrations,
                          code: { ...config.integrations.code, indexMaxFiles: Number(e.target.value) || 600 }
                        }
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Contexto Hermes (chars)">
                <input
                  className="input"
                  type="number"
                  min={2000}
                  max={80000}
                  step={1000}
                  value={config.integrations.code.maxContextChars}
                  onChange={(e) =>
                    saveConfig({
                      integrations: {
                        ...config.integrations,
                        code: { ...config.integrations.code, maxContextChars: Number(e.target.value) || 16000 }
                      }
                    })
                  }
                />
              </Field>
              <Field label="Comandos permitidos">
                <textarea
                  className="input min-h-28 resize-y"
                  value={config.integrations.code.allowedCommands.join('\n')}
                  onChange={(e) =>
                    saveConfig({
                      integrations: {
                        ...config.integrations,
                        code: {
                          ...config.integrations.code,
                          allowedCommands: e.target.value
                            .split('\n')
                            .map((x) => x.trim())
                            .filter(Boolean)
                        }
                      }
                    })
                  }
                />
              </Field>
              <Toggle
                label="Permitir aplicar patches"
                checked={config.integrations.code.allowPatchApply}
                onChange={(v) =>
                  saveConfig({ integrations: { ...config.integrations, code: { ...config.integrations.code, allowPatchApply: v } } })
                }
              />
              <Toggle
                label="Terminal completo (com autorização)"
                checked={config.integrations.code.terminalEnabled}
                onChange={(v) =>
                  saveConfig({ integrations: { ...config.integrations, code: { ...config.integrations.code, terminalEnabled: v } } })
                }
              />
              <Toggle
                label="Auto-autorizar comandos (avançado)"
                checked={config.integrations.code.terminalAutoApprove}
                onChange={(v) =>
                  saveConfig({ integrations: { ...config.integrations, code: { ...config.integrations.code, terminalAutoApprove: v } } })
                }
              />
              <Field label="Comandos seguros (rodam sem pedir)">
                <textarea
                  className="input min-h-28 resize-y"
                  value={config.integrations.code.terminalSafe.join('\n')}
                  onChange={(e) =>
                    saveConfig({
                      integrations: {
                        ...config.integrations,
                        code: {
                          ...config.integrations.code,
                          terminalSafe: e.target.value
                            .split('\n')
                            .map((x) => x.trim())
                            .filter(Boolean)
                        }
                      }
                    })
                  }
                />
              </Field>
              <p className="text-[11px] text-cyan-200/45">
                O Ares lê e busca código localmente. Comandos da allowlist e os "seguros" rodam direto; qualquer outro comando do
                terminal exige sua autorização por voz. Comandos catastróficos (sudo, apagar raiz, formatar disco) são sempre
                bloqueados. Patches só são aplicados quando a permissão estiver ligada.
              </p>
            </Section>

            <Section title="CONTROLE DO COMPUTADOR">
              <Toggle
                label="Permitir controlar o computador"
                checked={config.integrations.control.enabled}
                onChange={(v) =>
                  saveConfig({ integrations: { ...config.integrations, control: { ...config.integrations.control, enabled: v } } })
                }
              />
              <Field label="Pasta das capturas de tela">
                <input
                  className="input"
                  value={config.integrations.control.screenshotDir}
                  onChange={(e) =>
                    saveConfig({
                      integrations: {
                        ...config.integrations,
                        control: { ...config.integrations.control, screenshotDir: e.target.value }
                      }
                    })
                  }
                />
              </Field>
              <p className="text-[11px] text-cyan-200/45">
                Permite ao Ares abrir aplicativos e sites, ajustar o volume, bloquear a tela e tirar capturas — por voz. São
                ações seguras e instantâneas (não usam o terminal).
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
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    setBrainTest('testando…')
                    const r = await testBrain()
                    setBrainTest(r.ok ? '✓ ' + r.detail : '✕ ' + r.detail)
                  }}
                  className="btn-ghost"
                >
                  TESTAR CONEXÃO
                </button>
                {brainTest && <span className="text-[11px] text-cyan-200/60">{brainTest}</span>}
              </div>
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
