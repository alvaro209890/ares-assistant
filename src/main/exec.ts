import { spawn, spawnSync } from 'child_process'
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
  background?: boolean
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
  background?: boolean
  sessionId?: string
  startupTimeoutMs?: number
}

const DEFAULT_MAX_BYTES = 256 * 1024

// ---------------------------------------------------------------------------
// Windows: npm/npx/yarn/tsc e afins são scripts .cmd — o Node moderno (>= 20.12,
// fix de CVE) LANÇA EINVAL ao spawná-los sem shell, e o resolvedor sem shell nem
// acha "npm" sem extensão. Estes comandos são roteados por cmd.exe /d /s /c com
// os argumentos re-citados. Executáveis nativos conhecidos (git, node, python...)
// continuam spawnados direto, preservando a fidelidade dos argumentos.
// ---------------------------------------------------------------------------

const WIN_NATIVE_EXES = new Set([
  'git', 'node', 'python', 'python3', 'py', 'go', 'cargo', 'rustc', 'java', 'dotnet', 'taskkill', 'where'
])

/** Cita um argumento para a linha de comando do cmd.exe. Pura e testável. */
export function quoteWindowsArg(arg: string): string {
  if (arg === '') return '""'
  if (!/[\s"&|<>^()%!]/.test(arg)) return arg
  return `"${arg.replace(/"/g, '\\"')}"`
}

/**
 * Decide como spawnar no Windows: direto (exe nativo/caminho com extensão de
 * executável) ou via cmd.exe (shims .cmd/.bat e comandos "bare" tipo npm).
 * Pura e testável — fora do Windows o chamador nem deve chamá-la.
 */
export function windowsSpawnPlan(file: string, args: string[]): { file: string; args: string[] } {
  const lower = String(file || '').toLowerCase()
  const isPath = /[\\/]/.test(lower)
  if (/\.(exe|com)$/.test(lower)) return { file, args }
  if (!isPath && WIN_NATIVE_EXES.has(lower)) return { file, args }
  if (isPath && !/\.(cmd|bat)$/.test(lower)) return { file, args }
  const commandLine = [quoteWindowsArg(file), ...args.map(quoteWindowsArg)].join(' ')
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', commandLine] }
}

export const backgroundProcesses = new Map<string, Set<ChildProcess>>()

export function registerBackgroundProcess(sessionId: string, child: ChildProcess): void {
  let set = backgroundProcesses.get(sessionId)
  if (!set) {
    set = new Set()
    backgroundProcesses.set(sessionId, set)
  }
  set.add(child)
}

export function unregisterBackgroundProcess(sessionId: string, child: ChildProcess): void {
  const set = backgroundProcesses.get(sessionId)
  if (set) {
    set.delete(child)
    if (set.size === 0) backgroundProcesses.delete(sessionId)
  }
}

export function killBackgroundProcesses(sessionId: string): void {
  const set = backgroundProcesses.get(sessionId)
  if (set) {
    for (const child of set) {
      try {
        if (process.platform === 'win32' && child.pid) {
          spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { timeout: 2000 })
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        // ignore
      }
    }
    backgroundProcesses.delete(sessionId)
  }
}

export function killAllBackgroundProcesses(): void {
  for (const sessionId of [...backgroundProcesses.keys()]) {
    killBackgroundProcesses(sessionId)
  }
}

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
      const plan = process.platform === 'win32' ? windowsSpawnPlan(file, args) : { file, args }
      child = spawn(plan.file, plan.args, { cwd: opts.cwd, env: opts.env })
    } catch (e) {
      return resolve({ code: null, stdout: '', stderr: e instanceof Error ? e.message : String(e), timedOut: false, aborted: false })
    }

    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(startupTimer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout: out.join(''), stderr: err.join(''), timedOut, aborted })
    }

    const kill = (): void => {
      if (opts.sessionId) {
        unregisterBackgroundProcess(opts.sessionId, child)
      }
      try {
        if (process.platform === 'win32' && child.pid) {
          spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { timeout: 2000 })
        } else {
          child.kill('SIGTERM')
        }
      } catch {
        /* já morreu */
      }
      // Garante o encerramento caso o processo ignore o SIGTERM.
      const g = setTimeout(() => {
        try {
          if (process.platform === 'win32' && child.pid) {
            spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { timeout: 2000 })
          } else {
            child.kill('SIGKILL')
          }
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

    let startupTimer: NodeJS.Timeout | undefined
    if (opts.background) {
      startupTimer = setTimeout(() => {
        if (!settled) {
          if (opts.sessionId) {
            registerBackgroundProcess(opts.sessionId, child)
          }
          settled = true
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          resolve({
            code: null,
            stdout: out.join('') + '\n[Servidor iniciado em segundo plano]',
            stderr: err.join(''),
            timedOut: false,
            aborted: false,
            background: true
          })
        }
      }, opts.startupTimeoutMs ?? 3000)
      startupTimer.unref?.()
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
      if (opts.sessionId) {
        unregisterBackgroundProcess(opts.sessionId, child)
      }
      if (errLen < maxBytes) err.push(String(e.message || e))
      finish(null)
    })
    child.on('close', (code) => {
      if (opts.sessionId) {
        unregisterBackgroundProcess(opts.sessionId, child)
      }
      finish(code)
    })
  })
}
