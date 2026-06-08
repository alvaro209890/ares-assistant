// Síntese de voz do Ares.
// No Linux e no Windows usa Piper local (neural) quando disponível — voz grave e
// humana, estilo JARVIS. Web Speech/Chromium fica como fallback (enquanto o Piper
// ainda baixa, ou no macOS).

let currentAudio: HTMLAudioElement | null = null

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    const existing = synth?.getVoices?.() ?? []
    if (existing.length) return resolve(existing)

    let done = false
    const finish = () => {
      if (done) return
      done = true
      synth?.removeEventListener?.('voiceschanged', finish)
      resolve(synth?.getVoices?.() ?? [])
    }
    synth?.addEventListener?.('voiceschanged', finish)
    setTimeout(finish, 1400)
  })
}

export function ptVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const pt = voices.filter((v) => v.lang?.toLowerCase().startsWith('pt'))
  return pt.sort((a, b) => voiceScore(b) - voiceScore(a))
}

function voiceScore(v: SpeechSynthesisVoice): number {
  const name = `${v.name} ${v.voiceURI}`.toLowerCase()
  const lang = v.lang?.toLowerCase() || ''
  let score = 0
  if (lang === 'pt-br') score += 100
  else if (lang.startsWith('pt')) score += 60
  if (name.includes('natural')) score += 80
  if (name.includes('neural')) score += 70
  if (name.includes('online')) score += 40
  if (name.includes('microsoft')) score += 25
  if (name.includes('google')) score += 30
  // Perfil JARVIS: preferir vozes masculinas e graves quando houver opção.
  if (name.includes('antonio') || name.includes('daniel') || name.includes('felipe') || name.includes('fabio'))
    score += 30
  if (name.includes('maria') || name.includes('francisca') || name.includes('thalita') || name.includes('heloisa'))
    score += 15
  if (name.includes('desktop')) score -= 30 // vozes SAPI "desktop" são as mais robóticas
  return score
}

export interface SpeakOptions {
  engine?: 'auto' | 'piper' | 'web'
  piperVoice?: string
  voiceURI?: string
  rate?: number
  pitch?: number
  volume?: number
  onStart?: () => void
  onEnd?: () => void
  onError?: (msg: string) => void
}

async function webSpeak(text: string, opts: SpeakOptions): Promise<void> {
  const synth = window.speechSynthesis
  if (!synth) {
    opts.onError?.('Síntese de voz indisponível neste sistema.')
    opts.onEnd?.()
    return
  }
  // No Windows/Electron a 1ª fala costuma ser engolida quando getVoices() ainda
  // está vazio. Espera as vozes carregarem antes de falar.
  let voices = synth.getVoices()
  if (!voices.length) voices = await loadVoices()
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'pt-BR'
  const win = window.ares.system.platform === 'win32'
  u.rate = opts.rate ?? (win ? 0.92 : 1)
  u.pitch = opts.pitch ?? (win ? 1.04 : 1)
  u.volume = opts.volume ?? 1
  const chosen =
    (opts.voiceURI && voices.find((v) => v.voiceURI === opts.voiceURI)) ||
    ptVoices(voices)[0] ||
    voices[0] ||
    null
  if (chosen) u.voice = chosen
  u.onstart = () => opts.onStart?.()
  u.onend = () => opts.onEnd?.()
  u.onerror = (e) => {
    const err = (e as SpeechSynthesisErrorEvent).error
    // "canceled"/"interrupted" são esperados em barge-in; não trate como falha.
    if (err !== 'canceled' && err !== 'interrupted') opts.onError?.(`Falha na fala (${err}).`)
    opts.onEnd?.()
  }
  synth.speak(u)
  // Workaround do Chromium: às vezes a fila fica "pausada" e nada toca.
  synth.resume()
}

async function piperSpeak(text: string, opts: SpeakOptions): Promise<boolean> {
  try {
    const status = await window.ares.tts.status()
    if (!status.ready || !status.voices.length) return false
    const wav = await window.ares.tts.synthesize(text, { voice: opts.piperVoice, rate: opts.rate })
    const blob = new Blob([wav], { type: 'audio/wav' })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.volume = opts.volume ?? 1
    currentAudio = audio
    opts.onStart?.()
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error('Falha ao reproduzir áudio Piper.'))
      void audio.play().catch(reject)
    })
    URL.revokeObjectURL(url)
    if (currentAudio === audio) currentAudio = null
    opts.onEnd?.()
    return true
  } catch (e) {
    opts.onError?.(e instanceof Error ? e.message : String(e))
    return false
  }
}

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  const clean = text.trim()
  if (!clean) {
    opts.onEnd?.()
    return
  }
  cancelSpeech()
  const platform = window.ares.system.platform
  const wantsPiper =
    opts.engine === 'piper' ||
    (opts.engine !== 'web' && (platform === 'linux' || platform === 'win32'))
  if (wantsPiper) {
    const ok = await piperSpeak(clean, opts)
    // Se o Piper foi forçado mas falhou, ainda assim cai para a Web Speech (assim
    // o usuário nunca fica sem voz — ex.: Windows enquanto o Piper ainda baixa).
    if (ok) return
  }
  await webSpeak(clean, opts)
}

export function cancelSpeech(): void {
  window.speechSynthesis?.cancel()
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
}

// ---------------------------------------------------------------------------
// Fila de fala por sentença (para o modo streaming): cada frase completa entra
// na fila e é falada em sequência, sem esperar a resposta inteira ser gerada.
// ---------------------------------------------------------------------------
let sentenceQueue: { text: string; opts: SpeakOptions }[] = []
let draining = false
let idleWaiters: (() => void)[] = []

function resolveIdle(): void {
  const waiters = idleWaiters
  idleWaiters = []
  waiters.forEach((fn) => fn())
}

async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  while (sentenceQueue.length) {
    const { text, opts } = sentenceQueue.shift()!
    await new Promise<void>((resolve) => {
      void speak(text, {
        ...opts,
        onEnd: () => resolve(),
        // Preserva o onError original (para a UI mostrar a falha) e segue a fila.
        onError: (msg) => {
          opts.onError?.(msg)
          resolve()
        }
      })
    })
  }
  draining = false
  resolveIdle()
}

/** Coloca uma sentença na fila de fala e inicia/continua a reprodução. */
export function enqueueSentence(text: string, opts: SpeakOptions): void {
  const t = text.trim()
  if (!t) return
  sentenceQueue.push({ text: t, opts })
  void drainQueue()
}

/** Resolve quando a fila de fala terminar (ou imediatamente se já vazia). */
export function whenSpeechQueueIdle(): Promise<void> {
  if (!draining && sentenceQueue.length === 0) return Promise.resolve()
  return new Promise((resolve) => idleWaiters.push(resolve))
}

/** Esvazia a fila e interrompe a fala atual (ex.: novo turno / barge-in). */
export function clearSpeechQueue(): void {
  sentenceQueue = []
  cancelSpeech()
  draining = false
  resolveIdle()
}

const SENTENCE_RE = /[^.!?…\n]*[.!?…\n]+/g

/**
 * Quebra um buffer de texto em sentenças completas + o resto incompleto.
 * Com final=true, o resto também vira sentença (flush ao terminar o stream).
 */
export function splitSentences(buffer: string, final: boolean): { sentences: string[]; rest: string } {
  const sentences: string[] = []
  let lastIndex = 0
  let m: RegExpExecArray | null
  SENTENCE_RE.lastIndex = 0
  while ((m = SENTENCE_RE.exec(buffer))) {
    const s = m[0].trim()
    if (s) sentences.push(s)
    lastIndex = SENTENCE_RE.lastIndex
  }
  let rest = buffer.slice(lastIndex)
  if (final && rest.trim()) {
    sentences.push(rest.trim())
    rest = ''
  }
  return { sentences, rest }
}
