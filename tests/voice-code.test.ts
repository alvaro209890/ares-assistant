import { describe, expect, it } from 'vitest'
import { sanitizeVoiceCodeFala, toolResultsPrompt, voiceCodeInterpretation, voiceAwareUserContent } from '../src/main/voiceCode'

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

  it('inclui regra especifica para resultados de codigo em voz', () => {
    const prompt = toolResultsPrompt([{ tipo: 'codigo.ler', resultado: { file: 'x.ts' } }], true, true)

    expect(prompt).toContain('MODO VOZ PARA CODIGO')
    expect(prompt).toContain('nao leia codigo')
    expect(toolResultsPrompt([], true, false)).not.toContain('MODO VOZ PARA CODIGO')
  })
})
