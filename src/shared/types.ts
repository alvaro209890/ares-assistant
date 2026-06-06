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
    hermes: {
      enabled: boolean
      baseUrl: string
      messagePath: string // rota de comando do Hermes
      codePath: string // rota dedicada para tarefas de programação
      healthPath: string // rota de status/ping do Hermes
      apiKey: string // token opcional da ponte
      authHeader: string // cabeçalho usado quando apiKey existir
      timeoutMs: number
      responsePath: string // caminho opcional da resposta, ex.: data.reply
    }
    code: {
      enabled: boolean // ferramentas locais read-only de programação
      workspaceRoot: string // workspace padrão para leitura/busca
      allowedRoots: string[] // raízes permitidas para análise
      maxFileKB: number
      maxSearchResults: number
      maxContextChars: number
      allowedCommands: string[]
      commandTimeoutMs: number
      allowPatchApply: boolean
      indexMaxFiles: number
      terminalEnabled: boolean // habilita o terminal completo (shell) com autorização
      terminalAutoApprove: boolean // true = roda comandos "confirm" sem pedir (avançado)
      terminalSafe: string[] // prefixos de comando que rodam direto, sem autorização
    }
    control: {
      enabled: boolean // controle do computador por voz (abrir apps, volume, bloquear, captura)
      screenshotDir: string // pasta onde salvar capturas de tela
    }
  }
  ui: {
    continuousMode: boolean
    micSensitivity: number // 0..1 — quanto maior, mais sensível o microfone
    silenceMs: number // tempo de silêncio (ms) para encerrar a fala no modo contínuo
    postSpeechPauseMs: number // pausa após o Ares falar antes de voltar a ouvir
    proactiveSuggestions: boolean // sugestões proativas discretas no briefing/assistente
    wakeWord: string // palavra de ativação (ex.: "ares")
    wakeWordEnabled: boolean // na conversa contínua, só age se ouvir a palavra de ativação
    bargeIn: boolean // permite interromper a fala do Ares falando por cima (conversa contínua)
    overlayEnabled: boolean // mini-orbe flutuante (always-on-top)
    onboarded: boolean // primeiro uso já concluído
    userName: string // como o Ares chama o usuário
    fontScale: number // 0.85..1.5 — acessibilidade
    highContrast: boolean // alto contraste
    simpleMode: boolean // visão reduzida (menos HUD)
    autostart: boolean // iniciar com o sistema (efetivo após empacotar)
    globalShortcut: boolean // atalho global para chamar o Ares
    morningBriefing: boolean // falar o briefing ao abrir (1x por dia)
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

// --- Listas simples (compras/afazeres) ---
export interface ListItem {
  id: string
  text: string
  done: boolean
}
export interface Checklist {
  id: string
  title: string
  items: ListItem[]
  createdAt: number
}

// --- Notas rápidas ---
export interface Note {
  id: string
  text: string
  createdAt: number
}

// --- Lembretes (remédio/rotina, timer, despertador) ---
export interface Reminder {
  id: string
  text: string
  whenISO: string // quando disparar
  recurrence?: Recurrence // diário/semanal/mensal (rotina/remédio)
  kind: 'reminder' | 'timer' | 'alarm' // origem (para rótulo/UI)
  fired?: boolean
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
  lists: Checklist[]
  quickNotes: Note[]
  reminders: Reminder[]
  notes: string[] // log curto das ações aplicadas (para toast)
  changedBoard: boolean
}

// --- Programação / código ---
export interface CodeWorkspaceSummary {
  root: string
  name: string
  exists: boolean
  git?: {
    branch: string
    dirty: boolean
    status: string[]
  }
  packageManager?: string
  scripts?: Record<string, string>
  languages: Record<string, number>
  files: string[]
  ignored: string[]
  hints: string[]
}

export interface CodeSearchMatch {
  file: string
  line: number
  text: string
}

export interface CodeFileSnippet {
  file: string
  startLine: number
  endLine: number
  totalLines: number
  truncated: boolean
  content: string
}

export interface CodeHermesResult {
  reply: string
  endpoint: string
  status: number
  latencyMs: number
  sessionId?: string
  fallback?: boolean
  structured?: unknown
}

export interface CodeCommandResult {
  root: string
  command: string
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  durationMs: number
}

// Camada de segurança do terminal: cada comando é classificado antes de rodar.
export type CommandTier = 'allowed' | 'confirm' | 'blocked'

export interface CommandClassification {
  tier: CommandTier
  reason: string
}

export interface CodeTerminalResult {
  root: string
  command: string
  tier: CommandTier
  requiresApproval: boolean // true = não executou; aguardando autorização do usuário
  ran: boolean
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  durationMs: number
  reason: string // motivo do bloqueio ou da necessidade de confirmação
}

export interface CodePatchPreview {
  root: string
  files: string[]
  additions: number
  deletions: number
  canApply: boolean
  warnings: string[]
}

export interface CodePatchApplyResult extends CodePatchPreview {
  applied: boolean
  output: string
}

export interface CodeProjectIndex {
  root: string
  generatedAt: number
  fileCount: number
  files: Array<{ file: string; language: string; bytes: number; lines: number; exports: string[] }>
  scripts?: Record<string, string>
  git?: CodeWorkspaceSummary['git']
}

// --- Controle do computador (desktop actions, estilo JARVIS) ---
export interface DesktopActionResult {
  ok: boolean
  action: 'abrir' | 'volume' | 'bloquear' | 'captura' | 'clipboard'
  detail: string // texto curto e falável do resultado
  target?: string // alvo aberto/arquivo salvo
  value?: number // ex.: percentual de volume
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
export interface HermesStatus extends ServiceStatus {
  enabled: boolean
  baseUrl: string
  messagePath: string
  codePath: string
  healthPath: string
  timeoutMs: number
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
  hermes: HermesStatus
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

// --- Telemetria do sistema (HUD estilo JARVIS) ---
export interface SystemMetrics {
  cpuPercent: number // uso de CPU desde a última leitura (0..100)
  memPercent: number // memória usada (0..100)
  memUsedGB: number
  memTotalGB: number
  uptimeSec: number // tempo ligado do computador
  loadAvg1: number // carga média de 1 min (Linux/macOS)
  cores: number
  hostname: string
  platform: string
}
