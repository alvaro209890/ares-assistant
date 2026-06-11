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
  // echoCancellation reduz o áudio da própria voz do Ares no microfone, o que
  // torna o barge-in (interromper falando) confiável e melhora a captação geral.
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  })
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

const waitFrame = () => new Promise<number>((resolve) => setTimeout(resolve, 16))

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
  opts: { silenceMs?: number; maxWaitMs?: number; maxMs?: number; threshold?: number; shouldStop?: () => boolean } = {}
): Promise<{ blob: Blob; mimeType: string; spoke: boolean }> {
  const silenceMs = opts.silenceMs ?? 1350
  const maxWaitMs = opts.maxWaitMs ?? 10000
  const maxMs = opts.maxMs ?? 24000
  const baseThreshold = opts.threshold ?? 0.045

  await startRecording()
  const calibrationStart = performance.now()
  const samples: number[] = []
  while (performance.now() - calibrationStart < 520 && !opts.shouldStop?.()) {
    samples.push(getLevel())
    await waitFrame()
  }
  samples.sort((a, b) => a - b)
  const ambient = samples[Math.floor(samples.length * 0.8)] ?? 0
  const threshold = Math.max(baseThreshold, ambient * 2.6 + 0.018)
  const releaseThreshold = threshold * 0.72

  const start = performance.now()
  let spoke = false
  let lastVoice = start
  let voiceMs = 0
  let lastTick = start

  await new Promise<void>((resolve) => {
    const tick = () => {
      const now = performance.now()
      const dt = now - lastTick
      lastTick = now
      if (opts.shouldStop?.()) return resolve()
      const level = getLevel()
      if (level > threshold) {
        voiceMs += dt
        lastVoice = now
      } else {
        voiceMs = Math.max(0, voiceMs - dt * 0.45)
        if (spoke && level > releaseThreshold) lastVoice = now
      }
      if (!spoke && voiceMs >= 180) spoke = true
      const waitedTooLong = !spoke && now - start > maxWaitMs
      const silentEnough = spoke && now - lastVoice > silenceMs && now - start > 900
      const hardStop = now - start > maxMs
      if (waitedTooLong || silentEnough || hardStop) return resolve()
      setTimeout(tick, 16)
    }
    setTimeout(tick, 16)
  })

  const { blob, mimeType: mt } = await stopRecording()
  return { blob, mimeType: mt, spoke }
}

/**
 * Monitora o microfone (sem gravar) enquanto o Ares fala e resolve `true` quando
 * detecta fala SUSTENTADA do usuário — o gatilho do barge-in (interromper a fala).
 * Resolve `false` se shouldStop() ficar verdadeiro (a fala do Ares terminou).
 * Usa um limiar mais alto que a escuta normal e, com echoCancellation ativo, a
 * própria voz do Ares some do microfone, evitando auto-interrupção.
 */
export async function watchForSpeech(
  opts: { threshold?: number; sustainMs?: number; shouldStop?: () => boolean } = {}
): Promise<boolean> {
  await ensureMic()
  const threshold = opts.threshold ?? 0.12
  const sustainMs = opts.sustainMs ?? 380
  return new Promise<boolean>((resolve) => {
    let voiceMs = 0
    let last = performance.now()
    // setTimeout, NÃO requestAnimationFrame: rAF congela com a janela minimizada/oculta,
    // e este watcher precisa terminar mesmo em segundo plano (senão o turno trava
    // esperando o barge-in para sempre).
    const tick = (): void => {
      if (opts.shouldStop?.()) return resolve(false)
      const now = performance.now()
      const dt = now - last
      last = now
      const level = getLevel()
      if (level > threshold) voiceMs += dt
      else voiceMs = Math.max(0, voiceMs - dt * 0.6)
      if (voiceMs >= sustainMs) return resolve(true)
      setTimeout(tick, 80)
    }
    setTimeout(tick, 80)
  })
}

let playbackAnalyser: AnalyserNode | null = null
const _playbackTimeBuf = new Uint8Array(1024)

/** Conecta um elemento HTMLAudioElement de reprodução ao analisador de playback. */
export function connectPlaybackAudio(audioElement: HTMLAudioElement): void {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext()
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }
    if (!playbackAnalyser) {
      playbackAnalyser = audioCtx.createAnalyser()
      playbackAnalyser.fftSize = 1024
      playbackAnalyser.smoothingTimeConstant = 0.8
    }
    // Conecta a fonte do elemento ao analisador
    const source = audioCtx.createMediaElementSource(audioElement)
    source.connect(playbackAnalyser)
    // Conecta o analisador aos alto-falantes
    playbackAnalyser.connect(audioCtx.destination)
  } catch (e) {
    console.warn('[Audio] Falha ao conectar áudio de reprodução ao analisador Web Audio', e)
  }
}

/** Retorna o nível de volume/frequência de reprodução (RMS) atual. */
export function getPlaybackLevel(): number {
  if (!playbackAnalyser) return 0
  try {
    playbackAnalyser.getByteTimeDomainData(_playbackTimeBuf)
    let sum = 0
    for (let i = 0; i < _playbackTimeBuf.length; i++) {
      const v = (_playbackTimeBuf[i] - 128) / 128
      sum += v * v
    }
    return Math.min(1, Math.sqrt(sum / _playbackTimeBuf.length) * 3.2)
  } catch {
    return 0
  }
}
