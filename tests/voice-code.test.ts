import { describe, expect, it } from 'vitest'
import {
  codeVoiceProgressSummary,
  isDuplicateSpeech,
  rootCauseError,
  sanitizeVoiceCodeFala,
  toolResultsPrompt,
  voiceCodeInterpretation,
  voiceAwareUserContent,
  voiceToolAnnouncement
} from '../src/main/voiceCode'

describe('voiceToolAnnouncement — anúncio falado não-bloqueante', () => {
  it('anuncia a primeira ação reconhecida em frase curta', () => {
    expect(voiceToolAnnouncement([{ tipo: 'codigo.testar' }])).toMatch(/testes/i)
    expect(voiceToolAnnouncement([{ tipo: 'codigo.typecheck' }])).toMatch(/tipos/i)
    expect(voiceToolAnnouncement([{ tipo: 'subagente.depurar' }])).toMatch(/Prometeu/)
  })

  it('inclui o nome curto do arquivo em edições e leituras', () => {
    expect(voiceToolAnnouncement([{ tipo: 'codigo.editar', arquivo: 'src/main/code.ts' }])).toContain('code.ts')
    expect(voiceToolAnnouncement([{ tipo: 'codigo.ler', arquivo: 'src\\renderer\\App.tsx' }])).toContain('App.tsx')
  })

  it('resume o comando do terminal sem despejar a linha inteira', () => {
    const out = voiceToolAnnouncement([{ tipo: 'codigo.terminal', comando: 'npm run test -- --reporter=verbose --watch=false' }])
    expect(out).toContain('npm run test')
    expect(out).not.toContain('--reporter')
  })

  it('devolve vazio para ações sem anúncio mapeado', () => {
    expect(voiceToolAnnouncement([{ tipo: 'clima.consultar' }])).toBe('')
    expect(voiceToolAnnouncement([])).toBe('')
  })
})

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

  it('remove markdown e marcadores de lista da resposta falada de analise', () => {
    const fala = sanitizeVoiceCodeFala('**Documentos**:\n1. `Ares`\n2. **Cerebro_Obsidian**\n- Tudo em ordem.')

    expect(fala).toContain('Documentos')
    expect(fala).toContain('Ares')
    expect(fala).not.toMatch(/[*`]/)
    expect(fala).not.toContain('1.')
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

  it('gera resumo falavel imediato para analise de diretorio', () => {
    const summary = codeVoiceProgressSummary([
      {
        tipo: 'codigo.workspace',
        resultado: {
          name: 'Ares',
          exists: true,
          files: ['src/main/agent.ts', 'src/renderer/App.tsx', 'package.json'],
          languages: { TypeScript: 2, JSON: 1 },
          hints: ['teste disponível: npm run test'],
          health: { ok: true, label: 'estrutura em ordem', signals: [] }
        }
      }
    ])

    expect(summary).toContain('diretório Ares')
    expect(summary).toContain('3 arquivos')
    expect(summary).toContain('estrutura em ordem')
    expect(summary.length).toBeLessThan(360)
  })

  it('gera resumo falavel imediato para subagente depurar, construir, auditar e pesquisar', () => {
    const depurar = codeVoiceProgressSummary([
      {
        tipo: 'subagente.depurar',
        resultado: {
          ok: true,
          relatorio: '[CAUSA RAIZ] A causa raiz é um import inválido em file.ts:12.\\n[CORRECAO]\\n1. file.ts:12\\n   ANTES: import x\\n   DEPOIS: import y\\n[VALIDAR]\\nnpm run test'
        }
      }
    ])
    expect(depurar).toContain('Prometeu identificou a causa raiz: A causa raiz é um import inválido em file.ts:12.')

    const construir = codeVoiceProgressSummary([
      {
        tipo: 'subagente.construir',
        resultado: {
          ok: true,
          relatorio: '[ESCOPO] Refatorar a classe A.\\n[PASSOS]\\n1. Editar file.ts'
        }
      }
    ])
    expect(construir).toContain('Hefesto elaborou o plano: Refatorar a classe A.')

    const auditar = codeVoiceProgressSummary([
      {
        tipo: 'subagente.auditar',
        resultado: {
          ok: true,
          relatorio: '[VEREDITO] APROVADO\\n[RESUMO] Mudanças em ordem.'
        }
      }
    ])
    expect(auditar).toContain('Têmis concluiu a auditoria e aprovou as alterações')
  })

  it('detecta falas duplicadas para nao repetir resumo e conclusao', () => {
    expect(isDuplicateSpeech('Analisei o diretório X: 3 arquivos.', 'analisei o diretório x: 3 arquivos')).toBe(true)
    expect(isDuplicateSpeech('Analisei o diretório X: 3 arquivos. Estrutura em ordem.', 'Analisei o diretório X: 3 arquivos.')).toBe(true)
    expect(isDuplicateSpeech('Analisei o diretório X.', 'O projeto usa TypeScript e os testes passam.')).toBe(false)
    expect(isDuplicateSpeech('', 'qualquer coisa')).toBe(false)
  })

  it('resume typecheck, dependencias e pendencias de forma falavel', () => {
    expect(
      codeVoiceProgressSummary([
        { tipo: 'codigo.typecheck', resultado: { kind: 'typecheck', summary: 'Tipos verificados, sem erros.' } }
      ])
    ).toContain('Tipos verificados')

    expect(
      codeVoiceProgressSummary([
        { tipo: 'codigo.deps', resultado: { summary: '3 dependências desatualizadas. Sem vulnerabilidades conhecidas.' } }
      ])
    ).toContain('3 dependências desatualizadas')

    const todos = codeVoiceProgressSummary([
      {
        tipo: 'codigo.todo',
        resultado: {
          total: 2,
          summary: '2 pendências marcadas no código.',
          items: [{ file: 'src/main/code.ts', line: 42, tag: 'TODO', text: 'revisar' }]
        }
      }
    ])
    expect(todos).toContain('2 pendências')
    expect(todos).toContain('src/main/code.ts:42')
  })

  it('resume erro de terminal sem ler stack trace', () => {
    const summary = codeVoiceProgressSummary([
      {
        tipo: 'codigo.terminal',
        resultado: {
          command: 'npm test',
          ok: false,
          code: 1,
          stderr: 'Error: Cannot find module "vitest"\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1145:15)'
        }
      }
    ])

    expect(summary).toContain('npm test')
    expect(summary).toContain('Cannot find module')
    expect(summary).not.toContain('Module._resolveFilename')
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
