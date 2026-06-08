import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type {
  AppConfig,
  Board,
  BriefingData,
  CalendarEvent,
  ChatSession,
  Checklist,
  AresState,
  DeepPartial,
  MemoryCategory,
  MemoryFact,
  Note,
  Recurrence,
  Reminder,
  SessionMeta,
  SystemMetrics,
  TtsStatus,
  UserLocation,
  WeatherResult
} from '../../shared/types'
import * as audio from './audio'
import type { SpeakOptions } from './tts'
import { cancelSpeech, loadVoices, enqueueSentence, whenSpeechQueueIdle, clearSpeechQueue, splitSentences } from './tts'

export interface ConvMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
}

type Screen = 'assistant' | 'tasks' | 'calendar' | 'reminders' | 'lists' | 'memory' | 'system'

interface AresStore {
  ready: boolean
  config: AppConfig | null
  screen: Screen
  aresState: AresState
  conversation: ConvMsg[]
  sessions: SessionMeta[]
  currentSessionId: string | null
  board: Board
  memory: MemoryFact[]
  events: CalendarEvent[]
  lists: Checklist[]
  quickNotes: Note[]
  reminders: Reminder[]
  voices: SpeechSynthesisVoice[]
  piper: TtsStatus | null
  weather: WeatherResult | null
  metrics: SystemMetrics | null
  recording: boolean
  continuous: boolean
  settingsOpen: boolean
  helpOpen: boolean
  paletteOpen: boolean
  briefing: BriefingData | null
  briefingLoading: boolean
  briefingOpen: boolean
  error: string | null
  status: string
  actionToast: string | null

  navigate: (s: Screen) => void
  openSettings: (b: boolean) => void
  openHelp: (b: boolean) => void
  openPalette: (b: boolean) => void
  stopSpeaking: () => void
  saveConfig: (patch: DeepPartial<AppConfig>) => Promise<void>
  setBoard: (updater: Board | ((b: Board) => Board)) => void
  sendText: (text: string) => Promise<void>
  beginPushToTalk: () => Promise<void>
  endPushToTalk: () => Promise<void>
  toggleContinuous: () => void
  clearError: () => void
  locateUser: () => Promise<void>
  testVoice: (text?: string) => Promise<void>
  refreshWidgets: () => Promise<void>
  loadBriefing: () => Promise<void>
  openBriefing: (open: boolean) => void
  setOverlay: (enabled: boolean) => Promise<void>
  createSession: () => Promise<void>
  openSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  addMemory: (text: string, category?: MemoryCategory) => Promise<void>
  updateMemory: (id: string, patch: { text?: string; category?: MemoryCategory; status?: 'active' | 'pending' }) => Promise<void>
  approveMemory: (id: string) => Promise<void>
  removeMemory: (id: string) => Promise<void>
  addEvent: (event: {
    title: string
    whenISO: string
    description?: string
    remindMinutes?: number
    recurrence?: CalendarEvent['recurrence']
  }) => Promise<void>
  removeEvent: (id: string) => Promise<void>
  saveLists: (lists: Checklist[]) => Promise<void>
  addNote: (text: string) => Promise<void>
  removeNote: (id: string) => Promise<void>
  addReminder: (r: { text: string; whenISO: string; recurrence?: Recurrence; kind?: Reminder['kind'] }) => Promise<void>
  removeReminder: (id: string) => Promise<void>
  exportData: () => Promise<void>
  importData: () => Promise<void>
  setGlobalShortcut: (enabled: boolean) => Promise<void>
  setAutostart: (enabled: boolean) => Promise<void>
  testBrain: () => Promise<{ ok: boolean; detail: string }>
  connectOpenRouter: () => Promise<{ ok: boolean; error?: string }>
  finishOnboarding: (name: string) => Promise<void>
}

const Ctx = createContext<AresStore | null>(null)
export const useAres = (): AresStore => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAres fora do AresProvider')
  return v
}

const emptyBoard: Board = { columns: [], cards: {} }
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const uid = (p = 'id') => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const toConv = (session: ChatSession | null): ConvMsg[] =>
  (session?.messages || []).map((m) => ({ id: m.id, role: m.role, content: m.content }))

const normWake = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?;:]/g, '')

// Distância de edição pequena (tolera erros de transcrição da palavra de ativação).
function lev(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/**
 * Verifica se a transcrição começa com a palavra de ativação (nas 2 primeiras
 * palavras, tolerando erros). Retorna o comando sem a palavra-chave, '' se só a
 * palavra foi dita, ou null se a palavra de ativação não apareceu.
 */
function stripWakeWord(text: string, wakeWord: string): string | null {
  const w = normWake(wakeWord || 'ares')
  const variants = w === 'ares' ? ['ares', 'aris', 'aries', 'arez', 'aress', 'harris', 'ariz'] : [w]
  const tokens = text.trim().split(/\s+/)
  const firstTwo = tokens.slice(0, 2).map(normWake)
  let hit = -1
  for (let k = 0; k < firstTwo.length; k++) {
    if (variants.some((v) => firstTwo[k] === v || lev(firstTwo[k], v) <= 1)) {
      hit = k
      break
    }
  }
  if (hit === -1) return null
  return tokens
    .slice(hit + 1)
    .join(' ')
    .replace(/^[\s,.:;-]+/, '')
    .trim()
}

export function AresProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [screen, setScreen] = useState<Screen>('assistant')
  const [aresState, setAresState] = useState<AresState>('idle')
  const [conversation, setConversation] = useState<ConvMsg[]>([])
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [board, setBoardState] = useState<Board>(emptyBoard)
  const [memory, setMemory] = useState<MemoryFact[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [lists, setLists] = useState<Checklist[]>([])
  const [quickNotes, setQuickNotes] = useState<Note[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [piper, setPiper] = useState<TtsStatus | null>(null)
  const [weather, setWeather] = useState<WeatherResult | null>(null)
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null)
  const [recording, setRecording] = useState(false)
  const [continuous, setContinuous] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [briefing, setBriefing] = useState<BriefingData | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [briefingOpen, setBriefingOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [actionToast, setActionToast] = useState<string | null>(null)

  const configRef = useRef<AppConfig | null>(null)
  const aresStateRef = useRef<AresState>('idle')
  const boardRef = useRef<Board>(emptyBoard)
  const currentSessionRef = useRef<string | null>(null)
  const continuousRef = useRef(false)
  const recordingRef = useRef(false)
  const busyRef = useRef(false)
  const loopRef = useRef(false)
  const wakeArmedUntilRef = useRef(0) // janela em que o comando é aceito sem repetir a palavra
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string) => {
    setActionToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setActionToast(null), 4200)
  }, [])

  const refreshSessions = useCallback(async () => {
    setSessions(await window.ares.sessions.list())
  }, [])

  const refreshWidgets = useCallback(async () => {
    const cfg = configRef.current
    if (!cfg) return
    const loc = cfg.integrations.location
    const hasLocation = loc.enabled && typeof loc.latitude === 'number' && typeof loc.longitude === 'number'
    const byCity = () => window.ares.weather.get(cfg.integrations.weatherCity)
    try {
      // Tenta pela localização precisa; se falhar, cai para a cidade configurada.
      setWeather(hasLocation ? await window.ares.weather.getCurrent(loc).catch(byCity) : await byCity())
    } catch (e) {
      setWeather(null)
      setStatus(`Clima indisponível: ${errMsg(e)}`)
    }
  }, [])

  // Opções de voz a partir da config atual (engine, voz, velocidade etc.).
  const voiceOpts = useCallback((): SpeakOptions => {
    const cfg = configRef.current
    return {
      engine: cfg?.tts.engine,
      piperVoice: cfg?.tts.piperVoice,
      voiceURI: cfg?.tts.webVoiceURI,
      rate: cfg?.tts.rate,
      pitch: cfg?.tts.pitch,
      volume: cfg?.tts.volume
    }
  }, [])

  // Fala um texto inteiro (briefing, lembrete, teste de voz) pela fila de fala.
  const speakText = useCallback(
    async (text: string): Promise<void> => {
      const cfg = configRef.current
      if (!cfg?.tts.enabled || !text.trim()) {
        setAresState('idle')
        return
      }
      clearSpeechQueue()
      setAresState('speaking')
      enqueueSentence(text, voiceOpts())
      await whenSpeechQueueIdle()
      setAresState('idle')
    },
    [voiceOpts]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [cfg, b, vs, ps, mem, evs, list, lsts, nts, rems] = await Promise.all([
          window.ares.config.get(),
          window.ares.tasks.load(),
          loadVoices(),
          window.ares.tts.status(),
          window.ares.memory.load(),
          window.ares.calendar.load(),
          window.ares.sessions.list(),
          window.ares.lists.load(),
          window.ares.notes.load(),
          window.ares.reminders.load()
        ])
        if (cancelled) return
        let active = list[0]?.id
        let session: ChatSession | null = active ? await window.ares.sessions.get(active) : null
        if (!session) {
          session = await window.ares.sessions.create()
          active = session.id
        }
        configRef.current = cfg
        boardRef.current = b
        currentSessionRef.current = active || null
        setConfig(cfg)
        setBoardState(b)
        setVoices(vs)
        setPiper(ps)
        setMemory(mem)
        setEvents(evs)
        setLists(lsts)
        setQuickNotes(nts)
        setReminders(rems)
        setSessions(list.length ? list : await window.ares.sessions.list())
        setCurrentSessionId(active || null)
        setConversation(toConv(session))
        setContinuous(cfg.ui.continuousMode)
        continuousRef.current = cfg.ui.continuousMode
        setReady(true)
        void refreshWidgets()
      } catch (e) {
        setError(errMsg(e))
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshWidgets])

  useEffect(() => {
    const off = window.ares.reminders.onFired((data) => {
      showToast(data.body)
      void Promise.all([window.ares.tasks.load(), window.ares.calendar.load()]).then(([b, evs]) => {
        boardRef.current = b
        setBoardState(b)
        setEvents(evs)
      })
      void speakText(data.body)
    })
    return off
  }, [showToast, speakText])

  // Espelha o estado do Ares na mini-orbe flutuante.
  useEffect(() => {
    window.ares.overlay.pushState(aresState).catch(() => {})
  }, [aresState])

  // Mantém um ref do estado para handlers globais (ex.: Esc interrompe a fala).
  useEffect(() => {
    aresStateRef.current = aresState
  }, [aresState])

  // Telemetria do sistema (HUD estilo JARVIS): consulta CPU/memória a cada 3s.
  useEffect(() => {
    if (!ready) return
    let alive = true
    const poll = async (): Promise<void> => {
      try {
        const m = await window.ares.system.metrics()
        if (alive) setMetrics(m)
      } catch {
        /* telemetria é opcional */
      }
    }
    void poll()
    const t = setInterval(() => void poll(), 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [ready])

  // Acessibilidade: escala de fonte, alto contraste e modo simples.
  useEffect(() => {
    if (!config) return
    document.documentElement.style.fontSize = `${Math.round(16 * (config.ui.fontScale || 1))}px`
    document.body.classList.toggle('hc', !!config.ui.highContrast)
    document.body.classList.toggle('simple', !!config.ui.simpleMode)
  }, [config?.ui.fontScale, config?.ui.highContrast, config?.ui.simpleMode, config])

  const persistBoard = useCallback((nb: Board) => {
    boardRef.current = nb
    setBoardState(nb)
    window.ares.tasks.save(nb).catch(() => {})
  }, [])

  const setBoard = useCallback(
    (updater: Board | ((b: Board) => Board)) => {
      const nb = typeof updater === 'function' ? (updater as (b: Board) => Board)(boardRef.current) : updater
      persistBoard(nb)
    },
    [persistBoard]
  )

  // Aguarda a fila de fala terminar. Na conversa contínua, se "barge-in" estiver
  // ligado, monitora o microfone em paralelo: se o usuário começar a falar por
  // cima, interrompe a fala do Ares na hora e libera o microfone para o comando.
  const waitForSpeechWithBargeIn = useCallback(async (): Promise<void> => {
    const cfg = configRef.current
    const idle = whenSpeechQueueIdle()
    if (!cfg?.ui.bargeIn || !continuousRef.current) {
      await idle
      return
    }
    let finished = false
    void idle.then(() => {
      finished = true
    })
    const sens = cfg.ui.micSensitivity ?? 0.5
    const interrupted = await audio.watchForSpeech({
      threshold: Math.max(0.1, (0.09 - sens * 0.075) * 2.4 + 0.05),
      sustainMs: 400,
      shouldStop: () => finished
    })
    if (interrupted && !finished) {
      clearSpeechQueue()
      setStatus('Interrompido — pode falar.')
    }
    await idle
  }, [])

  const runTurn = useCallback(
    async (userText: string, viaVoice = false) => {
      if (busyRef.current) return
      let sid = currentSessionRef.current
      if (!sid) {
        const s = await window.ares.sessions.create()
        sid = s.id
        currentSessionRef.current = sid
        setCurrentSessionId(sid)
      }
      busyRef.current = true
      setError(null)
      setStatus('')
      clearSpeechQueue() // interrompe qualquer fala anterior antes de começar
      const assistantId = uid('msg')
      setConversation((prev) => [
        ...prev,
        { id: uid('msg'), role: 'user', content: userText },
        { id: assistantId, role: 'assistant', content: '', pending: true }
      ])
      setAresState('thinking')

      // Fala a resposta sempre que o TTS estiver ligado — inclusive para mensagens
      // digitadas (o Ares responde por voz também ao texto do chat).
      const speak = !!configRef.current?.tts.enabled
      // A entrada por voz pede respostas mais curtas (VOICE_HINT no cérebro).
      const voice = viaVoice
      // Estado de streaming: texto exibido e buffer de sentenças (por fase).
      let phase = 1
      let display = ''
      let sentenceBuf = ''
      let speaking = false
      const opts = voiceOpts()

      const flush = (final: boolean): void => {
        if (!speak) {
          sentenceBuf = ''
          return
        }
        const { sentences, rest } = splitSentences(sentenceBuf, final)
        sentenceBuf = rest
        for (const s of sentences) {
          if (!speaking) {
            speaking = true
            setAresState('speaking')
          }
          enqueueSentence(s, opts)
        }
      }

      const off = window.ares.chat.onDelta(({ chunk, phase: ph }) => {
        if (ph !== phase) {
          // Resposta final após ferramentas: encerra a fase anterior e recomeça.
          flush(true)
          phase = ph
          display = ''
          sentenceBuf = ''
        }
        display += chunk
        const current = display
        setConversation((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: current } : m)))
        if (speak) {
          sentenceBuf += chunk
          flush(false)
        }
      })

      try {
        const result = await window.ares.chat.ask(sid, userText, voice)
        off()
        flush(true) // fala o restante do buffer
        boardRef.current = result.board
        setBoardState(result.board)
        setMemory(result.memory)
        setEvents(result.events)
        setLists(result.lists)
        setQuickNotes(result.quickNotes)
        setReminders(result.reminders)
        setConversation((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: result.fala, pending: false } : m))
        )
        if (result.notes.length) showToast(result.notes.join('   ·   '))
        await refreshSessions()
        void refreshWidgets()
        // Auto-extração de fatos: roda em segundo plano para não atrasar a fala.
        if (configRef.current?.memory.autoExtract) {
          void window.ares.memory
            .autoExtract(sid)
            .then((mem) => setMemory(mem))
            .catch(() => {})
        }
        if (speak) await waitForSpeechWithBargeIn()
        setAresState('idle')
        busyRef.current = false
      } catch (e) {
        off()
        clearSpeechQueue()
        setConversation((prev) => prev.filter((m) => m.id !== assistantId))
        setError(errMsg(e))
        setAresState('idle')
        busyRef.current = false
      }
    },
    [refreshSessions, refreshWidgets, showToast, voiceOpts, waitForSpeechWithBargeIn]
  )

  const sendText = useCallback(
    async (text: string) => {
      const t = text.trim()
      if (t) await runTurn(t, false)
    },
    [runTurn]
  )

  const transcribeBlob = useCallback(async (blob: Blob, mimeType: string): Promise<string> => {
    const buf = await blob.arrayBuffer()
    return window.ares.stt.transcribe(buf, mimeType)
  }, [])

  const beginPushToTalk = useCallback(async () => {
    if (busyRef.current || continuousRef.current) return
    try {
      await audio.startRecording()
      recordingRef.current = true
      setRecording(true)
      setAresState('listening')
      setError(null)
    } catch {
      setError('Não consegui acessar o microfone. Verifique a permissão do sistema.')
      setAresState('idle')
    }
  }, [])

  const endPushToTalk = useCallback(async () => {
    if (!recordingRef.current) return
    recordingRef.current = false
    setRecording(false)
    let res: { blob: Blob; mimeType: string }
    try {
      res = await audio.stopRecording()
    } catch {
      setAresState('idle')
      return
    }
    setAresState('thinking')
    try {
      const text = await transcribeBlob(res.blob, res.mimeType)
      if (!text.trim()) {
        setStatus('Não captei nenhuma fala. Tente novamente.')
        setAresState('idle')
        return
      }
      await runTurn(text, true)
    } catch (e) {
      setError(errMsg(e))
      setAresState('idle')
    }
  }, [runTurn, transcribeBlob])

  // Converte a sensibilidade (0..1) num limiar de áudio (quanto mais sensível, menor).
  const micThreshold = useCallback((): number => {
    const s = configRef.current?.ui.micSensitivity ?? 0.5
    return Math.max(0.012, 0.09 - s * 0.075)
  }, [])

  // Escuta única (usada pela orbe flutuante): grava até o silêncio, transcreve e responde.
  const voiceCommandOnce = useCallback(async () => {
    if (busyRef.current || continuousRef.current) return
    try {
      await audio.ensureMic()
      setAresState('listening')
      setStatus('Ouvindo…')
      setRecording(true)
      const res = await audio.recordUntilSilence({
        threshold: micThreshold(),
        silenceMs: configRef.current?.ui.silenceMs ?? 1350
      })
      setRecording(false)
      if (!res.spoke) {
        setAresState('idle')
        setStatus('')
        return
      }
      setAresState('thinking')
      setStatus('Transcrevendo…')
      const text = await transcribeBlob(res.blob, res.mimeType)
      setStatus('')
      if (text.trim()) await runTurn(text, true)
      else setAresState('idle')
    } catch (e) {
      setError(errMsg(e))
      setAresState('idle')
      setRecording(false)
    }
  }, [micThreshold, transcribeBlob, runTurn])

  // A orbe flutuante pode pedir uma escuta (botão do microfone).
  useEffect(() => {
    const off = window.ares.overlay.onListen(() => {
      setScreen('assistant')
      void voiceCommandOnce()
    })
    return off
  }, [voiceCommandOnce])

  const continuousLoop = useCallback(async () => {
    if (loopRef.current) return
    loopRef.current = true
    try {
      while (continuousRef.current) {
        if (busyRef.current) {
          await new Promise((r) => setTimeout(r, 150))
          continue
        }
        setAresState('listening')
        setStatus('Conversa contínua: aguardando sua fala.')
        setRecording(true)
        let res: { blob: Blob; mimeType: string; spoke: boolean }
        try {
          res = await audio.recordUntilSilence({
            shouldStop: () => !continuousRef.current,
            threshold: micThreshold(),
            silenceMs: configRef.current?.ui.silenceMs ?? 1350
          })
        } catch {
          setError('Microfone indisponível para o modo contínuo.')
          break
        }
        setRecording(false)
        if (!continuousRef.current) break
        if (!res.spoke) {
          setStatus('Conversa contínua: ainda ouvindo.')
          continue
        }
        setAresState('thinking')
        setStatus('Transcrevendo sua fala.')
        let text = ''
        try {
          text = await transcribeBlob(res.blob, res.mimeType)
        } catch (e) {
          setError(errMsg(e))
          break
        }
        if (text.trim()) {
          // Wake word: na conversa contínua, só age se ouvir a palavra de ativação
          // (ou se estiver "armado" logo após dizê-la sozinha).
          const cfg = configRef.current
          let command = text.trim()
          if (cfg?.ui.wakeWordEnabled) {
            const armed = Date.now() < wakeArmedUntilRef.current
            if (armed) {
              wakeArmedUntilRef.current = 0 // consome a janela
            } else {
              const stripped = stripWakeWord(command, cfg.ui.wakeWord)
              if (stripped === null) {
                setStatus(`Aguardando “${cfg.ui.wakeWord || 'Ares'}”…`)
                continue
              }
              if (stripped === '') {
                // Disse só a palavra-chave: confirma e abre janela para o comando.
                wakeArmedUntilRef.current = Date.now() + 9000
                setStatus('Pois não?')
                await speakText('Pois não?')
                continue
              }
              command = stripped
            }
          }
          setStatus('')
          await runTurn(command, true)
          // Pausa curta após a fala do Ares antes de voltar a ouvir (evita auto-escuta).
          if (continuousRef.current) {
            setAresState('idle')
            setStatus('Pausa…')
            await new Promise((r) => setTimeout(r, configRef.current?.ui.postSpeechPauseMs ?? 450))
          }
        } else {
          setStatus('Não captei fala útil. Continuo ouvindo.')
        }
      }
    } finally {
      loopRef.current = false
      setRecording(false)
      if (!busyRef.current) setAresState('idle')
    }
  }, [runTurn, transcribeBlob, micThreshold, speakText])

  const toggleContinuous = useCallback(() => {
    const next = !continuousRef.current
    continuousRef.current = next
    setContinuous(next)
    void window.ares.config.update({ ui: { continuousMode: next } }).then((nc) => {
      configRef.current = nc
      setConfig(nc)
    })
    if (next) {
      setStatus('Preparando microfone para conversa contínua.')
      void audio
        .ensureMic()
        .then(() => continuousLoop())
        .catch(() => {
          continuousRef.current = false
          setContinuous(false)
          setStatus('')
          setError('Não consegui acessar o microfone para conversa contínua.')
        })
    } else {
      setStatus('')
      cancelSpeech()
    }
  }, [continuousLoop])

  useEffect(() => {
    if (!ready || !continuousRef.current || loopRef.current) return
    setStatus('Retomando conversa contínua.')
    void audio
      .ensureMic()
      .then(() => continuousLoop())
      .catch(() => {
        continuousRef.current = false
        setContinuous(false)
        setStatus('')
        setError('Não consegui retomar a conversa contínua porque o microfone está indisponível.')
      })
  }, [ready, continuous, continuousLoop])

  const saveConfig = useCallback(
    async (patch: DeepPartial<AppConfig>) => {
      const nc = await window.ares.config.update(patch)
      configRef.current = nc
      setConfig(nc)
      setPiper(await window.ares.tts.status())
      void refreshWidgets()
    },
    [refreshWidgets]
  )

  const locateUser = useCallback(async () => {
    const cfg = configRef.current
    if (!cfg) return
    if (!navigator.geolocation) {
      setStatus('Geolocalização indisponível neste sistema.')
      return
    }
    setStatus('Solicitando localização aproximada.')
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 10 * 60 * 1000
        })
      })
      const { latitude, longitude, accuracy } = pos.coords
      const reverse = await window.ares.location.reverse(latitude, longitude)
      const location: UserLocation = {
        ...cfg.integrations.location,
        enabled: true,
        latitude,
        longitude,
        accuracy,
        city: reverse.city,
        region: reverse.region,
        country: reverse.country,
        label: reverse.label,
        updatedAt: Date.now()
      }
      const nc = await window.ares.config.update({ integrations: { ...cfg.integrations, location } })
      configRef.current = nc
      setConfig(nc)
      setStatus('')
      showToast(`localização: ${location.label || 'atualizada'}`)
      await refreshWidgets()
    } catch {
      setStatus('Não consegui acessar sua localização. Verifique a permissão do sistema.')
    }
  }, [refreshWidgets, showToast])

  const testVoice = useCallback(
    async (text = 'Olá, senhor. Aqui é o Ares, com voz neural pronta para ajudar.') => {
      await speakText(text)
    },
    [speakText]
  )

  const createSession = useCallback(async () => {
    const s = await window.ares.sessions.create()
    currentSessionRef.current = s.id
    setCurrentSessionId(s.id)
    setConversation([])
    await refreshSessions()
  }, [refreshSessions])

  const openSession = useCallback(async (id: string) => {
    const s = await window.ares.sessions.get(id)
    if (!s) return
    currentSessionRef.current = id
    setCurrentSessionId(id)
    setConversation(toConv(s))
  }, [])

  const renameSession = useCallback(
    async (id: string, title: string) => {
      await window.ares.sessions.rename(id, title)
      await refreshSessions()
    },
    [refreshSessions]
  )

  const deleteSession = useCallback(
    async (id: string) => {
      await window.ares.sessions.delete(id)
      let list = await window.ares.sessions.list()
      if (!list.length) {
        const s = await window.ares.sessions.create()
        list = await window.ares.sessions.list()
        currentSessionRef.current = s.id
        setCurrentSessionId(s.id)
        setConversation([])
      } else if (currentSessionRef.current === id) {
        const s = await window.ares.sessions.get(list[0].id)
        currentSessionRef.current = list[0].id
        setCurrentSessionId(list[0].id)
        setConversation(toConv(s))
      }
      setSessions(list)
    },
    []
  )

  const addMemory = useCallback(async (text: string, category?: MemoryCategory) => {
    const t = text.trim()
    if (!t) return
    setMemory(await window.ares.memory.add(t, category))
    showToast('memória atualizada')
  }, [showToast])

  const updateMemory = useCallback(
    async (id: string, patch: { text?: string; category?: MemoryCategory; status?: 'active' | 'pending' }) => {
      setMemory(await window.ares.memory.update(id, patch))
    },
    []
  )

  const approveMemory = useCallback(async (id: string) => {
    setMemory(await window.ares.memory.approve(id))
    showToast('fato confirmado')
  }, [showToast])

  const removeMemory = useCallback(async (id: string) => {
    setMemory(await window.ares.memory.remove(id))
  }, [])

  const addEvent = useCallback(
    async (event: {
      title: string
      whenISO: string
      description?: string
      remindMinutes?: number
      recurrence?: CalendarEvent['recurrence']
    }) => {
      setEvents(await window.ares.calendar.add(event))
    },
    []
  )

  const removeEvent = useCallback(async (id: string) => {
    setEvents(await window.ares.calendar.remove(id))
  }, [])

  const saveLists = useCallback(async (next: Checklist[]) => {
    setLists(next) // otimista
    setLists(await window.ares.lists.save(next))
  }, [])

  const addNote = useCallback(async (text: string) => {
    const t = text.trim()
    if (!t) return
    setQuickNotes(await window.ares.notes.add(t))
    showToast('nota salva')
  }, [showToast])

  const removeNote = useCallback(async (id: string) => {
    setQuickNotes(await window.ares.notes.remove(id))
  }, [])

  const addReminder = useCallback(
    async (r: { text: string; whenISO: string; recurrence?: Recurrence; kind?: Reminder['kind'] }) => {
      setReminders(await window.ares.reminders.add(r))
      showToast('lembrete criado')
    },
    [showToast]
  )

  const removeReminder = useCallback(async (id: string) => {
    setReminders(await window.ares.reminders.remove(id))
  }, [])

  const exportData = useCallback(async () => {
    const r = await window.ares.data.export()
    if (r.ok) showToast('backup exportado')
    else if (r.error) setError(r.error)
  }, [showToast])

  const importData = useCallback(async () => {
    const r = await window.ares.data.import()
    if (r.ok) {
      showToast(`backup restaurado (${r.restored} arquivos)`)
      const [b, mem, evs, lsts, nts, rems] = await Promise.all([
        window.ares.tasks.load(),
        window.ares.memory.load(),
        window.ares.calendar.load(),
        window.ares.lists.load(),
        window.ares.notes.load(),
        window.ares.reminders.load()
      ])
      boardRef.current = b
      setBoardState(b)
      setMemory(mem)
      setEvents(evs)
      setLists(lsts)
      setQuickNotes(nts)
      setReminders(rems)
    } else if (r.error) setError(r.error)
  }, [showToast])

  const setGlobalShortcut = useCallback(async (enabled: boolean) => {
    const nc = await window.ares.system.setGlobalShortcut(enabled)
    configRef.current = nc
    setConfig(nc)
  }, [])

  const setAutostart = useCallback(async (enabled: boolean) => {
    const nc = await window.ares.system.setAutostart(enabled)
    configRef.current = nc
    setConfig(nc)
  }, [])

  const testBrain = useCallback(() => window.ares.system.testBrain(), [])
  const connectOpenRouter = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    const r = await window.ares.provider.oauth('openrouter')
    if (r.ok && r.config) {
      configRef.current = r.config
      setConfig(r.config)
      return { ok: true }
    }
    return { ok: false, error: r.error }
  }, [])

  const finishOnboarding = useCallback(
    async (name: string) => {
      const userName = name.trim()
      const nc = await window.ares.config.update({ ui: { onboarded: true, userName } })
      configRef.current = nc
      setConfig(nc)
      if (userName) setMemory(await window.ares.memory.add(`O usuário se chama ${userName}.`, 'perfil'))
    },
    []
  )

  const loadBriefing = useCallback(async () => {
    setBriefingLoading(true)
    try {
      setBriefing(await window.ares.briefing.get())
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBriefingLoading(false)
    }
  }, [])

  const openBriefing = useCallback((open: boolean) => {
    setBriefingOpen(open)
    if (open) void loadBriefing()
  }, [loadBriefing])

  const setOverlay = useCallback(async (enabled: boolean) => {
    const nc = await window.ares.overlay.set(enabled)
    configRef.current = nc
    setConfig(nc)
  }, [])

  // Bandeja: "Briefing do dia" abre o painel.
  useEffect(() => {
    const off = window.ares.system.onBriefing(() => openBriefing(true))
    return off
  }, [openBriefing])

  // "Bom dia": fala o briefing 1x por dia ao abrir, se ativado.
  useEffect(() => {
    if (!ready || !config?.ui.morningBriefing) return
    const today = new Date().toISOString().slice(0, 10)
    if (localStorage.getItem('ares-briefing-day') === today) return
    localStorage.setItem('ares-briefing-day', today)
    const timer = setTimeout(async () => {
      try {
        const b = await window.ares.briefing.get()
        setBriefing(b)
        const bits = [b.greeting]
        if (b.weather) bits.push(`${b.weather.current.temp} graus, ${b.weather.current.desc}.`)
        bits.push(b.todayEvents.length ? `Você tem ${b.todayEvents.length} compromisso(s) hoje.` : 'Sua agenda está livre.')
        if (b.overdueTasks.length) bits.push(`${b.overdueTasks.length} tarefa(s) vencida(s).`)
        await speakText(bits.join(' '))
      } catch {
        /* silencioso */
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [ready, config?.ui.morningBriefing, speakText])

  const navigate = useCallback((s: Screen) => setScreen(s), [])
  const openSettings = useCallback((b: boolean) => setSettingsOpen(b), [])
  const openHelp = useCallback((b: boolean) => setHelpOpen(b), [])
  const openPalette = useCallback((b: boolean) => setPaletteOpen(b), [])
  const stopSpeaking = useCallback(() => {
    clearSpeechQueue()
    if (!busyRef.current) setAresState('idle')
  }, [])
  const clearError = useCallback(() => setError(null), [])

  // Esc interrompe a fala do Ares a qualquer momento (barge-in manual).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && aresStateRef.current === 'speaking') stopSpeaking()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stopSpeaking])

  const value: AresStore = {
    ready,
    config,
    screen,
    aresState,
    conversation,
    sessions,
    currentSessionId,
    board,
    memory,
    events,
    lists,
    quickNotes,
    reminders,
    voices,
    piper,
    weather,
    metrics,
    recording,
    continuous,
    settingsOpen,
    helpOpen,
    paletteOpen,
    briefing,
    briefingLoading,
    briefingOpen,
    error,
    status,
    actionToast,
    navigate,
    openSettings,
    openHelp,
    openPalette,
    stopSpeaking,
    saveConfig,
    setBoard,
    sendText,
    beginPushToTalk,
    endPushToTalk,
    toggleContinuous,
    clearError,
    locateUser,
    testVoice,
    refreshWidgets,
    loadBriefing,
    openBriefing,
    setOverlay,
    createSession,
    openSession,
    renameSession,
    deleteSession,
    addMemory,
    updateMemory,
    approveMemory,
    removeMemory,
    addEvent,
    removeEvent,
    saveLists,
    addNote,
    removeNote,
    addReminder,
    removeReminder,
    exportData,
    importData,
    setGlobalShortcut,
    setAutostart,
    testBrain,
    connectOpenRouter,
    finishOnboarding
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
