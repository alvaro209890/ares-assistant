import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { interpretBusySpeech, stripWakeWord } from '../src/renderer/lib/voiceControl'
import {
  HEARTBEAT_FIRST_MS,
  HEARTBEAT_PHRASES,
  HEARTBEAT_REPEAT_MS,
  gerundFragment,
  heartbeatPhrase,
  startHeartbeat
} from '../src/main/voiceCode'

describe('voz durante o trabalho — interpretBusySpeech', () => {
  it('cancela com verbo curto mesmo sem a palavra de ativação', () => {
    expect(interpretBusySpeech('para', 'ares', true)).toEqual({ kind: 'cancel' })
    expect(interpretBusySpeech('cancela isso', 'ares', true)).toEqual({ kind: 'cancel' })
    expect(interpretBusySpeech('pode parar', 'ares', true)).toEqual({ kind: 'cancel' })
    expect(interpretBusySpeech('Pare!', 'ares', false)).toEqual({ kind: 'cancel' })
  })

  it('cancela com a palavra de ativação ("Ares, pare com isso agora mesmo")', () => {
    expect(interpretBusySpeech('Ares, pare com isso agora mesmo', 'ares', true)).toEqual({ kind: 'cancel' })
    expect(interpretBusySpeech('aris cancela a execução', 'ares', true)).toEqual({ kind: 'cancel' })
  })

  it('fala longa que só CONTÉM "para" não cancela (preposição comum)', () => {
    const r = interpretBusySpeech('depois disso cria um teste para a função nova', 'ares', false)
    expect(r.kind).toBe('command')
  })

  it('enfileira comando novo dito durante a tarefa (com wake word quando exigida)', () => {
    expect(interpretBusySpeech('Ares, depois rode os testes', 'ares', true)).toEqual({
      kind: 'command',
      text: 'depois rode os testes'
    })
    // sem a palavra de ativação e com exigência ligada -> ignora (fala alheia)
    expect(interpretBusySpeech('depois rode os testes', 'ares', true)).toEqual({ kind: 'ignore' })
    // exigência desligada -> aceita direto
    expect(interpretBusySpeech('depois rode os testes', 'ares', false)).toEqual({
      kind: 'command',
      text: 'depois rode os testes'
    })
  })

  it('ignora ruído: vazio, só a palavra de ativação, ou uma palavra solta', () => {
    expect(interpretBusySpeech('', 'ares', false)).toEqual({ kind: 'ignore' })
    expect(interpretBusySpeech('Ares', 'ares', false)).toEqual({ kind: 'ignore' })
    expect(interpretBusySpeech('legal', 'ares', false)).toEqual({ kind: 'ignore' })
  })

  it('stripWakeWord segue exportado e tolerante a erros de transcrição', () => {
    expect(stripWakeWord('aris que horas são', 'ares')).toBe('que horas são')
    expect(stripWakeWord('bom dia', 'ares')).toBeNull()
  })
})

describe('voz durante o trabalho — heartbeat de tarefas longas', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fala atualização após ~15s e repete, sempre no canal só-de-fala', () => {
    const deltas: { chunk: string; phase: number; kind?: string }[] = []
    const stop = startHeartbeat((chunk, phase, kind) => deltas.push({ chunk, phase, kind }), 2)

    vi.advanceTimersByTime(HEARTBEAT_FIRST_MS - 1)
    expect(deltas).toHaveLength(0) // tarefas rápidas não geram fala extra

    vi.advanceTimersByTime(1)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toMatchObject({ chunk: HEARTBEAT_PHRASES[0], phase: 2, kind: 'speak' })

    vi.advanceTimersByTime(HEARTBEAT_REPEAT_MS)
    expect(deltas).toHaveLength(2)
    expect(deltas[1].chunk).toBe(HEARTBEAT_PHRASES[1]) // frase varia, não repete a mesma

    stop()
    vi.advanceTimersByTime(HEARTBEAT_REPEAT_MS * 3)
    expect(deltas).toHaveLength(2) // após o fim da tarefa, silêncio
  })

  it('sem onDelta (sem streaming) não agenda nada', () => {
    const stop = startHeartbeat(undefined, 1)
    vi.advanceTimersByTime(HEARTBEAT_FIRST_MS * 2)
    stop()
  })

  it('com rótulo da tarefa, o batimento relata O QUE ainda está rodando', () => {
    expect(heartbeatPhrase(0, 'Rodando testes...')).toBe(' Ainda rodando testes, senhor.')
    expect(heartbeatPhrase(1, 'Terminal: npm run build')).toBe(
      ' Sigo executando npm run build. Aviso assim que terminar.'
    )
    // Sem rótulo, mantém a rotação genérica clássica.
    expect(heartbeatPhrase(0)).toBe(HEARTBEAT_PHRASES[0])
  })

  it('gerundFragment converte rótulos de progresso em fragmento encaixável', () => {
    expect(gerundFragment('Checando tipos...')).toBe('checando tipos')
    expect(gerundFragment('Rodando: npm test')).toBe('executando npm test')
    expect(gerundFragment('Buscando na web: "clima amanhã"')).toBe('buscando na web')
    expect(gerundFragment('')).toBe('')
  })

  it('startHeartbeat com rótulo fala a tarefa real no canal só-de-fala', () => {
    const deltas: { chunk: string; kind?: string }[] = []
    const stop = startHeartbeat((chunk, _phase, kind) => deltas.push({ chunk, kind }), 2, 'Rodando testes...')
    vi.advanceTimersByTime(HEARTBEAT_FIRST_MS)
    expect(deltas).toHaveLength(1)
    expect(deltas[0].chunk).toContain('rodando testes')
    expect(deltas[0].kind).toBe('speak')
    stop()
  })
})
