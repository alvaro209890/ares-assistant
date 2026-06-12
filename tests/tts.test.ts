import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PIPER_ATTEMPT_TIMEOUT_MS,
  PIPER_FAILURE_COOLDOWN_MS,
  SENTENCE_PAUSE_FULL_MS,
  clearSpeechQueue,
  dropPendingSentences,
  enqueueSentence,
  normalizeSpeechText,
  speak,
  splitSentences,
  whenSpeechQueueIdle
} from '../src/renderer/lib/tts'
import { finalSpeechFallback } from '../src/renderer/lib/store'

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
    await vi.advanceTimersByTimeAsync(PIPER_ATTEMPT_TIMEOUT_MS)
    await vi.advanceTimersByTimeAsync(180)
    await vi.advanceTimersByTimeAsync(PIPER_ATTEMPT_TIMEOUT_MS)
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
    // 10ms de fala + respiro entre frases + 10ms da segunda
    await vi.advanceTimersByTimeAsync(SENTENCE_PAUSE_FULL_MS + 60)
    await idle

    expect(speakCalls).toEqual(['primeira frase.', 'segunda frase.'])
  })

  it('dropPendingSentences descarta as pendentes mas deixa a frase atual terminar', async () => {
    const { speakCalls, cancel } = installSpeechMock()
    enqueueSentence('primeira frase.', { engine: 'web' })
    enqueueSentence('segunda frase.', { engine: 'web' })
    enqueueSentence('terceira frase.', { engine: 'web' })

    // A primeira já está tocando; a troca de fase descarta só o que ainda não falou.
    dropPendingSentences()
    cancel.mockClear()
    await vi.advanceTimersByTimeAsync(SENTENCE_PAUSE_FULL_MS + 60)
    await whenSpeechQueueIdle()

    expect(speakCalls).toEqual(['primeira frase.'])
    expect(cancel).not.toHaveBeenCalled() // nada de corte seco no meio da palavra
  })

  it('após falha transitória do Piper, a próxima frase ESPERA o cooldown e fala (não emudece)', async () => {
    installSpeechMock()
    const { playCalls } = installAudioMock()
    const onError = vi.fn()
    let calls = 0
    window.ares.tts.synthesize = vi.fn(() => {
      calls++
      // 1ª chamada = prefetch da frase 2; 2ª e 3ª = tentativas da frase 1. Todas falham
      // (CPU ocupada). Da 4ª em diante (retentativa da frase 2 pós-cooldown), funciona.
      return calls <= 3 ? Promise.reject(new Error('cpu ocupada')) : Promise.resolve(new ArrayBuffer(44100))
    })

    enqueueSentence('primeira frase de status.', { engine: 'piper', onError })
    enqueueSentence('segunda frase de status.', { engine: 'piper', onError })
    const idle = whenSpeechQueueIdle()
    await vi.advanceTimersByTimeAsync(400) // tentativas da frase 1 (retry com delay)
    await vi.advanceTimersByTimeAsync(PIPER_FAILURE_COOLDOWN_MS + SENTENCE_PAUSE_FULL_MS + 100)
    await idle

    expect(onError).toHaveBeenCalledTimes(1) // só a primeira frase falhou
    expect(playCalls.length).toBe(1) // a segunda tocou após a espera — não foi pulada
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
    const split = splitSentences('arquivos de layout do ArcGIS (PQC_Area_da_queima.mxd, Distancia_T_I.mxd, etc.), usados para montar mapas finais.', true)
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
    expect(splitSentences('Claro, senhor.', true, { eager: true }).sentences).toEqual(['Claro, senhor.'])
    expect(splitSentences('Oi, tudo bem', false, { eager: true }).sentences).toEqual([])
  })

  it('fast-path: frase de status de código toca imediatamente sem esperar o próximo delta', () => {
    installSpeechMock()
    // Anúncio de progresso chega INTEIRO num único delta e termina o buffer com
    // pontuação — sem o fast-path, ficava preso até o flush final.
    const split = splitSentences(' Executando os testes, senhor.', false)
    expect(split.sentences).toEqual(['Executando os testes, senhor.'])
    expect(split.rest).toBe('')

    const edit = splitSentences(' Aplicando a correção em code.ts.', false)
    expect(edit.sentences).toEqual(['Aplicando a correção em code.ts.'])
  })

  it('fast-path de status não dispara para texto comum sem verbo de status', () => {
    installSpeechMock()
    // Texto narrativo terminando com ponto no fim do buffer continua esperando
    // confirmação do próximo delta (evita cortar "3." de "3.14" etc.).
    expect(splitSentences('O total foi de 3.', false).sentences).toEqual([])
    expect(splitSentences('Certo, vou olhar isso agora.', false).sentences).toEqual([])
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

  it('nao quebra numeros com ponto (milhar) no meio da transmissao (streaming)', () => {
    installSpeechMock()
    // Caso 1: o buffer termina exatamente no ponto (ex: "está com 2.")
    const split1 = splitSentences('está com 2.', false)
    expect(split1.sentences).toEqual([])
    expect(split1.rest).toBe('está com 2.')

    // Caso 2: o buffer recebe o restante do número (ex: "está com 2.000 itens")
    const split2 = splitSentences('está com 2.000 itens', false)
    expect(split2.sentences).toEqual([])
    expect(split2.rest).toBe('está com 2.000 itens')

    // Caso 3: fim do fluxo (final = true) com o número com ponto
    const split3 = splitSentences('está com 2.000 itens.', true)
    expect(split3.sentences).toEqual(['está com 2.000 itens.'])
    expect(split3.rest).toBe('')
  })
})

describe('finalSpeechFallback (anti-repetição)', () => {
  it('fala texto completo quando nada foi enfileirado pelo streaming', () => {
    const result = { fala: 'Pronto, tudo certo.', falaVoz: '' }
    expect(finalSpeechFallback(result, false, false)).toBe('Pronto, tudo certo.')
  })

  it('prefere falaVoz quando nada foi enfileirado e falaVoz existe', () => {
    const result = { fala: 'Resposta longa com detalhes.', falaVoz: 'Pronto, senhor.' }
    expect(finalSpeechFallback(result, false, false)).toBe('Pronto, senhor.')
  })

  it('NÃO refala texto completo quando streaming já falou frases', () => {
    const result = { fala: 'Resposta longa repetida.', falaVoz: '' }
    // queuedSpeech=true, finalPhaseQueuedSpeech=true: já falou na última fase
    expect(finalSpeechFallback(result, true, true)).toBe('')
  })

  it('usa falaVoz quando última fase não teve fala mas fases anteriores sim', () => {
    const result = { fala: 'Texto completo.', falaVoz: 'Resumo de voz.' }
    // queuedSpeech=true (fases anteriores falaram), finalPhaseQueuedSpeech=false
    expect(finalSpeechFallback(result, true, false)).toBe('Resumo de voz.')
  })

  it('não fala nada se streaming já cobriu tudo e não há falaVoz', () => {
    const result = { fala: 'Texto completo.', falaVoz: '' }
    // queuedSpeech=true (fases anteriores falaram), finalPhaseQueuedSpeech=false, sem falaVoz
    expect(finalSpeechFallback(result, true, false)).toBe('')
  })
})

describe('Cancelamento de áudio residual na mudança de fase', () => {
  it('garante que clearSpeechQueue cancela a reprodução e limpa a fila', () => {
    const { cancel } = installSpeechMock()
    clearSpeechQueue()
    expect(cancel).toHaveBeenCalled()
  })
})

