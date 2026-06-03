import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type { AppConfig, DeepPartial } from '../shared/types'

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
  integrations: { weatherCity: 'São Paulo', newsTopic: '', location: { enabled: true } },
  ui: {
    continuousMode: false,
    micSensitivity: 0.5,
    silenceMs: 1350,
    postSpeechPauseMs: 450,
    proactiveSuggestions: true
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
  persist(merged)
  return merged
}
