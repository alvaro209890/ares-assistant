import { describe, expect, it } from 'vitest'
import { spawnAsync } from '../src/main/exec'

const NODE = process.execPath // caminho do node atual, multiplataforma

describe('spawnAsync — execução não-bloqueante', () => {
  it('captura stdout e código de saída 0', async () => {
    const r = await spawnAsync(NODE, ['-e', 'process.stdout.write("ola")'], { timeoutMs: 5000 })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('ola')
    expect(r.timedOut).toBe(false)
    expect(r.aborted).toBe(false)
  })

  it('propaga código de saída diferente de zero e stderr', async () => {
    const r = await spawnAsync(NODE, ['-e', 'process.stderr.write("boom"); process.exit(3)'], { timeoutMs: 5000 })
    expect(r.code).toBe(3)
    expect(r.stderr).toContain('boom')
  })

  it('mata o processo no timeout', async () => {
    const r = await spawnAsync(NODE, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 100 })
    expect(r.timedOut).toBe(true)
  })

  it('aborta via AbortSignal sem travar', async () => {
    const ctrl = new AbortController()
    const p = spawnAsync(NODE, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 5000, signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 60)
    const r = await p
    expect(r.aborted).toBe(true)
  })

  it('transmite a saída em tempo real via onChunk', async () => {
    const chunks: string[] = []
    const r = await spawnAsync(NODE, ['-e', 'process.stdout.write("stream")'], {
      timeoutMs: 5000,
      onChunk: (_s, c) => chunks.push(c)
    })
    expect(chunks.join('')).toContain('stream')
    expect(r.stdout).toContain('stream')
  })

  it('não rejeita quando o binário não existe (erro de spawn)', async () => {
    const r = await spawnAsync('binario-que-nao-existe-xyz-123', [], { timeoutMs: 2000 })
    expect(r.code).toBeNull()
    expect(r.stderr.length).toBeGreaterThan(0)
  })
})
