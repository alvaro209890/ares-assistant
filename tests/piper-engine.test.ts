import { describe, expect, it } from 'vitest'
import {
  buildJsonRequest,
  buildPiperArgs,
  matchesOutput,
  poolKey,
  shutdownPiperPool,
  warmPoolSize,
  type PiperSynthParams
} from '../src/main/piperEngine'

function params(over: Partial<PiperSynthParams> = {}): PiperSynthParams {
  return {
    bin: '/opt/piper/piper',
    model: '/voices/pt_BR-faber-medium.onnx',
    lengthScale: '0.926',
    noiseScale: '0.667',
    noiseW: '0.800',
    sentenceSilence: '0.15',
    env: {},
    cwd: '/opt/piper',
    ...over
  }
}

describe('piperEngine (funções puras)', () => {
  it('monta os argumentos da CLI no modo quente (json-input + flags globais)', () => {
    expect(buildPiperArgs(params())).toEqual([
      '--model', '/voices/pt_BR-faber-medium.onnx',
      '--length_scale', '0.926',
      '--noise_scale', '0.667',
      '--noise_w', '0.800',
      '--sentence_silence', '0.15',
      '--json-input'
    ])
  })

  it('chave do pool agrupa por modelo + parâmetros globais de prosódia', () => {
    expect(poolKey(params())).toBe('/voices/pt_BR-faber-medium.onnx@0.926@0.667@0.800@0.15')
    // length_scale diferente (tom diferente) => processo quente separado
    expect(poolKey(params({ lengthScale: '0.852' }))).not.toBe(poolKey(params()))
    // mesmos parâmetros => mesma chave (reaproveita o processo)
    expect(poolKey(params())).toBe(poolKey(params()))
  })

  it('requisição JSON é uma linha terminada em newline e parseável', () => {
    const line = buildJsonRequest('olá, senhor', '/tmp/a.wav')
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line.trim())).toEqual({ text: 'olá, senhor', output_file: '/tmp/a.wav' })
  })

  it('casa a linha de saída do Piper por caminho ou basename (robusto a SO)', () => {
    expect(matchesOutput('/tmp/a.wav', '/tmp/a.wav')).toBe(true)
    expect(matchesOutput('  /tmp/a.wav  ', '/tmp/a.wav')).toBe(true) // trim
    expect(matchesOutput('a.wav', '/tmp/a.wav')).toBe(true) // basename
    expect(matchesOutput('C:\\Temp\\a.wav', '/tmp/a.wav')).toBe(true) // Windows
    expect(matchesOutput('outro.wav', '/tmp/a.wav')).toBe(false)
    expect(matchesOutput('', '/tmp/a.wav')).toBe(false)
    expect(matchesOutput('linha de log qualquer', '/tmp/a.wav')).toBe(false)
  })

  it('pool inicia vazio e o shutdown é idempotente', () => {
    expect(warmPoolSize()).toBe(0)
    expect(() => shutdownPiperPool()).not.toThrow()
    expect(() => shutdownPiperPool()).not.toThrow()
    expect(warmPoolSize()).toBe(0)
  })
})
