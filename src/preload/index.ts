import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentTurnResult,
  AppConfig,
  Board,
  CalendarEvent,
  ChatSession,
  MemoryFact,
  NewsItem,
  SessionMeta,
  TtsStatus,
  WeatherResult
} from '../shared/types'

// API segura exposta ao renderer como window.ares.
// O React nunca recebe Node/Electron cru, só estas funções IPC tipadas.
const api = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    update: (patch: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:update', patch)
  },
  tasks: {
    load: (): Promise<Board> => ipcRenderer.invoke('tasks:load'),
    save: (board: Board): Promise<boolean> => ipcRenderer.invoke('tasks:save', board)
  },
  memory: {
    load: (): Promise<MemoryFact[]> => ipcRenderer.invoke('memory:load'),
    add: (text: string): Promise<MemoryFact[]> => ipcRenderer.invoke('memory:add', text),
    remove: (id: string): Promise<MemoryFact[]> => ipcRenderer.invoke('memory:remove', id)
  },
  calendar: {
    load: (): Promise<CalendarEvent[]> => ipcRenderer.invoke('calendar:load'),
    add: (event: { title: string; whenISO: string; description?: string }): Promise<CalendarEvent[]> =>
      ipcRenderer.invoke('calendar:add', event),
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
    ask: (sessionId: string, text: string): Promise<AgentTurnResult> =>
      ipcRenderer.invoke('chat:ask', { sessionId, text })
  },
  tts: {
    synthesize: (text: string, opts: { voice?: string; rate?: number }): Promise<ArrayBuffer> =>
      ipcRenderer.invoke('tts:synthesize', text, opts),
    status: (): Promise<TtsStatus> => ipcRenderer.invoke('tts:status')
  },
  weather: {
    get: (city: string): Promise<WeatherResult> => ipcRenderer.invoke('weather:get', city)
  },
  news: {
    get: (topic: string): Promise<NewsItem[]> => ipcRenderer.invoke('news:get', topic)
  },
  reminders: {
    onFired: (cb: (data: { prefix: string; title: string; body: string }) => void): (() => void) => {
      const listener = (_e: unknown, data: { prefix: string; title: string; body: string }) => cb(data)
      ipcRenderer.on('reminder:fired', listener)
      return () => ipcRenderer.removeListener('reminder:fired', listener)
    }
  },
  system: { platform: process.platform }
}

contextBridge.exposeInMainWorld('ares', api)

export type AresApi = typeof api
