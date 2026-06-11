import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSpeechQueue, enqueueSentence, normalizeSpeechText, speak, splitSentences, whenSpeechQueueIdle } from '../src/renderer/lib/tts'

class MockUtterance {
  text: string
  lang = ''
  rate = 1
  pitch = 1
  volume = 1
  voice: SpeechSynthesisVoice | null = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

function installSpeechMock(opts: { autoStart?: boolean; autoEnd?: boolean } = {}): { speakCalls: string[]; cancel: ReturnType<typeof vi.fn> } {
  const speakCalls: string[] = []
  const cancel = vi.fn()
  const synth = {
    getVoices: vi.fn(() => [{ lang: 'pt-BR', name: 'Antonio Neural', voiceURI: 'pt' }]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    cancel,
    resume: vi.fn(),
    speak: vi.fn((u: MockUtterance) => {
      speakCalls.push(u.text)
      if (opts.autoStart !== false) {
        u.onstart?.()
        if (opts.autoEnd !== false) setTimeout(() => u.onend?.(), 10)
      }
    })
  }
  vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)
  vi.stubGlobal('window', {
    speechSynthesis: synth,
    ares: {
      system: { platform: 'win32' },
      tts: {
        status: vi.fn(async () => ({ ready: true, voices: ['pt_BR-faber-medium'], platform: 'win32' })),
        synthesize: vi.fn(() => new Promise<ArrayBuffer>(() => {}))
      }
    }
  })
  return { speakCalls, cancel }
}

function installAudioMock(): { playCalls: string[] } {
  const playCalls: string[] = []
  class MockAudio {
    src = ''
    volume = 1
    onended: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(src: string) {
      this.src = src
    }
    play(): Promise<void> {
      playCalls.push(this.src)
      setTimeout(() => this.onended?.(), 10)
      return Promise.resolve()
    }
    pause(): void {}
  }
  vi.stubGlobal('Audio', MockAudio)
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock-wav'),
    revokeObjectURL: vi.fn()
  })
  return { playCalls }
}

describe('tts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    clearSpeechQueue()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('mantem Piper como voz atual e nao cai para Web Speech quando ha timeout', async () => {
    const { speakCalls } = installSpeechMock()
    const onError = vi.fn()
    const onEnd = vi.fn()

    const done = speak('teste curto', { engine: 'piper', onError, onEnd })
    await vi.advanceTimersByTimeAsync(3500)
    await vi.advanceTimersByTimeAsync(180)
    await vi.advanceTimersByTimeAsync(3500)
    await vi.advanceTimersByTimeAsync(20)
    await done

    expect(window.ares.tts.synthesize).toHaveBeenCalledTimes(2)
    expect(speakCalls).toEqual([])
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Piper'))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('em auto no Windows usa o Piper primeiro (voz neural)', async () => {
    const { speakCalls } = installSpeechMock()
    const { playCalls } = installAudioMock()
    window.ares.tts.synthesize = vi.fn(async () => new ArrayBuffer(44100))

    const done = speak('fala neural', { engine: 'auto' })
    await vi.advanceTimersByTimeAsync(20)
    await done

    expect(window.ares.tts.synthesize).toHaveBeenCalledTimes(1)
    expect(playCalls).toEqual(['blob:mock-wav'])
    expect(speakCalls).toEqual([]) // Web Speech não foi necessário
  })

  it('fala a fila em ordem sem sobrepor frases no fallback web', async () => {
    const { speakCalls } = installSpeechMock()
    enqueueSentence('primeira frase.', { engine: 'web' })
    enqueueSentence('segunda frase.', { engine: 'web' })
    const idle = whenSpeechQueueIdle()
    await vi.advanceTimersByTimeAsync(30)
    await idle

    expect(speakCalls).toEqual(['primeira frase.', 'segunda frase.'])
  })

  it('nao deixa a fila presa quando Web Speech nao inicia', async () => {
    const { speakCalls, cancel } = installSpeechMock({ autoStart: false })
    const onError = vi.fn()
    const onEnd = vi.fn()

    const done = speak('teste sem inicio de audio', { engine: 'web', onError, onEnd })
    await vi.advanceTimersByTimeAsync(2600)
    await vi.advanceTimersByTimeAsync(140)
    await vi.advanceTimersByTimeAsync(2600)
    await done

    expect(speakCalls).toEqual(['teste sem inicio de audio', 'teste sem inicio de audio'])
    expect(cancel).toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Web Speech'))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('em modo auto mantem a voz neural e nao rebaixa para Web Speech quando Piper falha', async () => {
    const { speakCalls } = installSpeechMock()
    installAudioMock()
    const onError = vi.fn()
    const onEnd = vi.fn()
    window.ares.tts.synthesize = vi.fn(() => Promise.reject(new Error('piper indisponível')))

    const done = speak('fallback web', { engine: 'auto', onError, onEnd })
    await vi.advanceTimersByTimeAsync(500) // esgota as tentativas do Piper (com retry)
    await done

    expect(window.ares.tts.synthesize).toHaveBeenCalledTimes(2) // PIPER_MAX_RETRIES
    expect(speakCalls).toEqual([])
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Piper'))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('nao quebra fala em dois-pontos ou ponto-e-virgula', () => {
    installSpeechMock()
    const split = splitSentences('Sistemas online: pronto; aguardando comando. Tudo certo', false)

    expect(split.sentences).toEqual(['Sistemas online: pronto; aguardando comando.'])
    expect(split.rest).toBe(' Tudo certo')
  })

  it('nao quebra fala em extensoes de arquivo e pontos internos a palavras', () => {
    installSpeechMock()
    const split = splitSentences('arquivos de layout do ArcGIS (PQC_Area_da_queima.mxd, Distancia_T_I.mxd, etc.), usados para montar mapas finais.', false)
    expect(split.sentences).toEqual([
      'arquivos de layout do ArcGIS (PQC_Area_da_queima.mxd, Distancia_T_I.mxd, etc.), usados para montar mapas finais.'
    ])
    expect(split.rest).toBe('')
  })

  it('nao deixa a fila presa quando ocorre excecao inesperada na fala', async () => {
    installSpeechMock()
    const onError = vi.fn()
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor() {
          throw new Error('utterance quebrado')
        }
      }
    )

    enqueueSentence('primeira frase.', { engine: 'web', onError })
    enqueueSentence('segunda frase.', { engine: 'web', onError })
    await whenSpeechQueueIdle()

    expect(onError).toHaveBeenCalled()
  })

  it('limpa markdown/ruído mas PRESERVA vírgulas e números para a prosódia', () => {
    installSpeechMock()

    // vírgulas, dois-pontos e ponto-e-vírgula são preservados (a fala ganha pausas naturais);
    // números crus passam intactos para a normalização no processo principal.
    expect(normalizeSpeechText('Ares: pronto, senhor; sistemas online...')).toBe(
      'Ares: pronto, senhor; sistemas online.'
    )
    expect(normalizeSpeechText('total R$ 1.250,90')).toBe('total R$ 1.250,90')
    expect(normalizeSpeechText('**Documentos**\n1. `Ares`\n- [relatório](https://exemplo.com)')).toBe(
      'Documentos Ares relatório'
    )
  })

  it('modo eager: corta a primeira oração na vírgula para a voz começar antes', () => {
    installSpeechMock()
    const buf =
      'Entendido, vou analisar o diretório do projeto agora mesmo, e em seguida trago um resumo completo e detalhado do que eu encontrar por lá durante a análise do código'

    const eager = splitSentences(buf, false, { eager: true })
    expect(eager.sentences.length).toBe(1)
    expect(eager.sentences[0].endsWith(',')).toBe(true) // cortou numa vírgula
    expect((eager.sentences[0] + eager.rest).replace(/\s+/g, ' ')).toContain('resumo completo')

    // sem eager (já há fala na fila), espera pontuação final — comportamento antigo
    const normal = splitSentences(buf, false)
    expect(normal.sentences).toEqual([])
  })

  it('eager não age em texto curto nem quando já existe frase completa', () => {
    installSpeechMock()
    expect(splitSentences('Claro, senhor.', false, { eager: true }).sentences).toEqual(['Claro, senhor.'])
    expect(splitSentences('Oi, tudo bem', false, { eager: true }).sentences).toEqual([])
  })

  it('quebra texto longo sem pontuacao para nao atrasar a voz', () => {
    installSpeechMock()
    const long = Array.from({ length: 70 }, (_, i) => `palavra${i}`).join(' ')
    const split = splitSentences(long, false)

    expect(split.sentences.length).toBeGreaterThan(0)
    expect(split.sentences[0].length).toBeLessThanOrEqual(220)
    expect(split.rest.length).toBeGreaterThan(0)
  })

  it('ignora frases e normaliza como vazio textos compostos apenas por pontuação', () => {
    installSpeechMock()
    expect(normalizeSpeechText('.')).toBe('')
    expect(normalizeSpeechText('?.')).toBe('')
    expect(normalizeSpeechText('...')).toBe('')
    expect(normalizeSpeechText('   ,,,  ')).toBe('')

    // splitSentences também deve descartar strings que consistem puramente de pontuação
    const split = splitSentences('Quer que eu analise algum desses projetos com mais profundidade?.', true)
    expect(split.sentences).toEqual(['Quer que eu analise algum desses projetos com mais profundidade?.'])
    expect(split.rest).toBe('')
  })
})
