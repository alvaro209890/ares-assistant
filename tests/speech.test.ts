import { describe, expect, it } from 'vitest'
import {
  PIPER_SENTENCE_SILENCE,
  computeLengthScale,
  computeNoise,
  detectTone,
  expandTechAcronyms,
  intToPtBR,
  normalizePtNumbers,
  normalizeSymbols,
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

  it('prepareText pronuncia siglas e PRESERVA as vírgulas como pausa natural', () => {
    const out = prepareText('Senhor, atualizei a API; rode o teste, por favor.')
    expect(out).toContain('á pê í')
    expect(out).not.toContain(';') // ponto-e-vírgula vira vírgula
    expect(out).toContain(', por favor') // vírgula interna preservada (pausa natural)
    expect(out.startsWith('Senhor.')).toBe(true)
  })

  it('usa um silêncio entre frases natural (uma respiração curta)', () => {
    expect(PIPER_SENTENCE_SILENCE).toBe('0.15')
  })
})

describe('normalização de números pt-BR', () => {
  it('inteiros por extenso', () => {
    expect(intToPtBR(0)).toBe('zero')
    expect(intToPtBR(15)).toBe('quinze')
    expect(intToPtBR(100)).toBe('cem')
    expect(intToPtBR(101)).toBe('cento e um')
    expect(intToPtBR(123)).toBe('cento e vinte e três')
    expect(intToPtBR(1000)).toBe('mil')
    expect(intToPtBR(1500)).toBe('mil e quinhentos')
    expect(intToPtBR(1520)).toBe('mil quinhentos e vinte')
    expect(intToPtBR(1250)).toBe('mil duzentos e cinquenta')
    expect(intToPtBR(2026)).toBe('dois mil e vinte e seis')
    expect(intToPtBR(1000000)).toBeNull() // grande demais: mantém dígitos
  })

  it('moeda, porcentagem, hora, versão e ordinais', () => {
    expect(normalizePtNumbers('custou R$ 1.250,90 no total')).toBe(
      'custou mil duzentos e cinquenta reais e noventa centavos no total'
    )
    expect(normalizePtNumbers('R$ 1,00')).toBe('um real')
    expect(normalizePtNumbers('R$ 5,50')).toBe('cinco reais e cinquenta centavos')
    expect(normalizePtNumbers('50% concluído')).toBe('cinquenta por cento concluído')
    expect(normalizePtNumbers('às 14:30')).toBe('às quatorze e trinta')
    expect(normalizePtNumbers('reunião às 9:00')).toBe('reunião às nove horas')
    expect(normalizePtNumbers('versão 0.24.0 pronta')).toBe('versão zero ponto vinte e quatro ponto zero pronta')
    expect(normalizePtNumbers('atualizei para v0.24')).toBe('atualizei para versão zero ponto vinte e quatro')
    expect(normalizePtNumbers('em 1º lugar')).toBe('em primeiro lugar')
    expect(normalizePtNumbers('a 2ª etapa')).toBe('a segunda etapa')
  })

  it('decimal e inteiro simples; números enormes mantêm os dígitos', () => {
    expect(normalizePtNumbers('tem 3 itens')).toBe('tem três itens')
    expect(normalizePtNumbers('o ano de 2026')).toBe('o ano de dois mil e vinte e seis')
    expect(normalizePtNumbers('precisão de 3,5')).toBe('precisão de três vírgula cinco')
    // milhar (3-3-3) NÃO é versão; e ≥ 1 milhão mantém os dígitos
    expect(normalizePtNumbers('1.000 reais')).toBe('mil reais')
    expect(normalizePtNumbers('id 1234567')).toContain('1234567')
  })

  it('símbolos isolados por extenso (conservador)', () => {
    expect(normalizeSymbols('pão & queijo')).toBe('pão e queijo')
    expect(normalizeSymbols('2 + 2')).toBe('2 mais 2')
    expect(normalizeSymbols('faz 25 °C hoje')).toBe('faz 25 graus hoje')
  })

  it('prepareText fala valores monetários corretamente', () => {
    const out = prepareText('O total foi R$ 1.250,90, senhor.')
    expect(out).toContain('mil duzentos e cinquenta reais e noventa centavos')
    expect(out).not.toMatch(/\d/) // sem dígitos crus na fala
  })
})

describe('expressividade (noise)', () => {
  it('varia por tom dentro de faixas seguras', () => {
    const neutro = computeNoise('neutro')
    const erro = computeNoise('erro')
    const sucesso = computeNoise('sucesso')
    expect(neutro).toEqual({ noiseScale: 0.667, noiseW: 0.8 })
    expect(erro.noiseW).toBeLessThan(neutro.noiseW) // erro: mais seco/nítido
    expect(sucesso.noiseW).toBeGreaterThan(neutro.noiseW) // sucesso: mais caloroso
    for (const n of [neutro, erro, sucesso]) {
      expect(n.noiseScale).toBeGreaterThanOrEqual(0.55)
      expect(n.noiseScale).toBeLessThanOrEqual(0.72)
      expect(n.noiseW).toBeGreaterThanOrEqual(0.7)
      expect(n.noiseW).toBeLessThanOrEqual(0.9)
    }
  })
})
