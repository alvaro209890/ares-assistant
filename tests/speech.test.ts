import { describe, expect, it } from 'vitest'
import {
  PIPER_SENTENCE_SILENCE,
  computeLengthScale,
  detectTone,
  expandTechAcronyms,
  prepareText
} from '../src/main/speech'

describe('fala neural (speech)', () => {
  it('pronuncia siglas técnicas corretamente', () => {
    expect(expandTechAcronyms('a API e o JSON')).toBe('a á pê í e o jêison')
    expect(expandTechAcronyms('um arquivo TS e outro JS')).toBe('um arquivo tê ésse e outro jota ésse')
    expect(expandTechAcronyms('use HTTPS e SQL')).toContain('agá tê tê pê ésse')
  })

  it('não mexe em palavras comuns nem em minúsculas (ex.: extensões .ts/.js)', () => {
    expect(expandTechAcronyms('as coisas')).toBe('as coisas')
    expect(expandTechAcronyms('o arquivo main.ts foi salvo')).toBe('o arquivo main.ts foi salvo')
    expect(expandTechAcronyms('os dados')).toBe('os dados')
  })

  it('detecta o tom a partir do conteúdo (erro tem precedência)', () => {
    expect(detectTone('Pronto, senhor, tudo certo.')).toBe('sucesso')
    expect(detectTone('Desculpe, ocorreu um erro ao aplicar o patch.')).toBe('erro')
    expect(detectTone('A previsão é de sol amanhã.')).toBe('neutro')
    // pista de erro vence pista de sucesso na mesma frase
    expect(detectTone('Criei o arquivo, mas o build falhou.')).toBe('erro')
  })

  it('varia a velocidade pelo tom: erro mais rápido, sucesso mais calmo', () => {
    const neutro = computeLengthScale(1, 'neutro')
    const erro = computeLengthScale(1, 'erro')
    const sucesso = computeLengthScale(1, 'sucesso')
    expect(erro).toBeLessThan(neutro) // length_scale menor = fala mais rápida
    expect(sucesso).toBeGreaterThan(neutro) // maior = mais calma
  })

  it('mantém o length_scale dentro de limites seguros', () => {
    expect(computeLengthScale(5, 'erro')).toBeGreaterThanOrEqual(0.45)
    expect(computeLengthScale(0.01, 'sucesso')).toBeLessThanOrEqual(2.2)
    expect(computeLengthScale(undefined)).toBeCloseTo(1 / 1.08, 2)
  })

  it('prepareText pronuncia siglas e remove pausas internas', () => {
    const out = prepareText('Senhor, atualizei a API; rode o teste, por favor.')
    expect(out).toContain('á pê í')
    expect(out).not.toContain(';')
    expect(out).not.toContain(', por favor') // vírgula interna some
    expect(out.startsWith('Senhor.')).toBe(true)
  })

  it('usa silêncio entre frases curto para fluidez', () => {
    expect(PIPER_SENTENCE_SILENCE).toBe('0.025')
  })
})
