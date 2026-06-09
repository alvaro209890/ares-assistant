import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearLogRing, errToMessage, formatEntry, getRecentLogs, logger, setFileLogging } from '../src/main/logger'

describe('logger', () => {
  beforeEach(() => {
    setFileLogging(false) // não tocar o disco nos testes
    clearLogRing()
  })
  afterEach(() => {
    clearLogRing()
    setFileLogging(true)
  })

  it('formata a entrada com timestamp ISO, nível e escopo', () => {
    const line = formatEntry({ ts: Date.UTC(2026, 5, 9, 12, 0, 0), level: 'warn', scope: 'piper', message: 'falhou' })
    expect(line).toBe('2026-06-09T12:00:00.000Z [WARN] piper: falhou')
  })

  it('extrai mensagem de qualquer tipo de erro', () => {
    expect(errToMessage(new Error('boom'))).toBe('boom')
    expect(errToMessage('texto')).toBe('texto')
    expect(errToMessage({ code: 1 })).toBe('{"code":1}')
    expect(errToMessage(null)).toBe('')
  })

  it('mantém um anel e devolve as últimas N linhas', () => {
    logger.info('a', 'um')
    logger.warn('b', 'dois')
    logger.error('c', 'três')
    const last2 = getRecentLogs(2)
    expect(last2).toHaveLength(2)
    expect(last2[0]).toContain('[WARN] b: dois')
    expect(last2[1]).toContain('[ERROR] c: três')
  })

  it('anexa a causa do erro à mensagem', () => {
    logger.warn('tts', 'síntese falhou', new Error('timeout'))
    const [line] = getRecentLogs(1)
    expect(line).toContain('tts: síntese falhou — timeout')
  })
})
