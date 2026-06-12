import { rootCauseError } from './voiceCode'

export interface ErrorSignature {
  type: string
  fileLine: string
  message: string
  hash: string
}

// Marcadores de compilação limpa / recuperação
const RECOVERY_MARKERS = [
  /compiled successfully/i,
  /hmr update/i,
  /hot update/i,
  /vite: restored/i,
  /webpack: compiled/i,
  /ready in \d+/i,
  /server running/i,
  /no issues found/i,
  /compiled with success/i
]

/**
 * Detecta se uma mensagem do stream indica que o processo se recuperou de um erro.
 */
export function isRecoveryMessage(text: string): boolean {
  return RECOVERY_MARKERS.some((re) => re.test(text))
}

/**
 * Extrai assinatura de um log de erro para deduplicação.
 */
export function extractErrorSignature(text: string): ErrorSignature | null {
  if (!hasErrorIndicators(text)) return null

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (!lines.length) return null

  // 1. Achar primeiro arquivo + linha nas extensões comuns de código (aceitando aspas/vírgulas de tracebacks Python)
  let fileLine = ''
  const fileLineRegex =
    /([a-zA-Z0-9_\-\.\/\\\+]+\.(?:tsx?|jsx?|py|go|rs|java|cpp|h|cs|js|css|html|json))"?\s*(?::|,\s*line\s+|:\d+:)?\s*(\d+)/i

  for (const line of lines) {
    if (/https?:\/\//i.test(line) && !/\bat\s+/i.test(line)) continue
    const match = line.match(fileLineRegex)
    if (match) {
      const fullPath = match[1]
      const lineNum = match[2]
      const basename = fullPath.replace(/^.*[\\\/]/, '')
      fileLine = `${basename}:${lineNum}`
      break
    }
  }

  // 2. Achar o tipo de erro (Passo 1: Tipo específico; Passo 2: Fallback genérico)
  let type = ''
  const specificTypeRegex = /\b([a-zA-Z0-9_]+(?:Error|Exception)|TS\d+)\b/i
  const fallbackTypeRegex = /\b(error|erro|exception|failed|syntax|type)\b/i

  for (const line of lines) {
    const match = line.match(specificTypeRegex)
    if (match) {
      type = match[1]
      break
    }
  }

  if (!type) {
    for (const line of lines) {
      const match = line.match(fallbackTypeRegex)
      if (match) {
        type = match[1]
        break
      }
    }
  }

  if (!type) {
    type = 'GenericError'
  }

  // 3. Achar a mensagem de erro principal normalizada
  const msgLine =
    lines.find((l) => {
      if (/^\s*at\s+/i.test(l)) return false
      if (/traceback/i.test(l)) return false
      return /(error|erro|exception|cannot|failed|syntax|type|compile)/i.test(l)
    }) ||
    lines[0] ||
    ''

  // Limpa ruídos da mensagem
  const errorMsg = msgLine
    .replace(/\[\d{2}:\d{2}:\d{2}\]/g, '') // Timestamps [12:34:56]
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\S*/g, '') // ISO timestamps
    .replace(/[a-zA-Z]:\\[^:\n]+/g, '') // Windows absolute paths
    .replace(/\/([a-zA-Z0-9_\-\.]+)\/[^:\n]+/g, '') // Unix absolute paths
    .trim()

  if (!fileLine && !errorMsg) return null

  const hash = `${type.toLowerCase()}|${fileLine.toLowerCase()}|${errorMsg.toLowerCase()}`.trim()
  return { type, fileLine, message: errorMsg, hash }
}

/**
 * Verifica se um bloco de texto do stream contém algum indicador de erro (stack trace ou erro do compilador).
 */
export function hasErrorIndicators(text: string): boolean {
  if (/(error|erro|exception|failed to compile|syntaxerror|typeerror|unhandledrejection|traceback)/i.test(text)) {
    return true
  }
  // Se contiver linhas de stack trace como 'at ' ou arquivo:linha
  if (/\s+at\s+[\w.<>]+\s+\(/i.test(text) || /\b[\w./\\-]+\.(tsx?|jsx?|py|go|rs|js):\d+/i.test(text)) {
    return true
  }
  return false
}

// --- Gestão de Pendências do Prometeu ---

export interface PendingSentinelDebug {
  sentinelId: string
  command: string
  logSnippet: string
  createdAt: number
}

const pendingDebugStore = new Map<string, PendingSentinelDebug>()
const TTL_MS = 5 * 60_000 // 5 minutos de validade para a confirmação de depuração

export function setPendingSentinelDebug(sessionId: string, debug: Omit<PendingSentinelDebug, 'createdAt'>): void {
  pendingDebugStore.set(sessionId, { ...debug, createdAt: Date.now() })
}

export function getPendingSentinelDebug(sessionId: string): PendingSentinelDebug | undefined {
  const d = pendingDebugStore.get(sessionId)
  if (!d) return undefined
  if (Date.now() - d.createdAt > TTL_MS) {
    pendingDebugStore.delete(sessionId)
    return undefined
  }
  return d
}

export function clearPendingSentinelDebug(sessionId: string): boolean {
  return pendingDebugStore.delete(sessionId)
}
