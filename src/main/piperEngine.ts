// Pool de processos Piper "quentes" — mantém o modelo ONNX carregado em memória entre
// falas, eliminando o custo de recarregá-lo a cada locução (a maior fonte de latência no
// modo um-processo-por-frase). Funciona no Linux e no Windows.
//
// Constraint da CLI do Piper (verificado na fonte): o binário fica vivo lendo várias linhas
// do stdin até EOF e, no modo arquivo (--json-input com output_file), ECOA o caminho do
// .wav no stdout ao concluir cada locução — nosso marcador de fim confiável. Porém
// --length_scale/--noise_* são flags GLOBAIS do processo, não por-linha. Como o Ares varia
// length_scale/noise pelo tom, o "quente" é um POOL pequeno indexado por esses parâmetros
// (na prática ≤3: erro/neutro/sucesso para a taxa ativa).
//
// A cola de processo é fina; a lógica pura (args, chave do pool, requisição JSON, casamento
// da linha de saída) fica em funções exportadas e testáveis.

import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import { logger } from './logger'

export interface PiperSynthParams {
  bin: string
  model: string
  lengthScale: string
  noiseScale: string
  noiseW: string
  sentenceSilence: string
  env: NodeJS.ProcessEnv
  cwd: string
}

const MAX_POOL = 4
const IDLE_KILL_MS = 90_000
// Folgado para sobreviver à CPU ocupada com build/testes (ver piper.ts).
const REQUEST_TIMEOUT_MS = 9000
const REAPER_INTERVAL_MS = 30_000

// ---------------------------------------------------------------------------
// Funções puras (testáveis)
// ---------------------------------------------------------------------------

/** Argumentos da CLI do Piper para o modo quente (lê JSON do stdin, escreve em arquivo). */
export function buildPiperArgs(p: PiperSynthParams): string[] {
  return [
    '--model', p.model,
    '--length_scale', p.lengthScale,
    '--noise_scale', p.noiseScale,
    '--noise_w', p.noiseW,
    '--sentence_silence', p.sentenceSilence,
    '--json-input'
  ]
}

/** Chave do pool: um processo por (modelo + parâmetros globais de prosódia). */
export function poolKey(p: PiperSynthParams): string {
  return [p.model, p.lengthScale, p.noiseScale, p.noiseW, p.sentenceSilence].join('@')
}

/** Linha JSON de requisição (uma locução). JSON.stringify escapa o caminho (Windows ok). */
export function buildJsonRequest(text: string, outputFile: string): string {
  return JSON.stringify({ text, output_file: outputFile }) + '\n'
}

/**
 * O Piper ecoa o caminho do arquivo de saída ao concluir. Comparamos pelo basename para
 * ser robusto a caminho absoluto/relativo e a separadores de plataforma.
 */
export function matchesOutput(line: string, outputFile: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  const want = basename(outputFile)
  return trimmed === outputFile || basename(trimmed.replace(/\\/g, '/')) === want
}

// ---------------------------------------------------------------------------
// Pool (glue de processo)
// ---------------------------------------------------------------------------

interface PendingRequest {
  text: string
  resolve: (buf: Buffer) => void
  reject: (err: Error) => void
}

interface ActiveRequest extends PendingRequest {
  outputFile: string
  timer: ReturnType<typeof setTimeout>
}

interface WarmProc {
  proc: ChildProcess
  key: string
  lastUsed: number
  alive: boolean
  stdoutBuf: string
  active: ActiveRequest | null
  queue: PendingRequest[]
}

const pool = new Map<string, WarmProc>()
let reqCounter = 0
let reaper: ReturnType<typeof setInterval> | null = null

function ensureReaper(): void {
  if (reaper) return
  reaper = setInterval(() => {
    const now = Date.now()
    for (const w of [...pool.values()]) {
      if (!w.active && w.queue.length === 0 && now - w.lastUsed > IDLE_KILL_MS) killWarm(w)
    }
  }, REAPER_INTERVAL_MS)
  // Não segurar o event loop por causa do timer.
  if (typeof reaper.unref === 'function') reaper.unref()
}

function killWarm(w: WarmProc): void {
  w.alive = false
  pool.delete(w.key)
  try {
    w.proc.kill()
  } catch {
    /* já morto */
  }
}

function failAll(w: WarmProc, err: Error): void {
  if (w.active) {
    clearTimeout(w.active.timer)
    cleanupFile(w.active.outputFile)
    w.active.reject(err)
    w.active = null
  }
  const pending = w.queue.splice(0)
  for (const r of pending) r.reject(err)
}

function cleanupFile(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    /* ok */
  }
}

function spawnWarm(params: PiperSynthParams): WarmProc {
  const key = poolKey(params)
  const proc = spawn(params.bin, buildPiperArgs(params), { env: params.env, cwd: params.cwd })
  const w: WarmProc = { proc, key, lastUsed: Date.now(), alive: true, stdoutBuf: '', active: null, queue: [] }

  proc.stdout?.on('data', (d: Buffer) => {
    w.stdoutBuf += d.toString()
    let nl: number
    while ((nl = w.stdoutBuf.indexOf('\n')) >= 0) {
      const line = w.stdoutBuf.slice(0, nl)
      w.stdoutBuf = w.stdoutBuf.slice(nl + 1)
      if (w.active && matchesOutput(line, w.active.outputFile)) completeActive(w)
    }
  })
  proc.on('error', (e) => {
    logger.warn('piper-pool', 'processo Piper quente falhou (caindo para one-shot)', e)
    failAll(w, e instanceof Error ? e : new Error(String(e)))
    killWarm(w)
  })
  proc.on('exit', () => {
    failAll(w, new Error('Processo Piper encerrou.'))
    if (w.alive) {
      w.alive = false
      pool.delete(key)
    }
  })
  return w
}

function completeActive(w: WarmProc): void {
  const req = w.active
  if (!req) return
  clearTimeout(req.timer)
  w.active = null
  w.lastUsed = Date.now()
  try {
    if (!existsSync(req.outputFile)) {
      req.reject(new Error('Piper não gerou o arquivo de áudio.'))
    } else {
      const buf = readFileSync(req.outputFile)
      cleanupFile(req.outputFile)
      if (buf.length) req.resolve(buf)
      else req.reject(new Error('Piper gerou áudio vazio.'))
    }
  } catch (e) {
    cleanupFile(req.outputFile)
    req.reject(e instanceof Error ? e : new Error(String(e)))
  }
  pump(w)
}

function pump(w: WarmProc): void {
  if (!w.alive || w.active || w.queue.length === 0) return
  const req = w.queue.shift()!
  const outputFile = join(tmpdir(), `ares-piper-${process.pid}-${++reqCounter}.wav`)
  const timer = setTimeout(() => {
    // Travou: mata o processo (a falha propaga via 'exit'/failAll) para forçar fallback.
    cleanupFile(outputFile)
    const active = w.active
    w.active = null
    killWarm(w)
    active?.reject(new Error('Piper (quente) timeout.'))
  }, REQUEST_TIMEOUT_MS)
  w.active = { ...req, outputFile, timer }
  try {
    w.proc.stdin?.write(buildJsonRequest(req.text, outputFile))
  } catch (e) {
    clearTimeout(timer)
    cleanupFile(outputFile)
    w.active = null
    req.reject(e instanceof Error ? e : new Error(String(e)))
    killWarm(w)
  }
}

function evictIfNeeded(): void {
  if (pool.size < MAX_POOL) return
  // Remove o ocioso menos usado recentemente (LRU). Se todos ocupados, deixa passar.
  let lru: WarmProc | null = null
  for (const w of pool.values()) {
    if (w.active || w.queue.length) continue
    if (!lru || w.lastUsed < lru.lastUsed) lru = w
  }
  if (lru) killWarm(lru)
}

/**
 * Sintetiza via processo quente. `text` já deve vir pré-processado (prepareText).
 * Rejeita em qualquer falha — o chamador (piper.ts) cai no caminho um-processo-por-frase.
 */
export function warmSynthesize(params: PiperSynthParams, text: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    if (!existsSync(params.bin) || !existsSync(params.model)) {
      reject(new Error('Piper indisponível.'))
      return
    }
    ensureReaper()
    const key = poolKey(params)
    let w = pool.get(key)
    if (!w || !w.alive) {
      evictIfNeeded()
      w = spawnWarm(params)
      pool.set(key, w)
    }
    w.queue.push({ text, resolve, reject })
    pump(w)
  })
}

/** Encerra todos os processos quentes (chamar no quit do app). */
export function shutdownPiperPool(): void {
  if (reaper) {
    clearInterval(reaper)
    reaper = null
  }
  for (const w of [...pool.values()]) {
    failAll(w, new Error('Encerrando.'))
    killWarm(w)
  }
  pool.clear()
}

/** Apenas para testes/inspeção. */
export function warmPoolSize(): number {
  return pool.size
}
