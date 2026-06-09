import { describe, expect, it } from 'vitest'
import {
  rootCauseError,
  sanitizeVoiceCodeFala,
  toolResultsPrompt,
  voiceCodeInterpretation,
  voiceAwareUserContent
} from '../src/main/voiceCode'

describe('voz no modo programador', () => {
  it('interpreta caminhos e extensoes ditados por voz', () => {
    expect(voiceCodeInterpretation('leia o arquivo src barra main barra code ponto ts linha 10')).toBe(
      'leia o arquivo src/main/code.ts linha 10'
    )
    expect(voiceCodeInterpretation('abra src barra renderer barra App ponto t s x')).toBe('abra src/renderer/App.tsx')
  })

  it('interpreta comandos comuns de terminal ditados por voz', () => {
    expect(voiceCodeInterpretation('rode npm rum verify no projeto')).toBe('rode npm run verify no projeto')
    expect(voiceCodeInterpretation('confira guit estado')).toBe('confira git status')
  })

  it('interpreta termos técnicos ditados (arrow function, async await, try catch, callback)', () => {
    expect(voiceCodeInterpretation('transforme a função em função seta no código')).toContain('arrow function')
    expect(voiceCodeInterpretation('use assíncrono com await nessa função')).toContain('async await')
    expect(voiceCodeInterpretation('envolva em tente e capture a função')).toContain('try catch')
    expect(voiceCodeInterpretation('passe uma função de retorno para a função')).toContain('callback')
  })

  it('nao cria interpretacao auxiliar para fala comum sem contexto de codigo', () => {
    expect(voiceCodeInterpretation('adicione barra de cereal na lista')).toBeNull()
    expect(voiceAwareUserContent('bom dia', true)).toBe('bom dia')
  })

  it('anexa interpretacao auxiliar apenas no modo voz', () => {
    const text = 'edite arquivo src barra main ponto ts'

    expect(voiceAwareUserContent(text, false)).toBe(text)
    expect(voiceAwareUserContent(text, true)).toContain('Interpretacao auxiliar para voz em codigo')
    expect(voiceAwareUserContent(text, true)).toContain('src/main.ts')
  })

  it('remove codigo e limita resposta falada', () => {
    const fala = sanitizeVoiceCodeFala(
      'Ajustei `src/main.ts`.\n```ts\nconsole.log("nao leia isso")\n```\nRodei os testes e passaram. Detalhe extra que nao deve entrar.'
    )

    expect(fala).toContain('Ajustei src/main.ts.')
    expect(fala).toContain('Trecho de codigo omitido na fala.')
    expect(fala).not.toContain('console.log')
    expect(fala).not.toContain('Detalhe extra')
  })

  it('NUNCA esvazia a fala quando há conteúdo (corrige a voz mudada após análise)', () => {
    // Resposta de "analisar diretório" sem pontuação de fim de frase (lista de arquivos).
    const listagem = sanitizeVoiceCodeFala(
      'O diretório tem três pastas principais: src, tests e docs, além de package.json e README'
    )
    expect(listagem.length).toBeGreaterThan(0)
    expect(listagem).toContain('diretório')

    // Resposta cujas linhas TODAS parecem stack/code-frame não deve virar vazio.
    const soTecnico = sanitizeVoiceCodeFala('arquivo.ts:12:5\noutro.ts:30:2')
    expect(soTecnico.length).toBeGreaterThan(0)

    // String realmente vazia continua vazia.
    expect(sanitizeVoiceCodeFala('   ')).toBe('')
  })

  it('inclui regra especifica para resultados de codigo em voz', () => {
    const prompt = toolResultsPrompt([{ tipo: 'codigo.ler', resultado: { file: 'x.ts' } }], true, true)

    expect(prompt).toContain('MODO VOZ PARA CODIGO')
    expect(prompt).toContain('nao leia codigo')
    expect(toolResultsPrompt([], true, false)).not.toContain('MODO VOZ PARA CODIGO')
  })

  it('trunca tool results grandes em modo voz+codigo', () => {
    const bigResult = [
      {
        tipo: 'codigo.ler',
        resultado: { file: 'x.ts', content: 'a'.repeat(5000), stdout: 'b'.repeat(3000) }
      }
    ]
    const prompt = toolResultsPrompt(bigResult, true, true)
    expect(prompt).toContain('truncado para voz')
    // O conteúdo original de 5000 chars NÃO deve aparecer inteiro
    expect(prompt).not.toContain('a'.repeat(5000))
  })

  it('trunca campos aninhados e mantem prompt de voz abaixo do limite', () => {
    const bigResult = [
      {
        tipo: 'codigo.workspace',
        resultado: {
          files: Array.from({ length: 200 }, (_, i) => `src/arquivo-${i}.ts`),
          nested: { output: 'x'.repeat(8000) }
        }
      }
    ]
    const prompt = toolResultsPrompt(bigResult, true, true)

    expect(prompt).toContain('[...resultado truncado para voz...]')
    expect(prompt.length).toBeLessThan(4700)
    expect(prompt).not.toContain('x'.repeat(8000))
  })

  it('nao trunca tool results pequenos em modo voz', () => {
    const smallResult = [{ tipo: 'codigo.ler', resultado: { file: 'x.ts', content: 'hello world' } }]
    const prompt = toolResultsPrompt(smallResult, true, true)
    expect(prompt).toContain('hello world')
    expect(prompt).not.toContain('truncado para voz')
  })

  it('nao trunca em modo texto (voice=false)', () => {
    const bigResult = [
      { tipo: 'codigo.ler', resultado: { file: 'x.ts', content: 'a'.repeat(5000) } }
    ]
    const prompt = toolResultsPrompt(bigResult, false, true)
    expect(prompt).toContain('a'.repeat(5000))
  })

  it('extrai a causa raiz do erro ignorando o stack trace', () => {
    const stderr = [
      'node:internal/modules/cjs/loader:1148',
      '  throw err;',
      'Error: Cannot find module "left-pad"',
      '    at Module._resolveFilename (node:internal/modules/cjs/loader:1145:15)',
      '    at Module._load (node:internal/modules/cjs/loader:986:27)',
      '    at /home/acer/projeto/index.js:1:1'
    ].join('\n')

    expect(rootCauseError(stderr)).toBe('Error: Cannot find module "left-pad"')
  })

  it('cai para a primeira linha relevante quando não há rótulo de erro', () => {
    expect(rootCauseError('comando concluído com avisos\n  detalhe técnico irrelevante')).toBe(
      'comando concluído com avisos'
    )
    expect(rootCauseError('')).toBe('')
  })

  it('em voz+codigo o stderr vira só a causa raiz, sem o rastreamento', () => {
    const result = [
      {
        tipo: 'codigo.terminal',
        resultado: {
          ok: false,
          stderr: 'Error: ENOENT: no such file or directory\n    at Object.openSync (node:fs:600:3)\n    at /x/y.js:2:1'
        }
      }
    ]
    const prompt = toolResultsPrompt(result, true, true)
    expect(prompt).toContain('ENOENT: no such file or directory')
    expect(prompt).not.toContain('Object.openSync')
  })
})
