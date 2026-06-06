import type { AppConfig, HermesStatus } from '../shared/types'

type HermesConfig = AppConfig['integrations']['hermes']

export interface HermesExecuteResult {
  reply: string
  endpoint: string
  status: number
  latencyMs: number
  sessionId?: string
}

export interface HermesCodeTaskPayload {
  task: string
  mode?: string
  workspace?: unknown
  files?: unknown[]
  extra?: Record<string, unknown>
}

const DEFAULT_HERMES: HermesConfig = {
  enabled: false,
  baseUrl: 'http://localhost:18789',
  messagePath: '/message',
  codePath: '/code',
  healthPath: '/health',
  apiKey: '',
  authHeader: 'Authorization',
  timeoutMs: 4000,
  responsePath: ''
}

function normalizeHermes(input: Partial<HermesConfig> | string): HermesConfig {
  if (typeof input === 'string') return { ...DEFAULT_HERMES, enabled: true, baseUrl: input }
  return { ...DEFAULT_HERMES, ...input }
}

function boundedTimeout(ms: unknown): number {
  const n = Number(ms)
  if (!Number.isFinite(n)) return DEFAULT_HERMES.timeoutMs
  return Math.max(1000, Math.min(60_000, Math.round(n)))
}

export function hermesUrl(baseUrl: string, path: string): string {
  const base = String(baseUrl || DEFAULT_HERMES.baseUrl).trim().replace(/\/+$/, '')
  const suffix = String(path || '').trim()
  if (/^https?:\/\//i.test(suffix)) return suffix
  return `${base}/${suffix.replace(/^\/+/, '')}`
}

function authHeaders(cfg: HermesConfig): Record<string, string> {
  const key = String(cfg.apiKey || '').trim()
  if (!key) return {}
  const header = String(cfg.authHeader || 'Authorization').trim() || 'Authorization'
  const value = header.toLowerCase() === 'authorization' && !/^(bearer|basic)\s+/i.test(key) ? `Bearer ${key}` : key
  return { [header]: value }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function valueAtPath(obj: unknown, path: string): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

function stringifyReply(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object') return JSON.stringify(value)
  return ''
}

export function extractHermesReply(body: string, responsePath = ''): string {
  const text = String(body || '').trim()
  if (!text) return ''

  try {
    const json = JSON.parse(text)
    const candidates = [
      responsePath,
      'reply',
      'response',
      'answer',
      'text',
      'message',
      'content',
      'data.reply',
      'data.response',
      'data.answer',
      'data.text',
      'data.message',
      'data.content',
      'result.reply',
      'result.response',
      'result.text',
      'result.message',
      'result.output',
      'output',
      'result'
    ].filter(Boolean)
    for (const path of candidates) {
      const reply = stringifyReply(valueAtPath(json, path))
      if (reply) return reply
    }
    return stringifyReply(json)
  } catch {
    return text
  }
}

export async function hermesExecute(
  configOrBaseUrl: Partial<HermesConfig> | string,
  comando: string,
  sessionId?: string
): Promise<HermesExecuteResult> {
  const cfg = normalizeHermes(configOrBaseUrl)
  const command = String(comando || '').trim()
  if (!command) throw new Error('Diga qual comando devo enviar ao Hermes.')

  const endpoint = hermesUrl(cfg.baseUrl, cfg.messagePath)
  const started = Date.now()
  let res: Response
  try {
    res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
        body: JSON.stringify({
          message: command,
          text: command,
          command,
          source: 'ares',
          client: 'ares-desktop',
          sessionId
        })
      },
      boundedTimeout(cfg.timeoutMs)
    )
  } catch (err: any) {
    const detail = err?.name === 'AbortError' ? 'timeout' : err?.message || err
    throw new Error(`Não consegui falar com o Hermes em ${cfg.baseUrl}. Detalhe: ${detail}`)
  }

  const raw = await res.text()
  if (!res.ok) throw new Error(`Hermes respondeu HTTP ${res.status}: ${raw.slice(0, 240) || 'sem corpo'}`)

  const reply = extractHermesReply(raw, cfg.responsePath)
  if (!reply) throw new Error('Hermes respondeu sem texto útil.')
  return { reply, endpoint, status: res.status, latencyMs: Date.now() - started, sessionId }
}

function formatCodeFallback(payload: HermesCodeTaskPayload): string {
  return [
    '[ARES_CODE_TASK]',
    `Modo: ${payload.mode || 'assist'}`,
    `Tarefa: ${payload.task}`,
    payload.workspace ? `Workspace:\n${JSON.stringify(payload.workspace, null, 2)}` : '',
    payload.files?.length ? `Arquivos:\n${JSON.stringify(payload.files, null, 2)}` : '',
    payload.extra ? `Extra:\n${JSON.stringify(payload.extra, null, 2)}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

export async function hermesCodeTask(
  configOrBaseUrl: Partial<HermesConfig> | string,
  payload: HermesCodeTaskPayload,
  sessionId?: string
): Promise<HermesExecuteResult & { fallback?: boolean }> {
  const cfg = normalizeHermes(configOrBaseUrl)
  const task = String(payload.task || '').trim()
  if (!task) throw new Error('Diga qual tarefa de programação devo enviar ao Hermes.')

  const endpoint = hermesUrl(cfg.baseUrl, cfg.codePath || '/code')
  const started = Date.now()
  let res: Response
  try {
    res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
        body: JSON.stringify({
          task,
          mode: payload.mode || 'assist',
          workspace: payload.workspace,
          files: payload.files || [],
          extra: payload.extra || {},
          source: 'ares',
          client: 'ares-desktop',
          capability: 'code',
          sessionId
        })
      },
      boundedTimeout(cfg.timeoutMs)
    )
  } catch (err: any) {
    const detail = err?.name === 'AbortError' ? 'timeout' : err?.message || err
    throw new Error(`Não consegui falar com o Hermes Code em ${cfg.baseUrl}. Detalhe: ${detail}`)
  }

  const raw = await res.text()
  if ((res.status === 404 || res.status === 405) && (cfg.codePath || '/code') !== cfg.messagePath) {
    const fallback = await hermesExecute(cfg, formatCodeFallback(payload), sessionId)
    return { ...fallback, fallback: true }
  }
  if (!res.ok) throw new Error(`Hermes Code respondeu HTTP ${res.status}: ${raw.slice(0, 240) || 'sem corpo'}`)

  const reply = extractHermesReply(raw, cfg.responsePath)
  if (!reply) throw new Error('Hermes Code respondeu sem texto útil.')
  return { reply, endpoint, status: res.status, latencyMs: Date.now() - started, sessionId }
}

export async function pingHermes(input: Partial<HermesConfig>): Promise<HermesStatus> {
  const cfg = normalizeHermes(input)
  const base: Omit<HermesStatus, 'ok' | 'detail'> = {
    enabled: !!cfg.enabled,
    baseUrl: cfg.baseUrl,
    messagePath: cfg.messagePath,
    codePath: cfg.codePath,
    healthPath: cfg.healthPath,
    timeoutMs: boundedTimeout(cfg.timeoutMs)
  }
  if (!cfg.enabled) return { ...base, ok: false, detail: 'desativada nas Configurações' }

  const paths = Array.from(new Set([cfg.healthPath || '/health', '/', '/health'].filter(Boolean)))
  let lastDetail = 'sem resposta'
  for (const path of paths) {
    const url = hermesUrl(cfg.baseUrl, path)
    try {
      const res = await fetchWithTimeout(url, { method: 'GET', headers: authHeaders(cfg) }, boundedTimeout(cfg.timeoutMs))
      if (res.ok) return { ...base, ok: true, detail: `online em ${path} (HTTP ${res.status})` }
      lastDetail = `respondeu HTTP ${res.status} em ${path}`
      if (res.status !== 404) break
    } catch (err: any) {
      lastDetail = err?.name === 'AbortError' ? 'sem resposta (timeout)' : 'offline / inacessível'
      break
    }
  }
  return { ...base, ok: false, detail: lastDetail }
}
