import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type { AppConfig, DeepPartial } from '../shared/types'
import { detectProviderId } from '../shared/providers'

// Pastas padrão que variam por sistema/idioma. Windows normalmente usa
// Documents/Pictures; Linux pt-BR costuma usar Documentos/Imagens.
function firstExistingDir(candidates: string[], fallback: string): string {
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c
    } catch {
      /* ignora */
    }
  }
  return fallback
}
const home = homedir()
const documentCandidates =
  process.platform === 'win32'
    ? [join(home, 'Documents'), join(home, 'Documentos')]
    : [join(home, 'Documentos'), join(home, 'Documents')]
const pictureCandidates =
  process.platform === 'win32'
    ? [join(home, 'Pictures'), join(home, 'Imagens')]
    : [join(home, 'Imagens'), join(home, 'Pictures')]
const DEFAULT_DOCS = firstExistingDir(
  documentCandidates,
  home
)
const DEFAULT_PICTURES = firstExistingDir(
  pictureCandidates,
  home
)

// ---------------------------------------------------------------------------
// Configuração do Ares.
// A fonte da verdade é um arquivo JSON em userData (Linux: ~/.config/ares/config.json).
// Ele é criado no 1º uso a partir dos padrões abaixo. Se a chave da Grog estiver
// vazia, tentamos reaproveitar automaticamente a chave Groq já existente no PC.
// ---------------------------------------------------------------------------

export type { AppConfig }

const DEFAULT_CONFIG: AppConfig = {
  nineRouter: {
    baseUrl: 'http://localhost:20128/v1',
    apiKey: '', // localhost não exige chave; deixe vazio.
    model: 'cx/gpt-5.5'
  },
  grog: {
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '', // preenchida automaticamente (ver detectGroqKey) no 1º uso.
    sttModel: 'whisper-large-v3-turbo'
  },
  tts: {
    enabled: true,
    engine: 'auto', // Piper (neural) no Linux; Web Speech no Windows
    piperVoice: 'pt_BR-faber-medium',
    webVoiceURI: '',
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0
  },
  integrations: {
    weatherCity: 'São Paulo',
    newsTopic: '',
    // O app pede permissao no onboarding. Ate la, usa a cidade padrao.
    location: { enabled: false },
    hermes: {
      enabled: false,
      baseUrl: 'http://localhost:18789',
      messagePath: '/message',
      codePath: '/code',
      healthPath: '/health',
      apiKey: '',
      authHeader: 'Authorization',
      timeoutMs: 4000,
      responsePath: ''
    },
    code: {
      enabled: true,
      workspaceRoot: DEFAULT_DOCS,
      allowedRoots: [homedir()],
      maxFileKB: 256,
      maxSearchResults: 40,
      maxContextChars: 16000,
      allowedCommands: [
        'npm test',
        'npm run test',
        'npm run test:unit',
        'npm run typecheck',
        'npm run build',
        'npm run verify',
        'npx tsc --noEmit',
        'git status --short',
        'git diff --stat',
        'git diff'
      ],
      commandTimeoutMs: 120000,
      allowPatchApply: false,
      indexMaxFiles: 600,
      terminalEnabled: true,
      terminalAutoApprove: false,
      terminalSafe: [
        'ls',
        'pwd',
        'cat',
        'head',
        'tail',
        'wc',
        'echo',
        'which',
        'env',
        'date',
        'whoami',
        'uname',
        'grep',
        'rg',
        'find',
        'tree',
        'git status',
        'git diff',
        'git log',
        'git branch',
        'git show',
        'git remote',
        'node --version',
        'npm --version',
        'npm ls',
        'npx tsc --noEmit'
      ]
    },
    control: {
      enabled: true,
      screenshotDir: DEFAULT_PICTURES
    }
  },
  ui: {
    continuousMode: false,
    micSensitivity: 0.5,
    silenceMs: 1350,
    postSpeechPauseMs: 450,
    proactiveSuggestions: true,
    proactiveAlerts: true,
    confirmDestructive: true,
    wakeWord: 'ares',
    wakeWordEnabled: false,
    bargeIn: true,
    overlayEnabled: false,
    onboarded: false,
    userName: '',
    fontScale: 1,
    highContrast: false,
    simpleMode: false,
    autostart: false,
    globalShortcut: false,
    morningBriefing: false
  },
  memory: {
    autoExtract: true,
    autoApprove: false
  }
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** Mescla profundamente "patch" sobre "base" (apenas objetos simples). */
function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base }
  for (const key of Object.keys(patch || {})) {
    const pv: any = (patch as any)[key]
    const bv: any = (base as any)[key]
    if (pv && typeof pv === 'object' && !Array.isArray(pv) && bv && typeof bv === 'object') {
      out[key] = deepMerge(bv, pv)
    } else if (pv !== undefined) {
      out[key] = pv
    }
  }
  return out
}

/**
 * Procura uma chave Groq (GROQ_API_KEY) já configurada neste PC para reaproveitar.
 * Locais conhecidos primeiro; depois a variável de ambiente do sistema.
 */
function detectGroqKey(): string {
  const candidates = [
    join(homedir(), '.config', 'saldopro', 'backend.env')
  ]
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue
      const txt = readFileSync(file, 'utf8')
      const m = txt.match(/^\s*GROQ_API_KEY\s*=\s*["']?(gsk_[A-Za-z0-9]+)["']?/m)
      if (m) return m[1]
    } catch {
      /* ignora e tenta o próximo */
    }
  }
  const env = process.env.GROQ_API_KEY || process.env.GROG_API_KEY
  if (env && env.startsWith('gsk_')) return env
  return ''
}

/** Lê a config do disco, garantindo todos os campos (merge com os padrões). */
export function readConfig(): AppConfig {
  const path = configPath()
  let stored: Partial<AppConfig> = {}
  try {
    if (existsSync(path)) stored = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    /* arquivo corrompido: cai nos padrões */
  }
  return deepMerge(DEFAULT_CONFIG, stored)
}

function persist(cfg: AppConfig): void {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8')
}

/** Cria a config no 1º uso e auto-preenche a chave Groq se estiver vazia. */
export function ensureConfig(): AppConfig {
  const path = configPath()
  const fresh = !existsSync(path)
  const cfg = readConfig()
  if (!cfg.grog.apiKey) {
    const detected = detectGroqKey()
    if (detected) cfg.grog.apiKey = detected
  }
  if (fresh || !readConfig().grog.apiKey) persist(cfg)
  return cfg
}

/** Aplica um patch parcial (em profundidade) e devolve a config completa atualizada. */
export function updateConfig(patch: DeepPartial<AppConfig>): AppConfig {
  const merged = deepMerge(readConfig(), patch)
  // Conveniência: se o cérebro usa a Groq e a transcrição de voz ainda não tem
  // chave, reaproveita a mesma chave gsk_ para o STT. Assim, num PC novo, quem
  // escolhe Groq como provedor passa a usar o microfone sem colar a chave 2x.
  if (
    detectProviderId(merged.nineRouter.baseUrl) === 'groq' &&
    merged.nineRouter.apiKey.startsWith('gsk_') &&
    !merged.grog.apiKey
  ) {
    merged.grog.apiKey = merged.nineRouter.apiKey
  }
  persist(merged)
  return merged
}
