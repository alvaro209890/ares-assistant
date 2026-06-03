// Captura de microfone + análise de áudio para a orbe reagir em tempo real.
// O stream e o AnalyserNode ficam vivos enquanto o Ares "ouve", para a visualização.

let stream: MediaStream | null = null
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let mimeType = 'audio/webm'

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c
  }
  return ''
}

/** Garante acesso ao microfone e prepara o analisador. Pode lançar (permissão negada). */
export async function ensureMic(): Promise<void> {
  if (stream && audioCtx && analyser) {
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    return
  }
  stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') await audioCtx.resume()
  const source = audioCtx.createMediaStreamSource(stream)
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.8
  source.connect(analyser)
}

export function getAnalyser(): AnalyserNode | null {
  return analyser
}

const _timeBuf = new Uint8Array(1024)

/** Nível de áudio atual (0..1, RMS). Usado para escalar/deformar a orbe. */
export function getLevel(): number {
  if (!analyser) return 0
  analyser.getByteTimeDomainData(_timeBuf)
  let sum = 0
  for (let i = 0; i < _timeBuf.length; i++) {
    const v = (_timeBuf[i] - 128) / 128
    sum += v * v
  }
  return Math.min(1, Math.sqrt(sum / _timeBuf.length) * 3.2)
}

/** Começa a gravar (push-to-talk). Reaproveita o stream já aberto. */
export async function startRecording(): Promise<void> {
  await ensureMic()
  if (!stream) throw new Error('Microfone indisponível.')
  mimeType = pickMime()
  chunks = []
  recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  recorder.start()
}

/** Para a gravação e devolve o áudio capturado + o mimeType usado. */
export function stopRecording(): Promise<{ blob: Blob; mimeType: string }> {
  return new Promise((resolve, reject) => {
    if (!recorder) return reject(new Error('Nenhuma gravação em andamento.'))
    const used = recorder.mimeType || mimeType || 'audio/webm'
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: used })
      recorder = null
      resolve({ blob, mimeType: used })
    }
    recorder.stop()
  })
}

/**
 * Grava até detectar silêncio (modo conversa contínua). Espera o usuário começar
 * a falar (até maxWaitMs) e encerra após silenceMs de silêncio, ou no máximo maxMs.
 */
export async function recordUntilSilence(
  opts: { silenceMs?: number; maxWaitMs?: number; maxMs?: number; threshold?: number } = {}
): Promise<{ blob: Blob; mimeType: string; spoke: boolean }> {
  const silenceMs = opts.silenceMs ?? 1100
  const maxWaitMs = opts.maxWaitMs ?? 6000
  const maxMs = opts.maxMs ?? 14000
  const threshold = opts.threshold ?? 0.06

  await startRecording()
  const start = performance.now()
  let spoke = false
  let lastVoice = start

  await new Promise<void>((resolve) => {
    const tick = () => {
      const now = performance.now()
      const level = getLevel()
      if (level > threshold) {
        spoke = true
        lastVoice = now
      }
      const waitedTooLong = !spoke && now - start > maxWaitMs
      const silentEnough = spoke && now - lastVoice > silenceMs
      const hardStop = now - start > maxMs
      if (waitedTooLong || silentEnough || hardStop) return resolve()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  const { blob, mimeType: mt } = await stopRecording()
  return { blob, mimeType: mt, spoke }
}
