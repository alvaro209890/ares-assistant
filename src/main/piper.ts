import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync, readdirSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { PIPER_SENTENCE_SILENCE, computeLengthScale, detectTone, prepareText } from './speech'

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
const PIPER_SYNTHESIS_TIMEOUT_MS = 6500
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

/** Sintetiza texto -> WAV via stdout (sem arquivo temporário, menor latência). */
export function synthesize(text: string, opts: { voice?: string; rate?: number } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const bin = binPath()
    const model = resolveVoice(opts.voice)
    if (!existsSync(bin) || !model) return reject(new Error('Piper indisponível.'))

    // Ritmo dinâmico (estilo JARVIS): o tom é inferido do próprio conteúdo — erro fica
    // mais direto/rápido, sucesso mais calmo/elegante. O texto cru entra na detecção;
    // o prepareText cuida da pronúncia (siglas técnicas) e das pausas.
    const lengthScale = computeLengthScale(opts.rate, detectTone(text)).toFixed(3)

    const binDir = dirname(bin)
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
        '--sentence_silence',
        PIPER_SENTENCE_SILENCE,
        '--output-raw'
      ],
      { env, cwd: binDir }
    )
    const chunks: Buffer[] = []
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error('Piper timeout.')))
    }, PIPER_SYNTHESIS_TIMEOUT_MS)
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    let err = ''
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => finish(() => reject(e)))
    child.on('close', (code) => {
      if (done) return
      if (code !== 0) return finish(() => reject(new Error(`Piper falhou: ${err.slice(-200)}`)))
      const raw = Buffer.concat(chunks)
      if (!raw.length) return finish(() => reject(new Error('Piper sem saida de audio.')))
      finish(() => resolve(rawToWav(raw, 22050, 1, 16)))
    })
    try {
      child.stdin.write(prepareText(text))
      child.stdin.end()
    } catch (e) {
      child.kill()
      finish(() => reject(e instanceof Error ? e : new Error(String(e))))
    }
  })
}

/** Encapsula PCM raw em um WAV header mínimo. */
function rawToWav(raw: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const blockAlign = channels * (bitsPerSample / 8)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + raw.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(raw.length, 40)
  return Buffer.concat([header, raw])
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
