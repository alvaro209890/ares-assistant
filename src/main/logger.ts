// Logger estruturado do Ares. Antes havia dezenas de `catch {}` silenciosos: quando o
// Piper falhava ao baixar/sintetizar, o STT recusava a chave ou a config estava corrompida,
// nada disso deixava rastro — na máquina do usuário o sintoma era "a voz não funciona" sem
// como diagnosticar. Este módulo mantém um anel em memória (para mostrar na aba
// Sistema/Diagnóstico) e anexa num arquivo em userData (`ares.log`), com rotação simples.
//
// Sem dependência do Electron: o diretório-base é injetado por initLogger() no start do app
// (cai em tmpdir se não for inicializado), o que mantém o módulo puro e testável.

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: number
  level: LogLevel
  scope: string
  message: string
}

const RING_MAX = 500
const FILE_MAX_BYTES = 256 * 1024

const ring: LogEntry[] = []
let baseDir = tmpdir()
let fileEnabled = true

/** Chamado no start do app com app.getPath('userData'). */
export function initLogger(dir: string): void {
  if (dir) baseDir = dir
}

/** Desliga a escrita em arquivo (usado em testes). */
export function setFileLogging(enabled: boolean): void {
  fileEnabled = enabled
}

export function formatEntry(e: LogEntry): string {
  return `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.scope}: ${e.message}`
}

/** Extrai uma mensagem legível de um valor de erro qualquer. */
export function errToMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e == null) return ''
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

function logFilePath(): string {
  return join(baseDir, 'ares.log')
}

function rotateIfNeeded(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size > FILE_MAX_BYTES) renameSync(path, `${path}.1`)
  } catch {
    /* rotação é best-effort */
  }
}

export function log(level: LogLevel, scope: string, message: string, err?: unknown): void {
  const full = err === undefined ? message : `${message} — ${errToMessage(err)}`
  const entry: LogEntry = { ts: Date.now(), level, scope, message: full }
  ring.push(entry)
  if (ring.length > RING_MAX) ring.shift()

  if (fileEnabled) {
    try {
      const path = logFilePath()
      mkdirSync(baseDir, { recursive: true })
      rotateIfNeeded(path)
      appendFileSync(path, `${formatEntry(entry)}\n`)
    } catch {
      /* o log nunca pode derrubar o app */
    }
  }
  // Eco no console do main ajuda no dev; warn/error só.
  if (level === 'warn' || level === 'error') {
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : 'warn'](formatEntry(entry))
  }
}

export const logger = {
  debug: (scope: string, message: string, err?: unknown) => log('debug', scope, message, err),
  info: (scope: string, message: string, err?: unknown) => log('info', scope, message, err),
  warn: (scope: string, message: string, err?: unknown) => log('warn', scope, message, err),
  error: (scope: string, message: string, err?: unknown) => log('error', scope, message, err)
}

/** Últimas linhas do anel em memória, já formatadas (para a UI de diagnóstico). */
export function getRecentLogs(limit = 200): string[] {
  return ring.slice(-Math.max(1, limit)).map(formatEntry)
}

/** Apenas para testes. */
export function clearLogRing(): void {
  ring.length = 0
}
