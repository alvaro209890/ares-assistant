import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Voz neural local via Piper (https://github.com/rhasspy/piper).
// Binário + vozes ficam em userData/piper. No Linux é o motor padrão (muito mais
// natural que o espeak). Em outros SOs, o app usa a Web Speech do Chromium.

const PIPER_VERSION = '2023.11.14-2'
const BIN_URL = `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz`
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR'
const DEFAULT_VOICE = {
  name: 'pt_BR-faber-medium',
  onnx: `${VOICE_BASE}/faber/medium/pt_BR-faber-medium.onnx`,
  json: `${VOICE_BASE}/faber/medium/pt_BR-faber-medium.onnx.json`
}

function piperDir(): string {
  return join(app.getPath('userData'), 'piper')
}
function binPath(): string {
  return join(piperDir(), 'piper', 'piper')
}
function voicesDir(): string {
  return join(piperDir(), 'voices')
}

export function isPiperReady(): boolean {
  return process.platform === 'linux' && existsSync(binPath()) && listPiperVoices().length > 0
}

export function listPiperVoices(): string[] {
  try {
    return readdirSync(voicesDir())
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => f.replace(/\.onnx$/, ''))
  } catch {
    return []
  }
}

function resolveVoice(voice?: string): string {
  const dir = voicesDir()
  if (voice && existsSync(join(dir, `${voice}.onnx`))) return join(dir, `${voice}.onnx`)
  const first = listPiperVoices()[0]
  return first ? join(dir, `${first}.onnx`) : ''
}

/** Sintetiza texto -> WAV (PCM 16-bit). Devolve os bytes do .wav. */
export function synthesize(text: string, opts: { voice?: string; rate?: number } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const bin = binPath()
    const model = resolveVoice(opts.voice)
    if (!existsSync(bin) || !model) return reject(new Error('Piper indisponível.'))

    // rate (0.5..1.6) -> length_scale (inverso: maior rate = fala mais rápida)
    const rate = Math.min(1.6, Math.max(0.5, opts.rate ?? 1))
    const lengthScale = (1 / rate).toFixed(3)

    const out = join(tmpdir(), `ares-tts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`)
    const env = {
      ...process.env,
      LD_LIBRARY_PATH: `${join(piperDir(), 'piper')}:${process.env.LD_LIBRARY_PATH || ''}`
    }
    const child = spawn(bin, ['--model', model, '--length_scale', lengthScale, '--output_file', out], { env })
    let err = ''
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      if (code !== 0 || !existsSync(out)) return reject(new Error(`Piper falhou: ${err.slice(-200)}`))
      try {
        const buf = readFileSync(out)
        rmSync(out, { force: true })
        resolve(buf)
      } catch (e) {
        reject(e as Error)
      }
    })
    child.stdin.write(text)
    child.stdin.end()
  })
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(join(dest, '..'), { recursive: true })
  writeFileSync(dest, buf)
}

/**
 * Garante o Piper instalado (só Linux). Baixa binário + voz padrão se faltarem.
 * Roda em background no start; até ficar pronto, a fala usa a Web Speech.
 */
export async function ensurePiper(): Promise<boolean> {
  if (process.platform !== 'linux') return false
  if (isPiperReady()) return true
  try {
    mkdirSync(voicesDir(), { recursive: true })
    if (!existsSync(binPath())) {
      const tar = join(tmpdir(), 'piper_bin.tar.gz')
      await download(BIN_URL, tar)
      await new Promise<void>((res, rej) => {
        const p = spawn('tar', ['-xzf', tar, '-C', piperDir()])
        p.on('close', (c) => (c === 0 ? res() : rej(new Error('tar falhou'))))
        p.on('error', rej)
      })
      rmSync(tar, { force: true })
      try {
        chmodSync(binPath(), 0o755)
      } catch {
        /* ok */
      }
    }
    const onnx = join(voicesDir(), `${DEFAULT_VOICE.name}.onnx`)
    if (!existsSync(onnx)) {
      await download(DEFAULT_VOICE.onnx, onnx)
      await download(DEFAULT_VOICE.json, `${onnx}.json`)
    }
    return isPiperReady()
  } catch {
    return false
  }
}
