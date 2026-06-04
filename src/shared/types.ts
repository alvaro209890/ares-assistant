// Tipos compartilhados entre o processo main (Electron) e o renderer (React).

// Patch parcial em profundidade (para atualizar config de forma aninhada via deepMerge).
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

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
    location: UserLocation // localização aproximada local, com permissão do usuário
  }
  ui: {
    continuousMode: boolean
    micSensitivity: number // 0..1 — quanto maior, mais sensível o microfone
    silenceMs: number // tempo de silêncio (ms) para encerrar a fala no modo contínuo
    postSpeechPauseMs: number // pausa após o Ares falar antes de voltar a ouvir
    proactiveSuggestions: boolean // sugestões proativas discretas no briefing/assistente
    wakeWord: string // palavra de ativação (ex.: "ares")
    wakeWordEnabled: boolean // na conversa contínua, só age se ouvir a palavra de ativação
    overlayEnabled: boolean // mini-orbe flutuante (always-on-top)
  }
  memory: {
    autoExtract: boolean // extrair fatos úteis da conversa automaticamente
    autoApprove: boolean // true = salva direto; false = fica pendente para revisão
  }
}

export interface UserLocation {
  enabled: boolean
  latitude?: number
  longitude?: number
  accuracy?: number
  city?: string
  region?: string
  country?: string
  label?: string
  updatedAt?: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type CardColor = 'cyan' | 'blue' | 'green' | 'amber' | 'pink'
export type Priority = 'baixa' | 'media' | 'alta'

// Recorrência usada por tarefas e eventos.
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface Subtask {
  id: string
  text: string
  done: boolean
}

export interface CardLink {
  label: string
  url: string // pode ser http(s):// ou file:// (link local simples)
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
  labels?: string[] // etiquetas nomeadas (texto livre)
  links?: CardLink[] // anexos/links locais simples
  recurrence?: Recurrence // repetição ao concluir
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
export type MemoryCategory =
  | 'perfil'
  | 'preferencias'
  | 'rotina'
  | 'trabalho'
  | 'projetos'
  | 'restricoes'
  | 'interesses'
  | 'outros'

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  'perfil',
  'preferencias',
  'rotina',
  'trabalho',
  'projetos',
  'restricoes',
  'interesses',
  'outros'
]

export const MEMORY_CATEGORY_LABEL: Record<MemoryCategory, string> = {
  perfil: 'Perfil',
  preferencias: 'Preferências',
  rotina: 'Rotina',
  trabalho: 'Trabalho',
  projetos: 'Projetos',
  restricoes: 'Restrições',
  interesses: 'Interesses',
  outros: 'Outros'
}

export interface MemoryFact {
  id: string
  text: string
  category: MemoryCategory // default 'outros'
  source: 'manual' | 'auto' // origem do fato
  status: 'active' | 'pending' // pending = aguardando revisão do usuário
  createdAt: number
  updatedAt?: number
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
  remindMinutes?: number // avisar X minutos antes (0/ausente = na hora)
  recurrence?: Recurrence // evento recorrente
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
export interface WeatherPeriod {
  key: 'manha' | 'tarde' | 'noite'
  label: string
  temp: number
  code: number
  desc: string
  precipProb: number
}
export interface WeatherResult {
  city: string
  source: string // ex.: "Open-Meteo"
  updatedAt: number // epoch ms da consulta
  latitude?: number
  longitude?: number
  current: {
    temp: number
    feels: number
    code: number
    desc: string
    wind: number
    humidity: number
    precipProb: number
  }
  today: { min: number; max: number; precipProb: number }
  periods: WeatherPeriod[] // manhã, tarde, noite (quando disponível)
  alert?: string // alerta simples (chuva forte, vento, calor/frio extremo)
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

// --- Briefing do dia ---
export interface BriefingTask {
  id: string
  title: string
  due?: string
  priority?: Priority
}
export interface BriefingData {
  generatedAt: number
  greeting: string
  dateLabel: string
  weather: WeatherResult | null
  weatherError?: string
  todayEvents: { id: string; title: string; whenISO: string; description?: string }[]
  overdueTasks: BriefingTask[]
  upcomingTasks: BriefingTask[]
  reminders: { id: string; title: string; reminderAt?: string }[]
  news: NewsItem[]
  suggestions: string[]
}

// --- Diagnóstico / Sistema ---
export interface ServiceStatus {
  ok: boolean
  detail: string
}
export interface DataFileInfo {
  name: string
  path: string
  exists: boolean
  sizeKB: number
}
export interface DiagnosticsResult {
  app: { name: string; version: string; platform: string; electron: string; node: string; chrome: string }
  userDataPath: string
  nineRouter: ServiceStatus & { baseUrl: string; model: string }
  groq: ServiceStatus & { configured: boolean }
  piper: { ready: boolean; voices: string[] }
  location: UserLocation
  dataFiles: DataFileInfo[]
}

export interface ReverseGeocodeResult {
  city?: string
  region?: string
  country?: string
  label: string
}
