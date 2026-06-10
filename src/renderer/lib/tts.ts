// Sintese de voz do Ares: prioriza inicio rapido e nunca deixa fala antiga presa.

type ActiveAudio = {
  audio: HTMLAudioElement
  url: string
  stop: () => void
}

let currentAudio: ActiveAudio | null = null
let currentWebStop: (() => void) | null = null
let piperStatusCache: { ready: boolean; voices: string[] } | null = null
let piperStatusAge = 0
let piperDisabledUntil = 0

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, err?: unknown): void {
  const formatted = `[TTS] ${message}`
  if (level === 'error') console.error(formatted, err)
  else if (level === 'warn') console.warn(formatted, err)
  else console.log(formatted, err)

  if (window.ares?.logs?.write) {
    window.ares.logs.write(level, 'tts-renderer', message, err).catch(() => {})
  }
}
// Pipelining: enquanto uma frase toca, as PRÓXIMAS já são sintetizadas (até 2 adiantadas)
// — com frases curtas, 1 só não bastava e sobrava um "vão" entre elas.
const prefetched = new Map<string, Promise<ArrayBuffer>>()
const PREFETCH_DEPTH = 2
const PREFETCH_MAX = 4

const PIPER_STATUS_TIMEOUT_MS = 1200
const PIPER_ATTEMPT_TIMEOUT_MS = 3500
const PIPER_TOTAL_BUDGET_MS = 8000
const PIPER_MAX_RETRIES = 2
const PIPER_FAILURE_COOLDOWN_MS = 5000
const WEB_START_TIMEOUT_MS = 2600
const WEB_END_BASE_TIMEOUT_MS = 5000
const WEB_END_PER_CHAR_MS = 85
const WEB_MAX_RETRIES = 2
const MAX_SPEECH_CHUNK_CHARS = 220
const MIN_CHUNK_CHARS = 80

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
  return voices.filter((v) => v.lang?.toLowerCase().startsWith('pt')).sort((a, b) => voiceScore(b) - voiceScore(a))
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
  if (name.includes('antonio') || name.includes('daniel') || name.includes('felipe') || name.includes('fabio'))
    score += 50
  if (name.includes('maria') || name.includes('francisca') || name.includes('thalita') || name.includes('heloisa'))
    score += 10
  if (name.includes('desktop')) score -= 40
  if (name.includes('sapi')) score -= 30
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
  _prefetchedWav?: ArrayBuffer
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function timeoutError(label: string): Error {
  return new Error(`${label} timeout`)
}

export function normalizeSpeechText(input: string): string {
  // PRESERVA vírgulas, dois-pontos e números: a normalização pesada (números por extenso,
  // moeda, hora, versão, símbolos, pausas) é feita no processo principal por prepareText
  // (src/main/speech.ts), que precisa do texto cru. Apagar vírgulas/pontos aqui mutilaria
  // "R$ 1.250,90" e "14:30" antes deles chegarem lá. Aqui só limpamos markdown e ruído.
  const cleaned = String(input || '')
    .replace(/```[\s\S]*?```/g, 'trecho de codigo omitido.')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]{1,100})`/g, '$1')
    .replace(/`[^`]*$/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d{1,2}[.)]\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\.{3,}|…/g, '. ')
    .replace(/([.!?]){2,}/g, '$1')
    .replace(/\s+([.!?,;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  // Se não contém nenhuma letra ou número, considera vazio (evita falar apenas pontuação,
  // o que trava o Web Speech ou gera erros/timeouts no Piper).
  if (!/[\p{L}\p{N}]/u.test(cleaned)) {
    return ''
  }
  return cleaned
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError(label)), Math.max(1, ms))
    work
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

function webEndTimeout(text: string, rate: number): number {
  return Math.min(30000, WEB_END_BASE_TIMEOUT_MS + (text.length * WEB_END_PER_CHAR_MS) / Math.max(0.5, rate))
}

function piperPlaybackTimeout(wav: ArrayBuffer): number {
  // Piper gera WAV PCM mono 22.05 kHz/16-bit; usa o tamanho como estimativa segura.
  const estimatedMs = (wav.byteLength / 44100) * 1000
  return Math.min(45000, Math.max(3500, estimatedMs + 3000))
}

async function webSpeakOnce(
  synth: SpeechSynthesis,
  text: string,
  opts: SpeakOptions,
  voices: SpeechSynthesisVoice[]
): Promise<'ended' | 'cancelled' | 'failed'> {
  log('debug', `webSpeakOnce: text="${text}"`)
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'pt-BR'
  const win = window.ares.system.platform === 'win32'
  u.rate = opts.rate ?? (win ? 1.08 : 1.04)
  u.pitch = opts.pitch ?? (win ? 0.78 : 0.9)
  u.volume = opts.volume ?? 1
  const chosen =
    (opts.voiceURI && voices.find((v) => v.voiceURI === opts.voiceURI)) ||
    ptVoices(voices)[0] ||
    voices[0] ||
    null
  if (chosen) u.voice = chosen

  return new Promise((resolve) => {
    let settled = false
    let started = false
    let endTimer: ReturnType<typeof setTimeout> | null = null
    let resumeTimer: ReturnType<typeof setInterval> | null = null
    const startTimer = setTimeout(() => {
      if (!started) {
        log('warn', `webSpeakOnce: SpeechSynthesis start timeout for "${text}"`)
        synth.cancel()
        finish('failed')
      }
    }, WEB_START_TIMEOUT_MS)

    const finish = (kind: 'ended' | 'cancelled' | 'failed') => {
      if (settled) return
      settled = true
      log('debug', `webSpeakOnce finished: text="${text}", result=${kind}`)
      clearTimeout(startTimer)
      if (endTimer) clearTimeout(endTimer)
      if (resumeTimer) clearInterval(resumeTimer)
      currentWebStop = null
      resolve(kind)
    }

    currentWebStop = () => finish('cancelled')
    u.onstart = () => {
      started = true
      log('debug', `webSpeakOnce started speaking: "${text}"`)
      opts.onStart?.()
      resumeTimer = setInterval(() => synth.resume(), 700)
      endTimer = setTimeout(() => {
        log('warn', `webSpeakOnce: SpeechSynthesis playback timeout for "${text}"`)
        synth.cancel()
        finish('failed')
      }, webEndTimeout(text, u.rate))
    }
    u.onend = () => finish('ended')
    u.onerror = (e) => {
      const err = (e as SpeechSynthesisErrorEvent).error
      log('warn', `webSpeakOnce error for "${text}": ${err}`)
      finish(err === 'canceled' || err === 'interrupted' ? 'cancelled' : 'failed')
    }
    synth.speak(u)
    synth.resume()
    setTimeout(() => synth.resume(), 80)
    setTimeout(() => synth.resume(), 250)
  })
}

async function webSpeak(text: string, opts: SpeakOptions): Promise<'ok' | 'failed' | 'cancelled'> {
  log('info', `webSpeak: starting fallback webSpeak for "${text}"`)
  const synth = window.speechSynthesis
  if (!synth) {
    log('error', 'webSpeak: window.speechSynthesis is not available')
    opts.onError?.('Sintese de voz indisponivel neste sistema.')
    return 'failed'
  }

  let voices = synth.getVoices()
  if (!voices.length) voices = await loadVoices()

  for (let attempt = 0; attempt < WEB_MAX_RETRIES; attempt++) {
    log('debug', `webSpeak: attempt ${attempt + 1} of ${WEB_MAX_RETRIES}`)
    synth.cancel()
    const result = await webSpeakOnce(synth, text, opts, voices)
    if (result === 'ended') {
      opts.onEnd?.()
      return 'ok'
    }
    if (result === 'cancelled') return 'cancelled'
    if (attempt < WEB_MAX_RETRIES - 1) {
      log('debug', `webSpeak: delay before retry`)
      await delay(140)
      continue
    }
  }
  log('error', `webSpeak: all ${WEB_MAX_RETRIES} attempts failed for "${text}"`)
  opts.onError?.('Web Speech nao iniciou a fala; tente trocar a voz em Configuracoes.')
  return 'failed'
}

async function getPiperStatus(): Promise<{ ready: boolean; voices: string[] }> {
  const now = Date.now()
  if (piperStatusCache && now - piperStatusAge < 30000) return piperStatusCache
  try {
    piperStatusCache = await withTimeout(window.ares.tts.status(), PIPER_STATUS_TIMEOUT_MS, 'Piper status')
    piperStatusAge = now
    return piperStatusCache
  } catch {
    return { ready: false, voices: [] }
  }
}

function synthesizeAttempt(text: string, voice?: string, rate?: number, timeoutMs = PIPER_ATTEMPT_TIMEOUT_MS): Promise<ArrayBuffer> {
  return withTimeout(window.ares.tts.synthesize(text, { voice, rate }), timeoutMs, 'Piper')
}

async function synthesizeWithRetry(text: string, voice?: string, rate?: number): Promise<ArrayBuffer> {
  const deadline = Date.now() + PIPER_TOTAL_BUDGET_MS
  let lastErr: unknown
  for (let attempt = 0; attempt < PIPER_MAX_RETRIES; attempt++) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    try {
      return await synthesizeAttempt(text, voice, rate, Math.min(PIPER_ATTEMPT_TIMEOUT_MS, remaining))
    } catch (e) {
      lastErr = e
      if (attempt < PIPER_MAX_RETRIES - 1) await delay(Math.min(400, 180 * 2 ** attempt))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Piper: todas as tentativas falharam.')
}

function prefetchKey(cleanText: string, opts: SpeakOptions): string {
  return `${opts.piperVoice || ''}|${opts.rate ?? ''}|${cleanText}`
}

/** Dispara a síntese de uma frase futura (Piper) durante a reprodução da atual. */
function startPrefetch(text: string, opts: SpeakOptions): void {
  if (!prefersPiper(opts) || Date.now() < piperDisabledUntil) return
  const clean = normalizeSpeechText(text)
  if (!clean) return
  const key = prefetchKey(clean, opts)
  if (prefetched.has(key)) return
  if (prefetched.size >= PREFETCH_MAX) {
    const oldest = prefetched.keys().next().value
    if (oldest !== undefined) prefetched.delete(oldest)
  }
  const promise = synthesizeWithRetry(clean, opts.piperVoice, opts.rate)
  promise.catch(() => {}) // evita unhandledRejection; o consumidor relança se precisar
  prefetched.set(key, promise)
}

/** Consome a síntese pré-buscada para este texto, se existir e bater a chave. */
async function takePrefetched(cleanText: string, opts: SpeakOptions): Promise<ArrayBuffer | null> {
  const key = prefetchKey(cleanText, opts)
  const p = prefetched.get(key)
  if (!p) return null
  prefetched.delete(key)
  try {
    return await p
  } catch {
    return null
  }
}

async function piperSpeak(text: string, opts: SpeakOptions, force = false): Promise<boolean> {
  log('debug', `piperSpeak: force=${force}, text="${text}"`)
  try {
    if (!force && Date.now() < piperDisabledUntil) {
      log('debug', `piperSpeak: Piper cooldown active, skipping Piper for now`)
      return false
    }
    const status = await getPiperStatus()
    if (!status.ready || !status.voices.length) {
      log('debug', `piperSpeak: Piper status is not ready or no voices, skipping Piper`)
      return false
    }
    log('debug', `piperSpeak: status is ready, fetching audio for "${text}"`)
    const wav =
      opts._prefetchedWav ??
      (await takePrefetched(text, opts)) ??
      (await synthesizeWithRetry(text, opts.piperVoice, opts.rate))
    
    log('debug', `piperSpeak: audio data received successfully, length=${wav.byteLength}`)
    const blob = new Blob([wav], { type: 'audio/wav' })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.volume = opts.volume ?? 1

    const result = await new Promise<'ended' | 'cancelled'>((resolve, reject) => {
      let settled = false
      const playbackTimer = setTimeout(() => {
        log('warn', `piperSpeak: playback timeout for "${text}"`)
        fail(new Error('Timeout ao reproduzir audio Piper.'))
      }, piperPlaybackTimeout(wav))
      const finish = (kind: 'ended' | 'cancelled') => {
        if (settled) return
        settled = true
        clearTimeout(playbackTimer)
        URL.revokeObjectURL(url)
        if (currentAudio?.audio === audio) currentAudio = null
        resolve(kind)
      }
      const fail = (err: Error) => {
        if (settled) return
        settled = true
        clearTimeout(playbackTimer)
        URL.revokeObjectURL(url)
        if (currentAudio?.audio === audio) currentAudio = null
        audio.pause()
        audio.src = ''
        reject(err)
      }
      currentAudio = {
        audio,
        url,
        stop: () => {
          log('debug', `piperSpeak: stop called for "${text}"`)
          audio.pause()
          audio.src = ''
          finish('cancelled')
        }
      }
      audio.onended = () => {
        log('debug', `piperSpeak: audio.onended for "${text}"`)
        finish('ended')
      }
      audio.onerror = () => {
        log('warn', `piperSpeak: audio.onerror for "${text}"`)
        fail(new Error('Falha ao reproduzir audio Piper.'))
      }
      opts.onStart?.()
      log('info', `piperSpeak: playing audio for "${text}"`)
      void audio.play().catch((e) => {
        log('warn', `piperSpeak: audio.play failed for "${text}"`, e)
        fail(e instanceof Error ? e : new Error(String(e)))
      })
    })

    if (result === 'ended') opts.onEnd?.()
    log('debug', `piperSpeak completed for "${text}" with result: ${result}`)
    return true
  } catch (err) {
    log('warn', `piperSpeak: failed to synthesize or play "${text}"`, err)
    // Evita repetir timeout em todas as frases do mesmo turno.
    piperDisabledUntil = Date.now() + PIPER_FAILURE_COOLDOWN_MS
    return false
  }
}

function prefersPiper(opts: SpeakOptions): boolean {
  const platform = window.ares.system.platform
  // Piper neural é o padrão no Linux E no Windows (muito mais natural que SAPI/Web Speech);
  // o Web Speech fica como fallback. macOS não tem binário do Piper -> usa Web Speech.
  return opts.engine === 'piper' || (opts.engine === 'auto' && (platform === 'linux' || platform === 'win32'))
}

async function speakInternal(text: string, opts: SpeakOptions, cancelBefore: boolean): Promise<void> {
  log('debug', `speakInternal: text="${text}", cancelBefore=${cancelBefore}`)
  const clean = normalizeSpeechText(text)
  if (!clean) {
    log('debug', `speakInternal: text normalized to empty, skipping speech`)
    opts.onEnd?.()
    return
  }
  if (cancelBefore) cancelSpeech()
  if (prefersPiper(opts)) {
    log('debug', `speakInternal: prefers Piper engine`)
    const ok = await piperSpeak(clean, opts)
    if (ok) return
    log('warn', `speakInternal: Piper failed, trying web fallback`)
    const webResult = await webSpeak(clean, opts)
    if (webResult === 'failed') opts.onEnd?.()
    return
  }
  log('debug', `speakInternal: prefers Web Speech engine`)
  const webResult = await webSpeak(clean, opts)
  if (webResult === 'ok' || webResult === 'cancelled') return
  if (opts.engine !== 'web') {
    log('warn', `speakInternal: Web Speech failed, trying Piper fallback`)
    const ok = await piperSpeak(clean, opts, true)
    if (!ok) opts.onEnd?.()
    return
  }
  opts.onEnd?.()
}

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  log('info', `speak: "${text}"`)
  sentenceQueue = []
  prefetched.clear()
  queueGeneration++
  await speakInternal(text, opts, true)
  resolveIdle()
}

export function cancelSpeech(): void {
  log('info', 'cancelSpeech called')
  currentWebStop?.()
  currentWebStop = null
  window.speechSynthesis?.cancel()
  currentAudio?.stop()
  currentAudio = null
}

let sentenceQueue: { text: string; opts: SpeakOptions }[] = []
let draining = false
let idleWaiters: (() => void)[] = []
let queueGeneration = 0

function resolveIdle(): void {
  const waiters = idleWaiters
  idleWaiters = []
  log('debug', `resolveIdle: resolving ${waiters.length} idle waiters`)
  waiters.forEach((fn) => fn())
}

async function drainQueue(): Promise<void> {
  if (draining) {
    log('debug', 'drainQueue: already draining, returning')
    return
  }
  draining = true
  const generation = queueGeneration
  log('debug', `drainQueue started: queue size=${sentenceQueue.length}, generation=${generation}`)
  while (sentenceQueue.length && generation === queueGeneration) {
    const { text, opts } = sentenceQueue.shift()!
    log('debug', `drainQueue: speaking sentence: "${text}", remaining queue=${sentenceQueue.length}`)
    // Adianta a síntese das PRÓXIMAS frases enquanto esta toca -> fala quase contínua
    // mesmo quando as frases são curtas (a reprodução não espera a síntese).
    for (let i = 0; i < PREFETCH_DEPTH && i < sentenceQueue.length; i++) {
      startPrefetch(sentenceQueue[i].text, sentenceQueue[i].opts)
    }
    await speakInternal(text, opts, false)
    if (generation !== queueGeneration) {
      log('debug', 'drainQueue: generation changed, breaking')
      break
    }
  }
  if (generation === queueGeneration) {
    draining = false
  } else {
    draining = false
  }
  log('debug', 'drainQueue: finished loop, resolving idle')
  resolveIdle()
}

export function enqueueSentence(text: string, opts: SpeakOptions): void {
  const t = text.trim()
  if (!t) return
  log('info', `enqueueSentence: "${t}"`)
  sentenceQueue.push({ text: t, opts })
  void drainQueue()
}

export function whenSpeechQueueIdle(): Promise<void> {
  if (!draining && sentenceQueue.length === 0) return Promise.resolve()
  return new Promise((resolve) => idleWaiters.push(resolve))
}

export function clearSpeechQueue(): void {
  log('info', 'clearSpeechQueue called')
  sentenceQueue = []
  prefetched.clear()
  // Reset hard do subsistema de fala (barge-in / novo turno): zera também o "cooldown" do
  // Piper para não carregar penalidade transitória de um turno anterior ao começar outro.
  piperDisabledUntil = 0
  queueGeneration++
  cancelSpeech()
  draining = false
  resolveIdle()
}

const SENTENCE_RE = /.*?(?:[.!?…]+(?=\s|["')\]}*_]|$)|[\n]+)["')\]}*_]*/g

// Partida rápida: quando NADA foi falado ainda neste turno, vale a pena cortar a
// primeira oração na vírgula/conector para a voz começar ~1 frase antes. Só o
// primeiro trecho usa isso — o resto espera pontuação final, preservando a prosódia.
const EAGER_MIN_CHARS = 48
const EAGER_MAX_CHARS = 140

function eagerSplitIndex(buffer: string): number {
  if (buffer.length < EAGER_MAX_CHARS) return -1
  const windowText = buffer.slice(EAGER_MIN_CHARS, EAGER_MAX_CHARS)
  const comma = Math.max(windowText.lastIndexOf(','), windowText.lastIndexOf(';'), windowText.lastIndexOf(':'))
  return comma >= 0 ? EAGER_MIN_CHARS + comma + 1 : -1
}

function chunkSplitIndex(text: string): number {
  if (text.length <= MAX_SPEECH_CHUNK_CHARS) return -1
  const windowText = text.slice(MIN_CHUNK_CHARS, MAX_SPEECH_CHUNK_CHARS)
  const punctuation = Math.max(
    windowText.lastIndexOf('.'),
    windowText.lastIndexOf('!'),
    windowText.lastIndexOf('?'),
    windowText.lastIndexOf('\n')
  )
  if (punctuation >= 0) return MIN_CHUNK_CHARS + punctuation + 1
  const soft = Math.max(
    windowText.lastIndexOf(' '),
    windowText.lastIndexOf(','),
    windowText.lastIndexOf(';'),
    windowText.lastIndexOf(':')
  )
  return soft >= 0 ? MIN_CHUNK_CHARS + soft + 1 : MAX_SPEECH_CHUNK_CHARS
}

export function splitSentences(
  buffer: string,
  final: boolean,
  opts: { eager?: boolean } = {}
): { sentences: string[]; rest: string } {
  log('debug', `splitSentences: input length=${buffer.length}, final=${final}, eager=${!!opts.eager}`)
  const sentences: string[] = []
  let lastIndex = 0
  let m: RegExpExecArray | null
  SENTENCE_RE.lastIndex = 0
  while ((m = SENTENCE_RE.exec(buffer))) {
    const s = m[0].trim()
    // Apenas enfileira frases que tenham pelo menos uma letra ou número
    if (s && /[\p{L}\p{N}]/u.test(s)) {
      sentences.push(s)
      log('debug', `splitSentences: matched regex sentence="${s}"`)
    }
    lastIndex = SENTENCE_RE.lastIndex
  }
  let rest = buffer.slice(lastIndex)
  // Sem frase completa ainda E nada falado neste turno: corta a primeira oração
  // na vírgula para reduzir a latência até o primeiro som.
  if (!final && opts.eager && sentences.length === 0) {
    const idx = eagerSplitIndex(rest)
    if (idx > 0) {
      const head = rest.slice(0, idx).trim()
      if (head && /[\p{L}\p{N}]/u.test(head)) {
        sentences.push(head)
        log('debug', `splitSentences: eager split sentence="${head}"`)
      }
      rest = rest.slice(idx)
    }
  }
  while (!final) {
    const idx = chunkSplitIndex(rest)
    if (idx < 0) break
    const chunk = rest.slice(0, idx).trim()
    if (chunk && /[\p{L}\p{N}]/u.test(chunk)) {
      sentences.push(chunk)
      log('debug', `splitSentences: chunk split non-final sentence="${chunk}"`)
    }
    rest = rest.slice(idx)
  }
  if (final && rest.trim()) {
    let pending = rest.trim()
    while (pending.length > MAX_SPEECH_CHUNK_CHARS) {
      const idx = chunkSplitIndex(pending)
      if (idx < 0) break
      const chunk = pending.slice(0, idx).trim()
      if (chunk && /[\p{L}\p{N}]/u.test(chunk)) {
        sentences.push(chunk)
        log('debug', `splitSentences: chunk split final sentence="${chunk}"`)
      }
      pending = pending.slice(idx).trim()
    }
    if (pending && /[\p{L}\p{N}]/u.test(pending)) {
      sentences.push(pending)
      log('debug', `splitSentences: final remaining sentence="${pending}"`)
    }
    rest = ''
  }
  log('debug', `splitSentences result: sentences count=${sentences.length}, rest length=${rest.length}`)
  return { sentences, rest }
}
