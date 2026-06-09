import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync, readdirSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { PIPER_SENTENCE_SILENCE, computeLengthScale, computeNoise, detectTone, prepareText } from './speech'
import { warmSynthesize, type PiperSynthParams } from './piperEngine'

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

/** Variáveis de ambiente para o processo do Piper achar suas libs (Linux e Windows). */
function piperEnv(binDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LD_LIBRARY_PATH: `${binDir}:${process.env.LD_LIBRARY_PATH || ''}`,
    PATH: `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`
  }
}

/**
 * Sintetiza texto -> WAV. Tenta primeiro o engine "quente" (processo persistente, modelo
 * já carregado = latência mínima) e cai no modo um-processo-por-frase em qualquer falha.
 *
 * Ritmo e expressividade dinâmicos (estilo JARVIS): o tom é inferido do conteúdo — erro
 * fica mais direto/seco, sucesso mais calmo/caloroso. prepareText cuida da pronúncia
 * (números, siglas) e das pausas; é aplicado uma única vez aqui.
 */
export async function synthesize(text: string, opts: { voice?: string; rate?: number } = {}): Promise<Buffer> {
  const bin = binPath()
  const model = resolveVoice(opts.voice)
  if (!existsSync(bin) || !model) throw new Error('Piper indisponível.')

  const tone = detectTone(text)
  const noise = computeNoise(tone)
  const params: PiperSynthParams = {
    bin,
    model,
    lengthScale: computeLengthScale(opts.rate, tone).toFixed(3),
    noiseScale: noise.noiseScale.toFixed(3),
    noiseW: noise.noiseW.toFixed(3),
    sentenceSilence: PIPER_SENTENCE_SILENCE,
    env: piperEnv(dirname(bin)),
    cwd: dirname(bin)
  }
  const prepared = prepareText(text)

  try {
    return await warmSynthesize(params, prepared)
  } catch {
    return await synthesizeOneShot(params, prepared)
  }
}

/** Caminho de reserva: um processo por frase, áudio cru via stdout. */
function synthesizeOneShot(params: PiperSynthParams, prepared: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      params.bin,
      [
        '--model', params.model,
        '--length_scale', params.lengthScale,
        '--noise_scale', params.noiseScale,
        '--noise_w', params.noiseW,
        '--sentence_silence', params.sentenceSilence,
        '--output-raw'
      ],
      { env: params.env, cwd: params.cwd }
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
      child.stdin.write(prepared)
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
