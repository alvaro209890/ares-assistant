// Tipos compartilhados entre o processo main (Electron) e o renderer (React).

export interface AppConfig {
  nineRouter: { baseUrl: string; apiKey: string; model: string }
  grog: { baseUrl: string; apiKey: string; sttModel: string }
  tts: {
    enabled: boolean // false = Ares no mudo
    engine: 'auto' | 'piper' | 'web' // auto: Piper no Linux, Web Speech no Windows
    piperVoice: string // ex.: "pt_BR-faber-medium"
    webVoiceURI: string // voz do sistema (Web Speech)
    rate: number // 0.5..1.6
    pitch: number // 0.5..1.6 (só Web Speech)
    volume: number // 0..1
  }
  integrations: {
    weatherCity: string // cidade padrão (widget de clima)
    newsTopic: string // tema padrão de notícias ("" = manchetes gerais)
  }
  ui: { continuousMode: boolean }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type CardColor = 'cyan' | 'blue' | 'green' | 'amber' | 'pink'
export type Priority = 'baixa' | 'media' | 'alta'

export interface Subtask {
  id: string
  text: string
  done: boolean
}

export interface Card {
  id: string
  title: string
  description?: string
  color?: CardColor
  priority?: Priority
  due?: string // ISO datetime (prazo)
  reminderAt?: string // ISO datetime (lembrete)
  reminded?: boolean // já disparou a notificação
  subtasks?: Subtask[]
  done: boolean
  createdAt: number
}

export interface Column {
  id: string
  title: string
  cardIds: string[]
}

export interface Board {
  columns: Column[]
  cards: Record<string, Card>
}

// --- Memória ---
export interface MemoryFact {
  id: string
  text: string
  createdAt: number
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  summary?: string // resumo das mensagens antigas (controle de contexto)
  messages: StoredMessage[]
}

export interface SessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

// --- Calendário ---
export interface CalendarEvent {
  id: string
  title: string
  whenISO: string // ISO datetime
  description?: string
  reminded?: boolean
  createdAt: number
}

export type AresState = 'idle' | 'listening' | 'thinking' | 'speaking'

// --- Sistema de ações/ferramentas ---
// Envelope único que o LLM devolve a cada turno.
export interface Acao {
  tipo: string
  [campo: string]: unknown
}
export interface AgentEnvelope {
  fala: string
  acoes: Acao[]
}

// --- Resultados de ferramentas de consulta ---
export interface WeatherResult {
  city: string
  current: { temp: number; feels: number; code: number; desc: string; wind: number; humidity: number }
  today: { min: number; max: number; precipProb: number }
}
export interface NewsItem {
  title: string
  link: string
  source?: string
  published?: string
}
export interface WebResult {
  title: string
  snippet: string
  url: string
}

export interface AgentTurnResult {
  fala: string
  board: Board
  memory: MemoryFact[]
  events: CalendarEvent[]
  notes: string[]
  changedBoard: boolean
}

export interface TtsStatus {
  ready: boolean
  voices: string[]
  platform: string
}
