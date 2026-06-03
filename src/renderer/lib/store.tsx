import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type {
  AppConfig,
  Board,
  CalendarEvent,
  ChatSession,
  AresState,
  MemoryFact,
  SessionMeta,
  TtsStatus,
  UserLocation,
  WeatherResult
} from '../../shared/types'
import * as audio from './audio'
import { cancelSpeech, loadVoices, speak } from './tts'

export interface ConvMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
}

type Screen = 'assistant' | 'tasks' | 'calendar' | 'memory'

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
  voices: SpeechSynthesisVoice[]
  piper: TtsStatus | null
  weather: WeatherResult | null
  recording: boolean
  continuous: boolean
  settingsOpen: boolean
  error: string | null
  status: string
  actionToast: string | null

  navigate: (s: Screen) => void
  openSettings: (b: boolean) => void
  saveConfig: (patch: Partial<AppConfig>) => Promise<void>
  setBoard: (updater: Board | ((b: Board) => Board)) => void
  sendText: (text: string) => Promise<void>
  beginPushToTalk: () => Promise<void>
  endPushToTalk: () => Promise<void>
  toggleContinuous: () => void
  clearError: () => void
  locateUser: () => Promise<void>
  testVoice: (text?: string) => Promise<void>
  refreshWidgets: () => Promise<void>
  createSession: () => Promise<void>
  openSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  addMemory: (text: string) => Promise<void>
  removeMemory: (id: string) => Promise<void>
  addEvent: (event: { title: string; whenISO: string; description?: string }) => Promise<void>
  removeEvent: (id: string) => Promise<void>
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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [piper, setPiper] = useState<TtsStatus | null>(null)
  const [weather, setWeather] = useState<WeatherResult | null>(null)
  const [recording, setRecording] = useState(false)
  const [continuous, setContinuous] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [actionToast, setActionToast] = useState<string | null>(null)

  const configRef = useRef<AppConfig | null>(null)
  const boardRef = useRef<Board>(emptyBoard)
  const currentSessionRef = useRef<string | null>(null)
  const continuousRef = useRef(false)
  const recordingRef = useRef(false)
  const busyRef = useRef(false)
  const loopRef = useRef(false)
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
    try {
      const loc = cfg.integrations.location
      const hasLocation = loc.enabled && typeof loc.latitude === 'number' && typeof loc.longitude === 'number'
      setWeather(hasLocation ? await window.ares.weather.getCurrent(loc) : await window.ares.weather.get(cfg.integrations.weatherCity))
    } catch {
      setWeather(null)
    }
  }, [])

  const speakText = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      const cfg = configRef.current
      if (!cfg?.tts.enabled || !text.trim()) {
        setAresState('idle')
        return resolve()
      }
      setAresState('speaking')
      void speak(text, {
        engine: cfg.tts.engine,
        piperVoice: cfg.tts.piperVoice,
        voiceURI: cfg.tts.webVoiceURI,
        rate: cfg.tts.rate,
        pitch: cfg.tts.pitch,
        volume: cfg.tts.volume,
        onEnd: () => {
          setAresState('idle')
          resolve()
        },
        onError: (m) => {
          setStatus(m)
          setAresState('idle')
          resolve()
        }
      })
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [cfg, b, vs, ps, mem, evs, list] = await Promise.all([
          window.ares.config.get(),
          window.ares.tasks.load(),
          loadVoices(),
          window.ares.tts.status(),
          window.ares.memory.load(),
          window.ares.calendar.load(),
          window.ares.sessions.list()
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

  const runTurn = useCallback(
    async (userText: string) => {
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
      const assistantId = uid('msg')
      setConversation((prev) => [
        ...prev,
        { id: uid('msg'), role: 'user', content: userText },
        { id: assistantId, role: 'assistant', content: '', pending: true }
      ])
      setAresState('thinking')

      try {
        const result = await window.ares.chat.ask(sid, userText)
        boardRef.current = result.board
        setBoardState(result.board)
        setMemory(result.memory)
        setEvents(result.events)
        setConversation((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: result.fala, pending: false } : m))
        )
        if (result.notes.length) showToast(result.notes.join('   ·   '))
        await refreshSessions()
        void refreshWidgets()
        await speakText(result.fala)
        busyRef.current = false
      } catch (e) {
        setConversation((prev) => prev.filter((m) => m.id !== assistantId))
        setError(errMsg(e))
        setAresState('idle')
        busyRef.current = false
      }
    },
    [refreshSessions, refreshWidgets, showToast, speakText]
  )

  const sendText = useCallback(
    async (text: string) => {
      const t = text.trim()
      if (t) await runTurn(t)
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
      await runTurn(text)
    } catch (e) {
      setError(errMsg(e))
      setAresState('idle')
    }
  }, [runTurn, transcribeBlob])

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
          res = await audio.recordUntilSilence({ shouldStop: () => !continuousRef.current })
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
          setStatus('')
          await runTurn(text)
          if (continuousRef.current) await new Promise((r) => setTimeout(r, 420))
        } else {
          setStatus('Não captei fala útil. Continuo ouvindo.')
        }
      }
    } finally {
      loopRef.current = false
      setRecording(false)
      if (!busyRef.current) setAresState('idle')
    }
  }, [runTurn, transcribeBlob])

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
    async (patch: Partial<AppConfig>) => {
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

  useEffect(() => {
    const loc = config?.integrations.location
    if (!ready || !loc?.enabled || typeof loc.latitude === 'number') return
    const timer = setTimeout(() => void locateUser(), 1200)
    return () => clearTimeout(timer)
  }, [ready, config?.integrations.location, locateUser])

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

  const addMemory = useCallback(async (text: string) => {
    const t = text.trim()
    if (!t) return
    setMemory(await window.ares.memory.add(t))
    showToast('memória atualizada')
  }, [showToast])

  const removeMemory = useCallback(async (id: string) => {
    setMemory(await window.ares.memory.remove(id))
  }, [])

  const addEvent = useCallback(async (event: { title: string; whenISO: string; description?: string }) => {
    setEvents(await window.ares.calendar.add(event))
  }, [])

  const removeEvent = useCallback(async (id: string) => {
    setEvents(await window.ares.calendar.remove(id))
  }, [])

  const navigate = useCallback((s: Screen) => setScreen(s), [])
  const openSettings = useCallback((b: boolean) => setSettingsOpen(b), [])
  const clearError = useCallback(() => setError(null), [])

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
    voices,
    piper,
    weather,
    recording,
    continuous,
    settingsOpen,
    error,
    status,
    actionToast,
    navigate,
    openSettings,
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
    createSession,
    openSession,
    renameSession,
    deleteSession,
    addMemory,
    removeMemory,
    addEvent,
    removeEvent
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
