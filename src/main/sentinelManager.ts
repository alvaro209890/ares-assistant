import { ChildProcess, spawn } from 'child_process'
import { existsSync } from 'fs'
import { BrowserWindow } from 'electron'
import { registerBackgroundProcess, unregisterBackgroundProcess, windowsSpawnPlan } from './exec'
import {
  extractErrorSignature,
  isRecoveryMessage,
  setPendingSentinelDebug,
  clearPendingSentinelDebug
} from './sentinel'
import { rootCauseError } from './voiceCode'

export interface SentinelInstance {
  id: string
  command: string
  path: string
  sessionId: string
  status: 'running' | 'error' | 'recovered' | 'stopped'
  buffer: string
  lastErrorSignature?: string
  lastVoiceAlertAt?: number
  child: ChildProcess
  debounceTimer?: NodeJS.Timeout
  recentChunkBuffer: string
}

const activeSentinels = new Map<string, SentinelInstance>()

function platformShell(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const encoded = Buffer.from(command, 'utf16le').toString('base64')
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]
    }
  }
  const file = existsSync('/bin/bash') || existsSync('/usr/bin/bash') ? 'bash' : 'sh'
  return { file, args: ['-lc', command] }
}

function broadcastSentinelEvent(event: any): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('sentinel:event', event)
    }
  }
}

export function startSentinel(
  sessionId: string,
  command: string,
  path: string
): Promise<{ status: string; sentinelId: string } | { erro: string }> {
  // Limite de 3 sentinelas simultâneas por sessão
  const sessionCount = [...activeSentinels.values()].filter((s) => s.sessionId === sessionId).length
  if (sessionCount >= 3) {
    return Promise.resolve({ erro: 'Limite de 3 sentinelas simultâneas atingido para esta sessão.' })
  }

  const sentinelId = `sentinel-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  const shell = platformShell(command)

  let child: ChildProcess
  try {
    const plan = process.platform === 'win32' ? windowsSpawnPlan(shell.file, shell.args) : shell
    child = spawn(plan.file, plan.args, { cwd: path, env: process.env })
  } catch (err: any) {
    const msg = `Falha ao iniciar o comando: ${err.message}`
    broadcastSentinelEvent({
      type: 'error',
      sentinelId,
      command,
      path,
      sessionId,
      rootCause: msg,
      logSnippet: msg,
      speak: true
    })
    return Promise.resolve({ erro: msg })
  }

  const instance: SentinelInstance = {
    id: sentinelId,
    command,
    path,
    sessionId,
    status: 'running',
    buffer: '',
    recentChunkBuffer: '',
    child
  }

  activeSentinels.set(sentinelId, instance)
  registerBackgroundProcess(sessionId, child)

  // Emite evento de início
  broadcastSentinelEvent({
    type: 'started',
    sentinelId,
    command,
    path,
    sessionId
  })

  const processDebouncedBlock = (): void => {
    const text = instance.recentChunkBuffer
    instance.recentChunkBuffer = ''

    if (!text) return

    // 1. Verifica recuperação
    if (isRecoveryMessage(text)) {
      if (instance.status === 'error') {
        instance.status = 'recovered'
        instance.lastErrorSignature = undefined
        clearPendingSentinelDebug(instance.sessionId)

        broadcastSentinelEvent({
          type: 'recovered',
          sentinelId: instance.id,
          command: instance.command,
          path: instance.path,
          sessionId: instance.sessionId
        })
      }
      return
    }

    // 2. Verifica erro
    const sig = extractErrorSignature(text)
    if (sig) {
      if (instance.status !== 'error' || instance.lastErrorSignature !== sig.hash) {
        instance.status = 'error'
        instance.lastErrorSignature = sig.hash

        const cause = rootCauseError(text)
        const now = Date.now()
        let speak = false

        if (!instance.lastVoiceAlertAt || now - instance.lastVoiceAlertAt >= 60000) {
          speak = true
          instance.lastVoiceAlertAt = now
        }

        setPendingSentinelDebug(instance.sessionId, {
          sentinelId: instance.id,
          command: instance.command,
          logSnippet: text
        })

        broadcastSentinelEvent({
          type: 'error',
          sentinelId: instance.id,
          command: instance.command,
          path: instance.path,
          sessionId: instance.sessionId,
          errorSignature: sig.hash,
          rootCause: cause,
          logSnippet: text,
          speak
        })
      }
    }
  }

  const handleChunk = (stream: 'stdout' | 'stderr', chunk: string): void => {
    instance.buffer += chunk
    if (instance.buffer.length > 50000) {
      instance.buffer = instance.buffer.slice(-50000)
    }

    instance.recentChunkBuffer += chunk

    broadcastSentinelEvent({
      type: 'chunk',
      sentinelId,
      command,
      path,
      sessionId,
      chunk,
      stream
    })

    if (instance.debounceTimer) {
      clearTimeout(instance.debounceTimer)
    }

    instance.debounceTimer = setTimeout(() => {
      processDebouncedBlock()
    }, 1500)
  }

  child.stdout?.on('data', (data: Buffer) => handleChunk('stdout', data.toString()))
  child.stderr?.on('data', (data: Buffer) => handleChunk('stderr', data.toString()))

  const handleExit = (code: number | null): void => {
    if (instance.debounceTimer) {
      clearTimeout(instance.debounceTimer)
    }

    if (instance.recentChunkBuffer) {
      processDebouncedBlock()
    }

    if (code !== null && code !== 0) {
      if (instance.status !== 'error') {
        instance.status = 'error'
        const cause = `Processo encerrou com código ${code}`
        broadcastSentinelEvent({
          type: 'error',
          sentinelId: instance.id,
          command: instance.command,
          path: instance.path,
          sessionId: instance.sessionId,
          rootCause: cause,
          logSnippet: instance.buffer || cause,
          speak: true
        })
      }
    } else if (code === 0) {
      if (instance.status === 'error') {
        instance.status = 'recovered'
        instance.lastErrorSignature = undefined
        clearPendingSentinelDebug(instance.sessionId)

        broadcastSentinelEvent({
          type: 'recovered',
          sentinelId: instance.id,
          command: instance.command,
          path: instance.path,
          sessionId: instance.sessionId
        })
      }
    }

    instance.status = 'stopped'
    broadcastSentinelEvent({
      type: 'stopped',
      sentinelId: instance.id,
      command: instance.command,
      path: instance.path,
      sessionId: instance.sessionId
    })

    activeSentinels.delete(sentinelId)
    unregisterBackgroundProcess(sessionId, child)
  }

  child.on('error', (err) => {
    const msg = `Falha no processo: ${err.message}`
    if (instance.status !== 'error') {
      instance.status = 'error'
      broadcastSentinelEvent({
        type: 'error',
        sentinelId: instance.id,
        command: instance.command,
        path: instance.path,
        sessionId: instance.sessionId,
        rootCause: msg,
        logSnippet: msg,
        speak: true
      })
    }
    handleExit(null)
  })

  child.on('close', (code) => {
    handleExit(code)
  })

  return Promise.resolve({ status: 'observando', sentinelId })
}

export function stopSentinels(sessionId: string, target?: string): number {
  let stoppedCount = 0
  for (const [id, s] of activeSentinels.entries()) {
    if (s.sessionId === sessionId) {
      if (!target || s.id === target || s.command === target) {
        try {
          if (s.debounceTimer) clearTimeout(s.debounceTimer)
          if (process.platform === 'win32' && s.child.pid) {
            spawn('taskkill', ['/pid', String(s.child.pid), '/f', '/t'])
          } else {
            s.child.kill('SIGKILL')
          }
          stoppedCount++
        } catch {
          // ignore
        }

        broadcastSentinelEvent({
          type: 'stopped',
          sentinelId: s.id,
          command: s.command,
          path: s.path,
          sessionId: s.sessionId
        })
        activeSentinels.delete(id)
        unregisterBackgroundProcess(sessionId, s.child)
      }
    }
  }
  return stoppedCount
}

export function stopAllSentinels(): number {
  let stoppedCount = 0
  for (const [id, s] of activeSentinels.entries()) {
    try {
      if (s.debounceTimer) clearTimeout(s.debounceTimer)
      if (process.platform === 'win32' && s.child.pid) {
        spawn('taskkill', ['/pid', String(s.child.pid), '/f', '/t'])
      } else {
        s.child.kill('SIGKILL')
      }
      stoppedCount++
    } catch {
      // ignore
    }

    broadcastSentinelEvent({
      type: 'stopped',
      sentinelId: s.id,
      command: s.command,
      path: s.path,
      sessionId: s.sessionId
    })
    unregisterBackgroundProcess(s.sessionId, s.child)
  }
  activeSentinels.clear()
  return stoppedCount
}

export function listSentinels(sessionId: string): any[] {
  return [...activeSentinels.values()]
    .filter((s) => s.sessionId === sessionId)
    .map((s) => ({
      id: s.id,
      command: s.command,
      path: s.path,
      sessionId: s.sessionId,
      status: s.status,
      buffer: s.buffer
    }))
}
