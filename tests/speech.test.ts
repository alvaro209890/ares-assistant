import { describe, expect, it } from 'vitest'
import {
  PIPER_SENTENCE_SILENCE,
  cleanSpeechMarkup,
  computeLengthScale,
  computeNoise,
  detectTone,
  expandForeignWords,
  expandTechAcronyms,
  intToPtBR,
  normalizeModelNames,
  normalizePtNumbers,
  normalizeSymbols,
  prepareText,
  simplifyUrls,
  tightenWavSilence
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

  it('detecta perguntas (entonação curiosa), mas erro ainda vence', () => {
    expect(detectTone('Confirma que eu aplico o patch?')).toBe('pergunta')
    expect(detectTone('Quer que eu rode os testes agora?')).toBe('pergunta')
    expect(detectTone('O build falhou. Quer que eu tente de novo?')).toBe('erro')
    const neutro = computeNoise('neutro')
    const pergunta = computeNoise('pergunta')
    expect(pergunta.noiseW).toBeGreaterThan(neutro.noiseW) // mais melódica
    expect(computeLengthScale(1, 'pergunta')).toBeGreaterThan(computeLengthScale(1, 'neutro'))
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
    expect(computeLengthScale(undefined)).toBeCloseTo(1 / (1 + (0.98 - 1) * 0.65), 2)
  })

  it('prepareText pronuncia siglas e PRESERVA as vírgulas como pausa natural', () => {
    const out = prepareText('Senhor, atualizei a API; rode o teste, por favor.')
    expect(out).toContain('á pê í')
    expect(out).not.toContain(';') // ponto-e-vírgula vira vírgula
    expect(out).toContain(', por favor') // vírgula interna preservada (pausa natural)
    expect(out.startsWith('Senhor.')).toBe(true)
  })

  it('usa um silêncio entre frases natural (uma respiração curta)', () => {
    expect(PIPER_SENTENCE_SILENCE).toBe('0.05')
  })

  it('limpa markdown e listas antes de preparar a fala', () => {
    const raw = '**Documentos**:\n1. `Ares` pronto\n- [Relatório](https://exemplo.com)'
    expect(cleanSpeechMarkup(raw)).not.toMatch(/[*`\[\]()]/)
    expect(prepareText(raw)).toContain('Documentos')
    expect(prepareText(raw)).not.toMatch(/asterisco|colchete/i)
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

  it('datas por extenso (ISO e brasileira)', () => {
    expect(normalizePtNumbers('o prazo é 2026-06-10')).toBe('o prazo é dez de junho de dois mil e vinte e seis')
    expect(normalizePtNumbers('entrega em 10/06/2026')).toBe('entrega em dez de junho de dois mil e vinte e seis')
    expect(normalizePtNumbers('dia 01/03/2026')).toBe('dia primeiro de março de dois mil e vinte e seis')
    // mês/dia inválidos não viram data falada (os números seguem o caminho comum)
    expect(normalizePtNumbers('2026-13-40 inválida')).not.toMatch(/junho|janeiro|março/)
  })

  it('unidades de dados e tempo após número', () => {
    expect(normalizePtNumbers('são 16 GB de RAM')).toContain('gigabytes')
    expect(normalizePtNumbers('baixou 512MB')).toContain('megabytes')
    expect(normalizePtNumbers('respondeu em 120 ms')).toContain('milissegundos')
    expect(normalizePtNumbers('tem 1 GB livre')).toContain('um gigabyte')
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

describe('aparar silêncio do WAV (fluidez entre frases)', () => {
  const RATE = 22050
  /** WAV PCM16 mono sintético: [silêncio | tom | silêncio], durações em ms. */
  function makeWav(leadMs: number, toneMs: number, tailMs: number): Buffer {
    const n = (ms: number) => Math.round((ms / 1000) * RATE)
    const total = n(leadMs) + n(toneMs) + n(tailMs)
    const raw = Buffer.alloc(total * 2)
    for (let i = n(leadMs); i < n(leadMs) + n(toneMs); i++) {
      raw.writeInt16LE(Math.round(Math.sin(i / 8) * 12000), i * 2)
    }
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + raw.length, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(RATE, 24)
    header.writeUInt32LE(RATE * 2, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(raw.length, 40)
    return Buffer.concat([header, raw])
  }
  const durationMs = (wav: Buffer): number => ((wav.length - 44) / 2 / RATE) * 1000

  it('apara o rabo de silêncio do Piper mantendo um respiro curto', () => {
    const wav = makeWav(150, 500, 400) // 400ms de silêncio no fim (sentence_silence)
    const out = tightenWavSilence(wav)
    expect(durationMs(out)).toBeLessThan(durationMs(wav) - 250) // cortou bem mais que 250ms
    expect(durationMs(out)).toBeGreaterThan(500) // mas não comeu o áudio
    expect(out.readUInt32LE(40)).toBe(out.length - 44) // header consistente
    expect(out.toString('ascii', 0, 4)).toBe('RIFF')
  })

  it('não mexe quando não há excesso de silêncio', () => {
    const wav = makeWav(20, 400, 60)
    expect(tightenWavSilence(wav)).toBe(wav)
  })

  it('é seguro com formatos inesperados (não lança, devolve o original)', () => {
    const junk = Buffer.from('isto não é um wav de verdade nem de longe!')
    expect(tightenWavSilence(junk)).toBe(junk)
    const silent = makeWav(300, 0, 300)
    expect(tightenWavSilence(silent)).toBe(silent) // tudo silêncio: não mexe
  })
})

describe('expressividade (noise)', () => {
  it('varia por tom dentro de faixas seguras', () => {
    const neutro = computeNoise('neutro')
    const erro = computeNoise('erro')
    const sucesso = computeNoise('sucesso')
    expect(neutro).toEqual({ noiseScale: 0.62, noiseW: 0.74 })
    expect(erro.noiseW).toBeLessThan(neutro.noiseW) // erro: mais seco/nítido
    expect(sucesso.noiseW).toBeGreaterThan(neutro.noiseW) // sucesso: mais caloroso
    for (const n of [neutro, erro, sucesso]) {
      expect(n.noiseScale).toBeGreaterThanOrEqual(0.55)
      expect(n.noiseScale).toBeLessThanOrEqual(0.68)
      expect(n.noiseW).toBeGreaterThanOrEqual(0.68)
      expect(n.noiseW).toBeLessThanOrEqual(0.82)
    }
  })
})

describe('datas com mês abreviado', () => {
  it('converte DD/MMM/YYYY para extenso', () => {
    expect(normalizePtNumbers('prazo em 12/mar/2026')).toBe(
      'prazo em doze de março de dois mil e vinte e seis'
    )
    expect(normalizePtNumbers('início 1/jan/2025')).toBe(
      'início primeiro de janeiro de dois mil e vinte e cinco'
    )
    expect(normalizePtNumbers('entrega 15/dez/2024')).toBe(
      'entrega quinze de dezembro de dois mil e vinte e quatro'
    )
  })

  it('aceita separador com hífen (DD-MMM-YYYY)', () => {
    expect(normalizePtNumbers('até 5-jun-2026')).toBe(
      'até cinco de junho de dois mil e vinte e seis'
    )
  })

  it('é case-insensitive para abreviações de mês', () => {
    expect(normalizePtNumbers('em 10/MAR/2026')).toBe(
      'em dez de março de dois mil e vinte e seis'
    )
    expect(normalizePtNumbers('em 10/Mar/2026')).toBe(
      'em dez de março de dois mil e vinte e seis'
    )
  })
})

describe('pronúncia de palavras estrangeiras', () => {
  it('substitui GitHub, TypeScript e outras palavras técnicas', () => {
    expect(expandForeignWords('veja no GitHub')).toBe('veja no guitrábe')
    expect(expandForeignWords('usando TypeScript')).toBe('usando táipi iscrípt')
    expect(expandForeignWords('fiz um deploy')).toBe('fiz um deplói')
    expect(expandForeignWords('abriu uma issue')).toBe('abriu uma íchiu')
  })

  it('é case-insensitive', () => {
    expect(expandForeignWords('GITHUB')).toBe('guitrábe')
    expect(expandForeignWords('github')).toBe('guitrábe')
    expect(expandForeignWords('GitHub')).toBe('guitrábe')
  })

  it('não mexe em palavras que não estão no dicionário', () => {
    expect(expandForeignWords('Hefesto e Atena')).toBe('Hefesto e Atena')
    expect(expandForeignWords('palavra normal')).toBe('palavra normal')
  })

  it('pronuncia nomes de IA corretamente', () => {
    expect(expandForeignWords('o modelo Claude')).toBe('o modelo clóde')
    expect(expandForeignWords('usando Gemini')).toBe('usando gémini')
    expect(expandForeignWords('instale o GPT')).toContain('gê pê tê')
  })
})

describe('normalização de nomes de modelos de IA', () => {
  it('normaliza gemini-2.5-flash', () => {
    const result = normalizeModelNames('uso o gemini-2.5-flash')
    expect(result).toContain('dois ponto cinco')
    expect(result).not.toContain('2.5')
  })

  it('normaliza claude-3.5-sonnet', () => {
    const result = normalizeModelNames('rodando claude-3.5-sonnet')
    expect(result).toContain('três ponto cinco')
  })

  it('normaliza gpt-4o', () => {
    const result = normalizeModelNames('testei gpt-4o')
    expect(result).toContain('quatro')
  })

  it('normaliza llama-3.1', () => {
    const result = normalizeModelNames('usando llama-3.1')
    expect(result).toContain('três ponto um')
  })
})

describe('simplificação de URLs', () => {
  it('substitui URL do GitHub por link do guitrábe', () => {
    expect(simplifyUrls('veja https://github.com/user/repo para mais')).toBe(
      'veja link do guitrábe para mais'
    )
  })

  it('substitui URL genérica por link', () => {
    expect(simplifyUrls('acesse https://exemplo.com/path/to/page')).toBe(
      'acesse link'
    )
  })

  it('não mexe em texto sem URL', () => {
    expect(simplifyUrls('texto normal sem links')).toBe('texto normal sem links')
  })
})

describe('prepareText integra todas as normalizações', () => {
  it('processa texto com data abreviada, palavra estrangeira e modelo', () => {
    const out = prepareText('Até 12/mar/2026, faça deploy no GitHub usando gemini-2.5-flash.')
    expect(out).toContain('março')
    expect(out).toContain('deplói')
    expect(out).toContain('guitrábe')
    expect(out).not.toContain('2.5')
  })

  it('simplifica URLs dentro do prepareText', () => {
    const out = prepareText('Veja https://github.com/user/repo para detalhes.')
    expect(out).toContain('link do guitrábe')
    expect(out).not.toContain('https')
  })
})
