import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'

// Execução de processos ASSÍNCRONA e não-bloqueante. Substitui o spawnSync nas rotas de
// comando do modo programador: spawnSync congelava o processo principal do Electron
// durante builds/instalações (sem IPC, sem voz, sem proatividade). Com spawn, o event
// loop fica livre, dá para transmitir a saída em tempo real (onChunk) e cancelar a
// execução (AbortSignal) — ex.: parar um build travado pelo Esc.

export interface SpawnResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
}

export interface SpawnOptions {
  cwd?: string
  timeoutMs: number
  /** Limite de captura por fluxo (bytes ~ chars). Acima disso, ainda drena, mas não acumula. */
  maxBytes?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  /** Recebe a saída em tempo real (para futura UI de terminal ao vivo). */
  onChunk?: (stream: 'stdout' | 'stderr', chunk: string) => void
}

const DEFAULT_MAX_BYTES = 256 * 1024

/**
 * Roda um processo sem bloquear a thread principal. SEMPRE resolve (nunca rejeita):
 * falhas de spawn (ex.: ENOENT) e códigos != 0 vêm no resultado, como fazia o spawnSync.
 */
export function spawnAsync(file: string, args: string[], opts: SpawnOptions): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const maxBytes = Math.max(1024, opts.maxBytes ?? DEFAULT_MAX_BYTES)
    const out: string[] = []
    const err: string[] = []
    let outLen = 0
    let errLen = 0
    let timedOut = false
    let aborted = false
    let settled = false

    let child: ChildProcess
    try {
      child = spawn(file, args, { cwd: opts.cwd, env: opts.env })
    } catch (e) {
      return resolve({ code: null, stdout: '', stderr: e instanceof Error ? e.message : String(e), timedOut: false, aborted: false })
    }

    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout: out.join(''), stderr: err.join(''), timedOut, aborted })
    }

    const kill = (): void => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* já morreu */
      }
      // Garante o encerramento caso o processo ignore o SIGTERM.
      const g = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ok */
        }
      }, 2000)
      g.unref?.()
    }

    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, Math.max(250, opts.timeoutMs))
    timer.unref?.()

    const onAbort = (): void => {
      aborted = true
      kill()
    }
    if (opts.signal) {
      if (opts.signal.aborted) {
        aborted = true
        queueMicrotask(kill)
      } else {
        opts.signal.addEventListener('abort', onAbort)
      }
    }

    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString()
      opts.onChunk?.('stdout', s)
      if (outLen < maxBytes) {
        out.push(s)
        outLen += s.length
      }
    })
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString()
      opts.onChunk?.('stderr', s)
      if (errLen < maxBytes) {
        err.push(s)
        errLen += s.length
      }
    })
    child.on('error', (e: Error) => {
      if (errLen < maxBytes) err.push(String(e.message || e))
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}
