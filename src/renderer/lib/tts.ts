// Síntese de voz do Ares.
// No Linux, usa Piper local (neural) quando disponível. Web Speech/Chromium fica
// como fallback e também atende outros sistemas.

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
  return pt.sort((a, b) => {
    const ab = a.lang.toLowerCase() === 'pt-br' ? -1 : 0
    const bb = b.lang.toLowerCase() === 'pt-br' ? -1 : 0
    return ab - bb
  })
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

function webSpeak(text: string, opts: SpeakOptions): void {
  const synth = window.speechSynthesis
  if (!synth) {
    opts.onError?.('Síntese de voz indisponível neste sistema.')
    opts.onEnd?.()
    return
  }
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'pt-BR'
  u.rate = opts.rate ?? 1
  u.pitch = opts.pitch ?? 1
  u.volume = opts.volume ?? 1
  const voices = synth.getVoices()
  const chosen =
    (opts.voiceURI && voices.find((v) => v.voiceURI === opts.voiceURI)) ||
    ptVoices(voices)[0] ||
    voices[0] ||
    null
  if (chosen) u.voice = chosen
  u.onstart = () => opts.onStart?.()
  u.onend = () => opts.onEnd?.()
  u.onerror = (e) => {
    opts.onError?.(`Falha na fala (${(e as SpeechSynthesisErrorEvent).error}).`)
    opts.onEnd?.()
  }
  synth.speak(u)
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
  const wantsPiper =
    opts.engine === 'piper' ||
    (opts.engine !== 'web' && window.ares.system.platform === 'linux')
  if (wantsPiper) {
    const ok = await piperSpeak(clean, opts)
    if (ok || opts.engine === 'piper') {
      if (!ok) opts.onEnd?.()
      return
    }
  }
  webSpeak(clean, opts)
}

export function cancelSpeech(): void {
  window.speechSynthesis?.cancel()
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
}
