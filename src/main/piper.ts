import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'

// Voz neural local via Piper (https://github.com/rhasspy/piper).
// Binário + vozes ficam em userData/piper. É o motor padrão no Linux E no Windows
// (muito mais natural/humano que o espeak no Linux ou as vozes SAPI do Windows).
// Em macOS (ou se o download falhar), o app usa a Web Speech do Chromium.

const PIPER_VERSION = '2023.11.14-2'
const BIN_BASE = `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}`
// Asset por plataforma. Ambos extraem para uma pasta "piper/" com o binário + libs.
const BIN_ASSET: Partial<Record<NodeJS.Platform, string>> = {
  linux: 'piper_linux_x86_64.tar.gz',
  win32: 'piper_windows_amd64.zip'
}
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR'
// faber-medium: voz masculina pt-BR, grave e clara — perfil "JARVIS" profissional.
const DEFAULT_VOICE = {
  name: 'pt_BR-faber-medium',
  onnx: `${VOICE_BASE}/faber/medium/pt_BR-faber-medium.onnx`,
  json: `${VOICE_BASE}/faber/medium/pt_BR-faber-medium.onnx.json`
}

/** Plataformas em que o Piper neural é suportado (tem binário pré-compilado). */
function piperSupported(): boolean {
  return process.platform === 'linux' || process.platform === 'win32'
}

function piperDir(): string {
  return join(app.getPath('userData'), 'piper')
}
function binPath(): string {
  const exe = process.platform === 'win32' ? 'piper.exe' : 'piper'
  return join(piperDir(), 'piper', exe)
}
function voicesDir(): string {
  return join(piperDir(), 'voices')
}

export function isPiperReady(): boolean {
  return piperSupported() && existsSync(binPath()) && listPiperVoices().length > 0
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
    const binDir = dirname(bin)
    // No Linux as libs do Piper ficam ao lado do binário (LD_LIBRARY_PATH).
    // No Windows, as DLLs (onnxruntime etc.) e o espeak-ng-data são resolvidos a
    // partir do diretório de trabalho — por isso rodamos com cwd = pasta do piper.
    const env = {
      ...process.env,
      LD_LIBRARY_PATH: `${binDir}:${process.env.LD_LIBRARY_PATH || ''}`,
      PATH: `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`
    }
    const child = spawn(
      bin,
      [
        '--model',
        model,
        '--length_scale',
        lengthScale,
        // Pausa natural entre frases (cadência mais humana, estilo JARVIS).
        '--sentence_silence',
        '0.28',
        '--output_file',
        out
      ],
      { env, cwd: binDir }
    )
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

/** Extrai o pacote do Piper (tar.gz no Linux, zip no Windows) em piperDir. */
function extractArchive(archive: string): Promise<void> {
  return new Promise<void>((res, rej) => {
    const p =
      process.platform === 'win32'
        ? spawn('powershell', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${piperDir()}' -Force`
          ])
        : spawn('tar', ['-xzf', archive, '-C', piperDir()])
    let err = ''
    p.stderr?.on('data', (d) => (err += d.toString()))
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`extração falhou: ${err.slice(-200)}`))))
    p.on('error', rej)
  })
}

/**
 * Garante o Piper instalado (Linux e Windows). Baixa binário + voz padrão se
 * faltarem. Roda em background no start; até ficar pronto, a fala usa a Web Speech.
 */
export async function ensurePiper(): Promise<boolean> {
  if (!piperSupported()) return false
  if (isPiperReady()) return true
  const asset = BIN_ASSET[process.platform]
  if (!asset) return false
  try {
    mkdirSync(voicesDir(), { recursive: true })
    if (!existsSync(binPath())) {
      const ext = asset.endsWith('.zip') ? 'zip' : 'tar.gz'
      const archive = join(tmpdir(), `piper_bin.${ext}`)
      await download(`${BIN_BASE}/${asset}`, archive)
      await extractArchive(archive)
      rmSync(archive, { force: true })
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
