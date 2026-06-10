// Tipos compartilhados entre o processo main (Electron) e o renderer (React).

// Patch parcial em profundidade (para atualizar config de forma aninhada via deepMerge).
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

// Nível de esforço de raciocínio dos modelos que o suportam (DeepSeek V4, GPT-5.5).
// Mapeado para reasoning_effort low/medium/high na chamada da API.
export type ReasoningLevel = 'baixo' | 'medio' | 'alto'

export interface AppConfig {
  nineRouter: { baseUrl: string; apiKey: string; model: string; reasoning: ReasoningLevel }
  grog: { baseUrl: string; apiKey: string; sttModel: string }
  tts: {
    enabled: boolean // false = Ares no mudo
    engine: 'auto' | 'piper' | 'web' // auto: Piper no Linux/Windows, Web Speech de fallback
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
    code: {
      enabled: boolean // ferramentas locais de programação
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
    proactiveAlerts: boolean // avisos proativos de ambiente (bateria, evento chegando, vencidas)
    confirmDestructive: boolean // pedir confirmação antes de apagar/limpar/remover dados
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

export type MemoryTarget = 'user' | 'memory'

export interface MemoryFact {
  id: string
  text: string
  category: MemoryCategory // default 'outros'
  source: 'manual' | 'auto' // origem do fato
  status: 'active' | 'pending' // pending = aguardando revisão do usuário
  createdAt: number
  updatedAt?: number
  target?: MemoryTarget // user = perfil/preferências; memory = notas operacionais do agente
  confidence?: number // 0..1 para extrações automáticas
  evidence?: string[] // pequenos trechos que justificam a memória
  review?: 'ok' | 'possible_conflict' | 'low_confidence'
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
  falaVoz?: string // resumo seguro para TTS quando a fala exibida precisa ser completa/técnica
  board: Board
  memory: MemoryFact[]
  events: CalendarEvent[]
  lists: Checklist[]
  quickNotes: Note[]
  reminders: Reminder[]
  notes: string[] // log curto das ações aplicadas (para toast)
  changedBoard: boolean
  config?: AppConfig // presente só quando o turno alterou a config (ex.: troca de modelo/raciocínio por voz)
}

export type AgentActivityStatus = 'running' | 'output' | 'waiting' | 'done' | 'error'
export type AgentActivityKind =
  | 'workspace'
  | 'search'
  | 'read'
  | 'write'
  | 'command'
  | 'terminal'
  | 'git'
  | 'index'
  | 'scaffold'
  | 'patch'
  | 'diagnostic'
  | 'hive'
  | 'tool'

// --- Colmeia (subagentes especialistas orquestrados pelo Ares) ---
export type SubagentId = 'researcher' | 'engineer' | 'auditor'
export type WorkerPhase = 'idle' | 'thinking' | 'done' | 'error'

// Status de um subagente, transmitido em tempo real ao renderer (aba Escritório).
export interface HiveWorkerStatus {
  id: SubagentId
  label: string
  phase: WorkerPhase
  detail?: string // ex.: "Investigando padrão observer..." / "2 erros encontrados"
  updatedAt: number
}

export interface AgentActivityEvent {
  id: string
  kind: AgentActivityKind
  status: AgentActivityStatus
  phase: number
  title: string
  ts: number
  detail?: string
  target?: string
  command?: string
  stream?: 'stdout' | 'stderr'
  output?: string
  ok?: boolean
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
  health?: ProjectHealth // avaliação estrutural rápida (sem rodar comandos)
}

// Saúde do projeto reportada de forma falável (estilo briefing JARVIS).
export interface ProjectHealth {
  ok: boolean
  label: string // resumo curto e falável ("tudo em ordem", "atenção: …")
  signals: string[] // pistas que levaram ao veredito
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

export type CodeEditMode = 'replace' | 'insert_before' | 'insert_after' | 'line_range'

export interface CodeEditResult {
  root: string
  file: string
  mode: CodeEditMode
  changed: boolean
  strategy: string
  matchCount: number
  bytes: number
  preview: string
}

export interface CodeProjectIndex {
  root: string
  generatedAt: number
  fileCount: number
  files: Array<{ file: string; language: string; bytes: number; lines: number; exports: string[] }>
  scripts?: Record<string, string>
  git?: CodeWorkspaceSummary['git']
}

// Resultado das skills de qualidade (rodar testes, lint, formatação). Falável.
export interface DevToolResult {
  root: string
  kind: 'test' | 'lint' | 'format' | 'typecheck'
  command: string
  detected: boolean // achou um runner/script para essa tarefa no projeto?
  ran: boolean
  ok: boolean
  code: number | null
  passed?: number // testes
  failed?: number // testes
  total?: number // testes
  problems?: number // lint (erros + avisos) e typecheck (erros de tipo)
  summary: string // resumo curto e falável
  stdoutTail: string // últimas linhas (para a UI/log, não para a fala)
  hint?: string // dica quando nada foi detectado
}

// Resultado de `codigo.deps`: dependências desatualizadas e vulnerabilidades. Falável.
export interface CodeDepsResult {
  root: string
  manager: string // npm/pnpm/yarn/bun
  checked: boolean // conseguiu consultar o registro?
  outdated: Array<{ name: string; current: string; wanted: string; latest: string }>
  vulnerabilities: { critical: number; high: number; moderate: number; low: number; total: number } | null
  summary: string
  hint?: string
}

// Resultado de `codigo.todo`: pendências (TODO/FIXME/...) encontradas no código. Falável.
export interface CodeTodosResult {
  root: string
  total: number
  byTag: Record<string, number>
  items: Array<{ file: string; line: number; tag: string; text: string }>
  truncated: boolean
  summary: string
}

export interface CodeScaffoldResult {
  root: string
  template: string
  created: string[]
  skipped: string[]
  hints: string[]
}

export interface CodeWriteResult {
  file: string
  bytes: number
  created: boolean
  overwritten: boolean
}

export interface CodeDiagnosisCheck {
  name: string
  command: string
  ran: boolean
  ok: boolean
  code: number | null
  summary: string
}

export interface CodeDiagnosis {
  root: string
  name: string
  ok: boolean
  checks: CodeDiagnosisCheck[]
  hints: string[]
  health: ProjectHealth // veredito falável após rodar as checagens disponíveis
}

// --- Controle do computador (desktop actions, estilo JARVIS) ---
export interface DesktopActionResult {
  ok: boolean
  action: 'abrir' | 'volume' | 'midia' | 'brilho' | 'bloquear' | 'captura' | 'clipboard'
  detail: string // texto curto e falável do resultado
  target?: string // alvo aberto/arquivo salvo
  value?: number // ex.: percentual de volume/brilho
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
