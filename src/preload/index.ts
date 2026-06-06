import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentTurnResult,
  AppConfig,
  AresState,
  DeepPartial,
  BriefingData,
  Board,
  CalendarEvent,
  ChatSession,
  Checklist,
  DiagnosticsResult,
  MemoryCategory,
  MemoryFact,
  NewsItem,
  Note,
  Recurrence,
  Reminder,
  ReverseGeocodeResult,
  SessionMeta,
  SystemMetrics,
  TtsStatus,
  UserLocation,
  WeatherResult
} from '../shared/types'

// API segura exposta ao renderer como window.ares.
// O React nunca recebe Node/Electron cru, só estas funções IPC tipadas.
const api = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    update: (patch: DeepPartial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:update', patch)
  },
  tasks: {
    load: (): Promise<Board> => ipcRenderer.invoke('tasks:load'),
    save: (board: Board): Promise<boolean> => ipcRenderer.invoke('tasks:save', board)
  },
  memory: {
    load: (): Promise<MemoryFact[]> => ipcRenderer.invoke('memory:load'),
    add: (text: string, category?: MemoryCategory): Promise<MemoryFact[]> =>
      ipcRenderer.invoke('memory:add', text, category),
    update: (
      id: string,
      patch: { text?: string; category?: MemoryCategory; status?: 'active' | 'pending' }
    ): Promise<MemoryFact[]> => ipcRenderer.invoke('memory:update', id, patch),
    approve: (id: string): Promise<MemoryFact[]> => ipcRenderer.invoke('memory:approve', id),
    remove: (id: string): Promise<MemoryFact[]> => ipcRenderer.invoke('memory:remove', id),
    autoExtract: (sessionId: string): Promise<MemoryFact[]> => ipcRenderer.invoke('memory:autoExtract', sessionId)
  },
  calendar: {
    load: (): Promise<CalendarEvent[]> => ipcRenderer.invoke('calendar:load'),
    add: (event: {
      title: string
      whenISO: string
      description?: string
      remindMinutes?: number
      recurrence?: CalendarEvent['recurrence']
    }): Promise<CalendarEvent[]> => ipcRenderer.invoke('calendar:add', event),
    remove: (id: string): Promise<CalendarEvent[]> => ipcRenderer.invoke('calendar:remove', id),
    save: (events: CalendarEvent[]): Promise<CalendarEvent[]> => ipcRenderer.invoke('calendar:save', events)
  },
  sessions: {
    list: (): Promise<SessionMeta[]> => ipcRenderer.invoke('sessions:list'),
    get: (id: string): Promise<ChatSession | null> => ipcRenderer.invoke('sessions:get', id),
    create: (title?: string): Promise<ChatSession> => ipcRenderer.invoke('sessions:create', title),
    rename: (id: string, title: string): Promise<void> => ipcRenderer.invoke('sessions:rename', id, title),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('sessions:delete', id)
  },
  stt: {
    transcribe: (audio: ArrayBuffer, mimeType: string): Promise<string> =>
      ipcRenderer.invoke('stt:transcribe', audio, mimeType)
  },
  chat: {
    ask: (sessionId: string, text: string, voice = false): Promise<AgentTurnResult> =>
      ipcRenderer.invoke('chat:ask', { sessionId, text, voice }),
    // Recebe a "fala" em pedaços enquanto o LLM gera. phase muda (1→2) quando há
    // ferramentas e a resposta final começa (sinal para reiniciar exibição/fala).
    onDelta: (cb: (data: { chunk: string; phase: number }) => void): (() => void) => {
      const listener = (_e: unknown, data: { chunk: string; phase: number }) => cb(data)
      ipcRenderer.on('chat:delta', listener)
      return () => ipcRenderer.removeListener('chat:delta', listener)
    }
  },
  briefing: {
    get: (): Promise<BriefingData> => ipcRenderer.invoke('briefing:get')
  },
  diagnostics: {
    get: (): Promise<DiagnosticsResult> => ipcRenderer.invoke('diagnostics:get')
  },
  lists: {
    load: (): Promise<Checklist[]> => ipcRenderer.invoke('lists:load'),
    save: (lists: Checklist[]): Promise<Checklist[]> => ipcRenderer.invoke('lists:save', lists)
  },
  notes: {
    load: (): Promise<Note[]> => ipcRenderer.invoke('notes:load'),
    add: (text: string): Promise<Note[]> => ipcRenderer.invoke('notes:add', text),
    remove: (id: string): Promise<Note[]> => ipcRenderer.invoke('notes:remove', id)
  },
  reminders: {
    load: (): Promise<Reminder[]> => ipcRenderer.invoke('reminders:load'),
    add: (r: { text: string; whenISO: string; recurrence?: Recurrence; kind?: Reminder['kind'] }): Promise<Reminder[]> =>
      ipcRenderer.invoke('reminders:add', r),
    remove: (id: string): Promise<Reminder[]> => ipcRenderer.invoke('reminders:remove', id),
    save: (rs: Reminder[]): Promise<Reminder[]> => ipcRenderer.invoke('reminders:save', rs),
    // Notificação local disparada (tarefa/evento/lembrete) para a UI reagir e falar.
    onFired: (cb: (data: { prefix: string; title: string; body: string }) => void): (() => void) => {
      const listener = (_e: unknown, data: { prefix: string; title: string; body: string }) => cb(data)
      ipcRenderer.on('reminder:fired', listener)
      return () => ipcRenderer.removeListener('reminder:fired', listener)
    }
  },
  data: {
    export: (): Promise<{ ok: boolean; path?: string; error?: string }> => ipcRenderer.invoke('data:export'),
    import: (): Promise<{ ok: boolean; restored?: number; error?: string }> => ipcRenderer.invoke('data:import')
  },
  tts: {
    synthesize: (text: string, opts: { voice?: string; rate?: number }): Promise<ArrayBuffer> =>
      ipcRenderer.invoke('tts:synthesize', text, opts),
    status: (): Promise<TtsStatus> => ipcRenderer.invoke('tts:status')
  },
  weather: {
    get: (city: string): Promise<WeatherResult> => ipcRenderer.invoke('weather:get', city),
    getCurrent: (location: UserLocation): Promise<WeatherResult> => ipcRenderer.invoke('weather:getCurrent', location)
  },
  location: {
    reverse: (latitude: number, longitude: number): Promise<ReverseGeocodeResult> =>
      ipcRenderer.invoke('location:reverse', latitude, longitude)
  },
  news: {
    get: (topic: string): Promise<NewsItem[]> => ipcRenderer.invoke('news:get', topic)
  },
  system: {
    platform: process.platform,
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('system:openExternal', url),
    metrics: (): Promise<SystemMetrics> => ipcRenderer.invoke('metrics:get'),
    readClipboard: (): Promise<{ texto: string; vazio: boolean }> => ipcRenderer.invoke('clipboard:read'),
    setGlobalShortcut: (enabled: boolean): Promise<AppConfig> => ipcRenderer.invoke('system:setGlobalShortcut', enabled),
    setAutostart: (enabled: boolean): Promise<AppConfig> => ipcRenderer.invoke('system:setAutostart', enabled),
    testBrain: (): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke('brain:test'),
    // Bandeja "Briefing do dia" pede para abrir o briefing na janela principal.
    onBriefing: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('shortcut:briefing', listener)
      return () => ipcRenderer.removeListener('shortcut:briefing', listener)
    }
  },
  overlay: {
    // Liga/desliga a mini-orbe flutuante; devolve a config atualizada.
    set: (enabled: boolean): Promise<AppConfig> => ipcRenderer.invoke('overlay:set', enabled),
    // Janela principal envia seu estado para a orbe flutuante refletir.
    pushState: (state: AresState): Promise<boolean> => ipcRenderer.invoke('overlay:pushState', state),
    focusMain: (): Promise<boolean> => ipcRenderer.invoke('overlay:focusMain'),
    command: (): Promise<boolean> => ipcRenderer.invoke('overlay:command'),
    // Orbe flutuante recebe o estado para animar.
    onState: (cb: (state: AresState) => void): (() => void) => {
      const listener = (_e: unknown, state: AresState) => cb(state)
      ipcRenderer.on('overlay:state', listener)
      return () => ipcRenderer.removeListener('overlay:state', listener)
    },
    // Janela principal recebe o pedido de "ouvir agora" vindo da orbe flutuante.
    onListen: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('overlay:listen', listener)
      return () => ipcRenderer.removeListener('overlay:listen', listener)
    }
  }
}

contextBridge.exposeInMainWorld('ares', api)

export type AresApi = typeof api
