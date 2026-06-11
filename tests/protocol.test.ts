import { describe, expect, it } from 'vitest'
import { parseEnvelope } from '../src/shared/protocol'

describe('protocol - parseEnvelope', () => {
  it('should parse valid JSON envelopes', () => {
    const raw = '{"fala": "Olá mundo", "acoes": [{"tipo": "codigo.criar", "arquivo": "test.txt", "conteudo": "oi"}]}'
    const result = parseEnvelope(raw)
    expect(result.fala).toBe('Olá mundo')
    expect(result.acoes).toHaveLength(1)
    expect(result.acoes[0].tipo).toBe('codigo.criar')
  })

  it('should parse JSON envelopes wrapped in markdown code blocks', () => {
    const raw = '```json\n{"fala": "Markdown block", "acoes": []}\n```'
    const result = parseEnvelope(raw)
    expect(result.fala).toBe('Markdown block')
    expect(result.acoes).toHaveLength(0)
  })

  it('should fix invalid escape sequences in JSON string values and parse successfully', () => {
    // A backslash followed by a space (invalid escape sequence)
    const raw = '{"fala": "Abaixo o CSS:\\n display: flex;\\      justify-content: center;\\n", "acoes": [{"tipo": "codigo.criar", "arquivo": "index.html", "conteudo": "body {\\n  display: flex;\\      justify-content: center;\\n}"}]}'
    
    // In raw JSON string: `display: flex;\      justify-content: center;`
    // This would throw with normal JSON.parse.
    const result = parseEnvelope(raw)
    expect(result.fala).toContain('display: flex;')
    expect(result.acoes).toHaveLength(1)
    expect(result.acoes[0].tipo).toBe('codigo.criar')
    expect((result.acoes[0] as any).conteudo).toContain('display: flex;')
  })

  it('should fall back to treating everything as fala if parsing completely fails', () => {
    const raw = 'Texto comum sem formato JSON'
    const result = parseEnvelope(raw)
    expect(result.fala).toBe('Texto comum sem formato JSON')
    expect(result.acoes).toHaveLength(0)
  })
})
