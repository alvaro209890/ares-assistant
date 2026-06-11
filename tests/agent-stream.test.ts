import { describe, expect, it } from 'vitest'
import { classifyProviderError } from '../src/main/agent/stream'

describe('classifyProviderError', () => {
  it('abort do usuário', () => {
    const err = new Error('The operation was aborted')
    ;(err as Error & { name: string }).name = 'AbortError'
    expect(classifyProviderError(err).kind).toBe('abort')
    expect(classifyProviderError(err).retryable).toBe(false)
  })

  it('timeout do provedor (streaming parou)', () => {
    const r = classifyProviderError(new Error('O provedor parou de responder por 60s durante o streaming.'))
    expect(r.kind).toBe('timeout')
    expect(r.retryable).toBe(true)
  })

  it('5xx é transitório (retryable)', () => {
    const r = classifyProviderError(new Error('O provedor respondeu 503. service unavailable'))
    expect(r.kind).toBe('transient')
    expect(r.status).toBe(503)
    expect(r.retryable).toBe(true)
  })

  it('429 vira "rate"', () => {
    const r = classifyProviderError(new Error('O provedor respondeu 429. too many requests'))
    expect(r.kind).toBe('rate')
    expect(r.retryable).toBe(true)
  })

  it('401/403 vira "auth", não retryable', () => {
    const r = classifyProviderError(new Error('O provedor respondeu 401. unauthorized'))
    expect(r.kind).toBe('auth')
    expect(r.retryable).toBe(false)
  })

  it('400/404/422 vira "bad_request"', () => {
    const r = classifyProviderError(new Error('O provedor respondeu 400. invalid request'))
    expect(r.kind).toBe('bad_request')
    expect(r.retryable).toBe(false)
  })

  it('falha de rede sem status vira "transient"', () => {
    expect(classifyProviderError(new Error('fetch failed ENOTFOUND')).kind).toBe('transient')
    expect(classifyProviderError(new Error('Não consegui falar com o cérebro em ...')).kind).toBe('transient')
  })

  it('parse error', () => {
    expect(classifyProviderError(new Error('Unexpected token x in JSON at position 0')).kind).toBe('parse')
  })

  it('desconhecido', () => {
    expect(classifyProviderError(new Error('algo bizarro')).kind).toBe('unknown')
  })
})
