import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type {
  AgentActivityEvent,
  AgentTurnResult,
  AppConfig,
  Board,
  BriefingData,
  CalendarEvent,
  ChatSession,
  Checklist,
  AresState,
  DeepPartial,
  HiveWorkerStatus,
  MemoryCategory,
  MemoryContradictionAction,
  MemoryFact,
  Note,
  Recurrence,
  Reminder,
  SessionMeta,
  SystemMetrics,
  TaskProgressEvent,
  TtsStatus,
  UserLocation,
  WeatherResult } from '../../shared/types'
import * as audio from './audio'
import type { SpeakOptions } from './tts'
import {
  cancelSpeech,
  loadVoices,
  enqueueSentence,
  whenSpeechQueueIdle,
  clearSpeechQueue,
  splitSentences
} from './tts'
import { bargeInThreshold, interpretBusySpeech, stripWakeWord } from './voiceControl'

export interface ConvMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  activities?: AgentActivityEvent[]
}

// Caps do terminal ao vivo: linhas/chars suficientes para acompanhar um build
// sem deixar a mensagem do chat gigante (o backend já limita cada evento).
const TERMINAL_MAX_LINES = 40
const TERMINAL_MAX_CHARS = 6000

export function mergeActivityEvent(events: AgentActivityEvent[] = [], event: AgentActivityEvent): AgentActivityEvent[] {
  if (event.status === 'output') {
    const existingIdx = events.findIndex((e) => e.id === event.id)
    if (existingIdx !== -1) {
      const next = events.slice()
      const existing = next[existingIdx]
      // Streaming incremental: concatena os pedaços CRUS (preserva linhas
      // parciais que chegam divididas entre eventos) e capa pelo fim.
      const combined = `${existing.output || ''}${event.output || ''}`
      const lines = combined.split('\n')
      const capped = (lines.length > TERMINAL_MAX_LINES ? lines.slice(-TERMINAL_MAX_LINES) : lines)
        .join('\n')
        .slice(-TERMINAL_MAX_CHARS)
      next[existingIdx] = {
        ...existing,
        status: existing.status === 'running' || existing.status === 'output' ? 'output' : existing.status,
        stream: event.stream || existing.stream,
        output: capped
      }
      return next
    }
    return [...events, event].slice(-80)
  }

  const idx = events.findIndex((e) => e.id === event.id)
  if (idx === -1) {
    return [...events, event].slice(-80)
  }

  const next = events.slice()
  next[idx] = {
    ...next[idx],
    ...event,
    output: next[idx].output || event.output
  }
  return next
}

/**
 * Fallback de fala no final do turno. Anti-repetição: se o streaming já
 * enfileirou frases parciais (queuedSpeech = true), o fallback NUNCA refala
 * o texto completo (result.fala). Usa apenas o resumo de voz (falaVoz) para
 * a última fase se ela não teve fala — evita que o Ares repita tudo.
 */
export function finalSpeechFallback(
  result: Pick<AgentTurnResult, 'fala' | 'falaVoz'>,
  queuedSpeech: boolean,
  finalPhaseQueuedSpeech: boolean
): string {
  const voiceSummary = result.falaVoz?.trim()
  const fullSpeech = result.fala.trim()
  // Nada foi falado em nenhuma fase do turno — fala o texto completo.
  if (!queuedSpeech && fullSpeech) return voiceSummary || fullSpeech
  // A última fase não teve fala pelo streaming, mas fases anteriores sim.
  // Usa APENAS o resumo de voz (falaVoz) para não repetir tudo.
  if (!finalPhaseQueuedSpeech && voiceSummary) return voiceSummary
  // Já houve fala na última fase — nada a complementar.
  return ''
}

type Screen = 'assistant' | 'office' | 'tasks' | 'calendar' | 'reminders' | 'lists' | 'memory' | 'models' | 'system'

// Estado inicial da Colmeia: os quatro especialistas ociosos.
export const HIVE_IDLE: HiveWorkerStatus[] = [
  { id: 'researcher', label: 'Atena', phase: 'idle', updatedAt: 0 },
  { id: 'engineer', label: 'Hefesto', phase: 'idle', updatedAt: 0 },
  { id: 'auditor', label: 'Têmis', phase: 'idle', updatedAt: 0 },
  { id: 'debugger', label: 'Prometeu', phase: 'idle', updatedAt: 0 }
]

/** Aplica uma atualização de status de subagente à lista da Colmeia. Pura e testável. */
export function mergeHiveStatus(workers: HiveWorkerStatus[], status: HiveWorkerStatus): HiveWorkerStatus[] {
  const idx = workers.findIndex((w) => w.id === status.id)
  if (idx === -1) return [...workers, status]
  const next = workers.slice()
  next[idx] = status
  return next
}

/** Um único HUD global de tarefa: start/update substituem, end limpa. */
export function mergeTaskProgress(
  current: TaskProgressEvent | null,
  event: TaskProgressEvent
): TaskProgressEvent | null {
  if (event.status === 'end') {
    if (!current || current.id === event.id || current.tool === event.tool) return null
    return current
  }
  if (!current || current.id === event.id || current.tool === event.tool) return { ...current, ...event }
  return event
}

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
  actionToast: React.ReactNode | null
  hiveWorkers: HiveWorkerStatus[]
  taskProgress: TaskProgressEvent | null
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
  updateMemory: (id: string, patch: { text?: string; category?: MemoryCategory; status?: 'active' | 'probationary' | 'archived' }) => Promise<void>
  approveMemory: (id: string) => Promise<void>
  resolveMemory: (id: string, action: MemoryContradictionAction) => Promise<void>
  removeMemory: (id: string, createAntiFact?: boolean) => Promise<void>
  consolidateMemory: () => Promise<any>
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
  finishOnboarding: (name: string) => Promise<void>
  sentinels: any[]
  stopSentinel: (id: string) => Promise<void>
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
  const [actionToast, setActionToast] = useState<React.ReactNode | null>(null)
  const [hiveWorkers, setHiveWorkers] = useState<HiveWorkerStatus[]>(HIVE_IDLE)
  const [taskProgress, setTaskProgress] = useState<TaskProgressEvent | null>(null)
  const [sentinels, setSentinels] = useState<any[]>([])

  const configRef = useRef<AppConfig | null>(null)
  const aresStateRef = useRef<AresState>('idle')
  const boardRef = useRef<Board>(emptyBoard)
  const currentSessionRef = useRef<string | null>(null)
  const continuousRef = useRef(false)
  const recordingRef = useRef(false)
  const busyRef = useRef(false)
  const loopRef = useRef(false)
  const wakeArmedUntilRef = useRef(0) // janela em que o comando é aceito sem repetir a palavra
  // Comando dito ENQUANTO o Ares trabalhava: roda assim que a tarefa atual terminar.
  const pendingVoiceCmdRef = useRef<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const memoryRef = useRef<MemoryFact[]>([])

  const showToast = useCallback((msg: React.ReactNode) => {
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
      volume: cfg?.tts.volume,
      // Falhas de voz deixam de ser silenciosas: aparecem no status.
      onError: (msg) => setStatus(`Voz: ${msg}`)
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
    memoryRef.current = memory
  }, [memory])

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

  // Colmeia: reflete em tempo real o que cada subagente está fazendo. Workers
  // ativos voltam a "idle" sozinhos depois de um tempo sem atualização (visual).
  useEffect(() => {
    const off = window.ares.chat.onHive((status) => {
      setHiveWorkers((ws) => mergeHiveStatus(ws, status))
    })
    const settle = setInterval(() => {
      setHiveWorkers((ws) =>
        ws.some((w) => (w.phase === 'done' || w.phase === 'error') && Date.now() - w.updatedAt > 12_000)
          ? ws.map((w) =>
              (w.phase === 'done' || w.phase === 'error') && Date.now() - w.updatedAt > 12_000
                ? { ...w, phase: 'idle' as const }
                : w
            )
          : ws
      )
    }, 4000)
    return () => {
      off()
      clearInterval(settle)
    }
  }, [])

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

  const stopSentinel = useCallback(async (id: string) => {
    const sid = currentSessionRef.current
    if (!sid) return
    await window.ares.sentinel.stop(sid, id)
    setSentinels((prev) => prev.filter((s) => s.id !== id))
  }, [])

  useEffect(() => {
    const sid = currentSessionId
    if (!sid) return

    window.ares.sentinel.list(sid).then((list) => {
      setSentinels(list)
    })

    const off = window.ares.sentinel.onEvent((event) => {
      if (event.sessionId !== sid) return

      if (event.type === 'started') {
        setSentinels((prev) => {
          if (prev.some((s) => s.id === event.sentinelId)) return prev
          return [
            ...prev,
            {
              id: event.sentinelId,
              command: event.command,
              path: event.path,
              sessionId: event.sessionId,
              status: 'running',
              buffer: ''
            }
          ]
        })
      } else if (event.type === 'stopped') {
        setSentinels((prev) => prev.filter((s) => s.id !== event.sentinelId))
      } else if (event.type === 'error') {
        setSentinels((prev) =>
          prev.map((s) =>
            s.id === event.sentinelId ? { ...s, status: 'error' } : s
          )
        )

        showToast(`Sentinela "${event.command}": ${event.rootCause}`)

        const cfg = configRef.current
        const sentinelVoice = cfg?.ui.sentinelVoice ?? 'voz'
        if (event.speak && sentinelVoice === 'voz' && cfg?.tts.enabled) {
          enqueueSentence(
            `Atenção: erro no processo ${event.command.slice(0, 15)}. Causa raiz: ${event.rootCause}. Deseja que eu acione o depurador Prometeu?`,
            voiceOpts()
          )
        }
      } else if (event.type === 'recovered') {
        setSentinels((prev) =>
          prev.map((s) =>
            s.id === event.sentinelId ? { ...s, status: 'recovered' } : s
          )
        )

        showToast(`Sentinela "${event.command}" recuperada.`)

        const cfg = configRef.current
        const sentinelVoice = cfg?.ui.sentinelVoice ?? 'voz'
        if (sentinelVoice === 'voz' && cfg?.tts.enabled) {
          enqueueSentence('O processo voltou ao normal, senhor.', voiceOpts())
        }
      } else if (event.type === 'chunk') {
        setSentinels((prev) =>
          prev.map((s) => {
            if (s.id !== event.sentinelId) return s
            let newBuf = s.buffer + event.chunk
            if (newBuf.length > 50000) {
              newBuf = newBuf.slice(-50000)
            }
            return { ...s, buffer: newBuf }
          })
        )
      }
    })

    return off
  }, [currentSessionId, showToast, voiceOpts])

  // HUD de progresso de tarefas longas vindas do processo main.
  useEffect(() => {
    const off = window.ares.chat.onTaskProgress((event) => {
      setTaskProgress((current) => mergeTaskProgress(current, event))
    })
    return off
  }, [])

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
    // Corre o watcher CONTRA a fila de fala: se o watcher não resolver por qualquer
    // motivo (mic revogado, timer suspenso em background), o fim da fala destrava o
    // turno mesmo assim — antes, o await pendurado deixava o Ares "ocupado" para sempre.
    const interrupted = await Promise.race([
      audio
        .watchForSpeech({
          threshold: bargeInThreshold(sens),
          sustainMs: 350,
          shouldStop: () => finished
        })
        .catch(() => false), // mic indisponível não pode derrubar o turno
      idle.then(() => false)
    ])
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
      let queuedSpeech = false
      const queuedSpeechByPhase: Record<number, boolean> = {}
      const opts = voiceOpts()

      const queueSpeech = (text: string): void => {
        if (!speaking) {
          speaking = true
          setAresState('speaking')
        }
        queuedSpeech = true
        queuedSpeechByPhase[phase] = true
        enqueueSentence(text, opts)
      }

      const flush = (final: boolean): void => {
        if (!speak) {
          sentenceBuf = ''
          return
        }
        // eager: nada foi falado nesta fase ainda -> corta a primeira oração na vírgula
        // para a voz começar mais cedo (menor latência percebida).
        const { sentences, rest } = splitSentences(sentenceBuf, final, { eager: !queuedSpeechByPhase[phase] })
        sentenceBuf = rest
        for (const s of sentences) {
          queueSpeech(s)
        }
      }

      let staleTimer: ReturnType<typeof setTimeout> | null = null
      const clearStaleTimer = (): void => {
        if (staleTimer) { clearTimeout(staleTimer); staleTimer = null }
      }

      const off = window.ares.chat.onDelta(({ chunk, phase: ph, kind = 'both', done }) => {
        if (ph !== phase) {
          // Fase nova: o texto exibido continua sendo o transcript canonico.
          // Finaliza o buffer pendente, sem descartar fala que corresponde a texto visivel.
          clearStaleTimer()
          flush(true)
          phase = ph
          sentenceBuf = ''
        }
        // 'speak' legado/excepcional: fala sem alterar a tela.
        if (kind !== 'speak') {
          display += chunk
          const current = display
          setConversation((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: current } : m)))
        }
        // 'display' legado/excepcional: tela sem entrar na fila de fala.
        if (speak && kind !== 'display') {
          sentenceBuf += chunk
          flush(false)
          // Stale buffer flush: when the model pauses for tool execution, text
          // sits unspoken for 15+ seconds. Force-flush after 2.5s of silence.
          clearStaleTimer()
          if (sentenceBuf.trim()) {
            staleTimer = setTimeout(() => {
              staleTimer = null
              if (sentenceBuf.trim()) {
                const text = sentenceBuf.trim()
                sentenceBuf = ''
                if (/[\p{L}\p{N}]/u.test(text)) queueSpeech(text)
              }
            }, 2500)
          }
        }
        if (done) {
          clearStaleTimer()
          flush(true)
        }
      })
      const offActivity = window.ares.chat.onActivity((activity) => {
        setConversation((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, activities: mergeActivityEvent(m.activities, activity) } : m
          )
        )
      })

      try {
        const result = await window.ares.chat.ask(sid, userText, voice)
        off()
        offActivity()
        clearStaleTimer()
        setTaskProgress(null)
        flush(true) // fala o restante do buffer
        boardRef.current = result.board
        setBoardState(result.board)
        setMemory(result.memory)
        setEvents(result.events)
        setLists(result.lists)
        setQuickNotes(result.quickNotes)
        setReminders(result.reminders)
        // Mudança de cérebro por voz (ia.raciocinio/ia.modelo) reflete nos seletores na hora.
        if (result.config) {
          configRef.current = result.config
          setConfig(result.config)
        }
        setConversation((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: result.fala, pending: false } : m))
        )
        // A fase final pode ser 2, 3 ou 4 (o agente encadeia rodadas de ferramentas);
        // o fallback de voz olha a ÚLTIMA fase vista no streaming.
        const fallbackSpeech = finalSpeechFallback(result, queuedSpeech, !!queuedSpeechByPhase[phase])
        if (speak && fallbackSpeech) queueSpeech(fallbackSpeech)
        if (result.notes.length) showToast(result.notes.join('   ·   '))
        await refreshSessions()
        void refreshWidgets()
        // Auto-extração de fatos: roda em segundo plano para não atrasar a fala.
        if (configRef.current?.memory.autoExtract) {
          const oldMem = memoryRef.current || []
          void window.ares.memory
            .autoExtract(sid)
            .then((newMem) => {
              setMemory(newMem)
              const added = newMem.filter((nf) => !oldMem.some((of) => of.id === nf.id))
              if (added.length > 0) {
                const first = added[0]
                const textSnippet = first.text.length > 30 ? first.text.slice(0, 30) + '...' : first.text
                const msg = (
                  <span className="flex items-center gap-2">
                    🧠 Memorizado: "{textSnippet}"
                    <button
                      className="ml-2 font-semibold text-cyan-300 hover:text-cyan-100 underline focus:outline-none"
                      onClick={async (e) => {
                        e.stopPropagation()
                        const updated = await window.ares.memory.remove(first.id)
                        setMemory(updated)
                        showToast('Memória desfeita')
                      }}
                    >
                      Desfazer
                    </button>
                  </span>
                )
                showToast(msg)
              }
            })
            .catch(() => {})
        }
        busyRef.current = false
        if (speak && queuedSpeech) {
          const speechDone = waitForSpeechWithBargeIn()
            .catch((e) => setStatus(`Voz: ${errMsg(e)}`))
            .finally(() => {
              if (!busyRef.current && (aresStateRef.current === 'speaking' || aresStateRef.current === 'thinking')) {
                setAresState('idle')
              }
            })
          // No modo contínuo por voz, ainda esperamos a fala para evitar auto-escuta.
          if (viaVoice && continuousRef.current) await speechDone
        } else {
          setAresState('idle')
        }
      } catch (e) {
        off()
        offActivity()
        clearStaleTimer()
        setTaskProgress(null)
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
      // Apertou para falar = quer ser ouvido AGORA: corta qualquer fala em curso,
      // senão a gravação compete com a voz do Ares (e o usuário acha que não foi ouvido).
      clearSpeechQueue()
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
      // Clique no microfone da orbe = quer falar agora: silencia o Ares primeiro.
      clearSpeechQueue()
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

  // Escuta o microfone ENQUANTO o Ares trabalha (programa, roda build/testes ou fala
  // a resposta): "para/cancela" aborta a execução na hora; qualquer outro pedido entra
  // na fila e roda assim que a tarefa terminar. É o que mantém a conversa contínua viva
  // durante tarefas longas, em vez de o microfone ficar surdo até o fim.
  const listenWhileBusy = useCallback(async (): Promise<void> => {
    const cfg = configRef.current
    if (cfg?.ui.bargeIn === false) {
      await new Promise((r) => setTimeout(r, 200))
      return
    }
    try {
      const res = await audio.recordUntilSilence({
        shouldStop: () => !busyRef.current || !continuousRef.current,
        // Limiar mais alto que a escuta normal: com echoCancellation, a própria voz do
        // Ares some; isto filtra ruído ambiente para não transcrever à toa.
        threshold: Math.max(0.09, micThreshold() * 2),
        silenceMs: 900,
        maxWaitMs: 6000,
        maxMs: 12000
      })
      if (!res.spoke || !continuousRef.current) return
      const text = (await transcribeBlob(res.blob, res.mimeType)).trim()
      if (!text || !busyRef.current) {
        // A tarefa acabou enquanto transcrevia: trata como comando normal da fila.
        if (text) pendingVoiceCmdRef.current = text
        return
      }
      const intent = interpretBusySpeech(text, cfg?.ui.wakeWord || 'ares', !!cfg?.ui.wakeWordEnabled)
      if (intent.kind === 'cancel') {
        clearSpeechQueue()
        const sid = currentSessionRef.current
        if (sid) void window.ares.code?.cancel(sid)
        pendingVoiceCmdRef.current = null
        setStatus('Cancelado por voz.')
        showToast('execução cancelada por voz')
      } else if (intent.kind === 'command') {
        pendingVoiceCmdRef.current = intent.text
        setStatus(`Anotado: "${intent.text}" — executo ao terminar a tarefa atual.`)
        showToast('comando na fila para depois da tarefa')
      }
    } catch {
      // Microfone indisponível neste instante: espera um pouco para não travar o loop.
      await new Promise((r) => setTimeout(r, 300))
    }
  }, [micThreshold, transcribeBlob, showToast])

  const continuousLoop = useCallback(async () => {
    if (loopRef.current) return
    loopRef.current = true
    try {
      while (continuousRef.current) {
        if (busyRef.current) {
          await listenWhileBusy()
          continue
        }
        // Comando captado durante a tarefa anterior: executa antes de voltar a ouvir.
        const queued = pendingVoiceCmdRef.current
        if (queued) {
          pendingVoiceCmdRef.current = null
          setStatus('')
          await runTurn(queued, true)
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
  }, [runTurn, transcribeBlob, micThreshold, speakText, listenWhileBusy])

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
    async (text = 'Ares online. Respostas formais, precisas e com voz mais clara.') => {
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
    async (id: string, patch: { text?: string; category?: MemoryCategory; status?: 'active' | 'probationary' | 'archived' }) => {
      setMemory(await window.ares.memory.update(id, patch))
    },
    []
  )

  const approveMemory = useCallback(async (id: string) => {
    // Mantido como no-op para retrocompatibilidade
  }, [])

  const resolveMemory = useCallback(async (id: string, action: MemoryContradictionAction) => {
    setMemory(await window.ares.memory.resolve(id, action))
    showToast('conflito de memoria resolvido')
  }, [showToast])

  const removeMemory = useCallback(async (id: string, createAntiFact?: boolean) => {
    setMemory(await window.ares.memory.remove(id, createAntiFact))
  }, [])

  const consolidateMemory = useCallback(async () => {
    const res = await window.ares.memory.consolidate()
    setMemory(await window.ares.memory.load())
    return res
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
    // Também aborta qualquer comando/build/coder em execução nesta sessão.
    const sid = currentSessionRef.current
    if (sid) void window.ares.code?.cancel(sid)
    if (!busyRef.current) setAresState('idle')
  }, [])
  const clearError = useCallback(() => setError(null), [])

  // Esc interrompe a fala E qualquer execução em andamento (parar build travado).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && (aresStateRef.current === 'speaking' || busyRef.current)) stopSpeaking()
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
    hiveWorkers,
    taskProgress ,
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
    resolveMemory,
    removeMemory,
    consolidateMemory,
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
    finishOnboarding,
    sentinels,
    stopSentinel
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>

}
