import { describe, expect, it, vi } from 'vitest'
import type { AppConfig, MemoryFact } from '../src/shared/types'
import { AUDITOR, DEBUGGER, ENGINEER, RESEARCHER, SUBAGENT_PROFILES, getSubagentProfile } from '../src/main/subagents/profiles'
import {
  buildTaskPrompt,
  executeSubagentTask,
  missingReportTags,
  parseReportTags,
  relevantMemories,
  summarizeReport
} from '../src/main/subagents/executor'
import { chatJSON } from '../src/main/ninerouter'

vi.mock('../src/main/ninerouter', () => ({
  chatJSON: vi.fn()
}))
import {
  evidenceOf,
  parseGitStatusFiles,
  pickRelevantFiles,
  renderEvidencePackage,
  truncateSmart
} from '../src/main/subagents/evidence'

const fact = (text: string, over: Partial<MemoryFact> = {}): MemoryFact => ({
  id: `f-${text.slice(0, 8)}`,
  text,
  category: 'projetos',
  source: 'manual',
  status: 'active',
  createdAt: Date.now(),
  ...over
})

describe('colmeia — perfis dos subagentes', () => {
  it('tem os quatro especialistas com campos completos', () => {
    expect(SUBAGENT_PROFILES).toHaveLength(4)
    for (const p of [RESEARCHER, ENGINEER, AUDITOR, DEBUGGER]) {
      expect(p.label.length).toBeGreaterThan(2)
      expect(p.systemPrompt).toContain('subagente')
      expect(p.temperature).toBeGreaterThanOrEqual(0)
      expect(p.temperature).toBeLessThanOrEqual(0.5)
    }
  })

  it('temperaturas refletem a especialidade (auditor mais frio que pesquisador)', () => {
    expect(AUDITOR.temperature).toBeLessThan(RESEARCHER.temperature)
  })

  it('Hefesto é tech-lead (não escreve projeto inteiro)', () => {
    expect(ENGINEER.systemPrompt).toMatch(/\[ESCOPO\]/)
    expect(ENGINEER.systemPrompt).toMatch(/\[ARQUIVOS\]/)
    expect(ENGINEER.systemPrompt).toMatch(/\[PASSOS\]/)
    expect(ENGINEER.systemPrompt).toMatch(/coder autônomo|coder\.autônomo|codigo\.projeto/i)
    expect(ENGINEER.systemPrompt).toMatch(/N[ÃA]O escreve/i)
  })

  it('Têmis abre com VEREDITO e usa blocos de problemas', () => {
    expect(AUDITOR.systemPrompt).toMatch(/\[VEREDITO\]/)
    expect(AUDITOR.systemPrompt).toMatch(/APROVADO|REPROVADO/)
    expect(AUDITOR.systemPrompt).toMatch(/\[PROBLEMAS\]/)
  })

  it('Prometeu foca em causa raiz com correção cirúrgica', () => {
    expect(DEBUGGER.label).toBe('Prometeu')
    expect(DEBUGGER.systemPrompt).toMatch(/\[CAUSA RAIZ\]/)
    expect(DEBUGGER.systemPrompt).toMatch(/\[CORRECAO\]/)
    expect(DEBUGGER.systemPrompt).toMatch(/\[VALIDAR\]/)
    expect(DEBUGGER.systemPrompt).toMatch(/cir[uú]rgic/i)
    expect(DEBUGGER.temperature).toBeLessThanOrEqual(AUDITOR.temperature)
  })

  it('Hefesto tem [TRECHOS] antes/depois e Prometeu tem budget maior de relatório', () => {
    expect(ENGINEER.systemPrompt).toMatch(/ANTES.*DEPOIS|DEPOIS.*ANTES/is)
    expect(ENGINEER.reportMaxChars).toBeGreaterThanOrEqual(8000)
    expect(DEBUGGER.reportMaxChars).toBeGreaterThanOrEqual(8000)
    // Atena e Têmis usam o padrão menor
    expect(RESEARCHER.reportMaxChars ?? 6000).toBeLessThan(ENGINEER.reportMaxChars!)
  })

  it('getSubagentProfile acha por id e devolve null para desconhecido', () => {
    expect(getSubagentProfile('engineer')).toBe(ENGINEER)
    expect(getSubagentProfile('debugger')).toBe(DEBUGGER)
    expect(getSubagentProfile('chef')).toBeNull()
  })
})

describe('colmeia — buildTaskPrompt', () => {
  it('inclui objetivo, contexto, material (string crua) e memórias', () => {
    const prompt = buildTaskPrompt({
      goal: 'Comparar Vitest e Jest',
      context: 'O usuário usa Electron com Vite',
      evidence: 'Resultados de busca: ...',
      memories: ['Projeto Ares usa Vitest']
    })
    expect(prompt).toContain('OBJETIVO:\nComparar Vitest e Jest')
    expect(prompt).toContain('CONTEXTO DO ARES')
    expect(prompt).toContain('MATERIAL COLETADO')
    expect(prompt).toContain('- Projeto Ares usa Vitest')
  })

  it('renderiza EvidencePackage quando evidence é estruturado', () => {
    const prompt = buildTaskPrompt({
      goal: 'Auditar mudança',
      evidence: evidenceOf([
        { title: 'Diagnóstico', body: 'typecheck: ok\nlint: ok\ntest: 12/12 passaram', priority: 1, minChars: 200 },
        { title: 'Diff de a.ts', body: '- old\n+ new\n', priority: 1, minChars: 200 }
      ])
    })
    expect(prompt).toContain('## Diagnóstico')
    expect(prompt).toContain('## Diff de a.ts')
    expect(prompt).toContain('typecheck: ok')
  })

  it('omite seções vazias', () => {
    const prompt = buildTaskPrompt({ goal: 'Auditar o projeto' })
    expect(prompt).not.toContain('CONTEXTO DO ARES')
    expect(prompt).not.toContain('MATERIAL COLETADO')
    expect(prompt).not.toContain('MEMÓRIA DE LONGO PRAZO')
  })
})

describe('colmeia — relevantMemories (recuperação semântica por tokens)', () => {
  const facts = [
    fact('O projeto Ares é um app Electron com React e Vitest'),
    fact('O usuário prefere café sem açúcar', { category: 'preferencias' }),
    fact('O deploy do VendaFácil usa Vercel e Render')
  ]

  it('recupera o fato mais parecido com o objetivo', () => {
    const out = relevantMemories('auditar o projeto Ares Electron', facts)
    expect(out[0]).toContain('Ares')
    expect(out).toContain('O usuário prefere café sem açúcar')
  })

  it('ignora fatos pendentes e devolve vazio sem objetivo', () => {
    const pendentes = [fact('Ares Electron projeto', { status: 'pending' })]
    expect(relevantMemories('projeto Ares Electron', pendentes)).toEqual([])
    expect(relevantMemories('   ', facts)).toEqual([])
  })

  it('limita ao máximo pedido', () => {
    const many = Array.from({ length: 10 }, (_, i) => fact(`projeto Ares módulo ${i}`))
    expect(relevantMemories('projeto Ares', many, 3).length).toBeLessThanOrEqual(3)
  })
})

describe('colmeia — summarizeReport', () => {
  it('pega a primeira frase, curta', () => {
    expect(summarizeReport('Veredito: APROVADO. Nenhum problema real encontrado.\nDetalhes...')).toBe(
      'Veredito: APROVADO.'
    )
  })

  it('trunca relatórios sem pontuação', () => {
    expect(summarizeReport('x'.repeat(300)).length).toBeLessThanOrEqual(120)
  })
})

describe('colmeia — parseReportTags', () => {
  it('aceita quebras de linha reais e escapadas em relatórios de subagente', () => {
    const real = parseReportTags('[CAUSA RAIZ] Import inválido.\n[VALIDAR]\nnpm run test')
    expect(real.rootCause).toBe('Import inválido.')
    expect(real.validateCmd).toBe('npm run test')

    const escaped = parseReportTags('[CAUSA RAIZ] Import inválido.\\n[VALIDAR]\\nnpm run test')
    expect(escaped.rootCause).toBe('Import inválido.')
    expect(escaped.validateCmd).toBe('npm run test')
  })
})

describe('colmeia — EvidencePackage (renderer e helpers)', () => {
  it('truncateSmart preserva fronteira de linha quando possível', () => {
    const text = 'linha A\nlinha B\nlinha C\nlinha D\nlinha E\nlinha F'
    const cut = truncateSmart(text, 24)
    expect(cut).toContain('[')
    expect(cut).toMatch(/linha [A-D]/)
    // não corta no meio de uma linha quando há quebra suficiente à direita
    expect(cut.startsWith('linha A\nlinha B')).toBe(true)
  })

  it('truncateSmart devolve o texto inteiro quando cabe no limite', () => {
    expect(truncateSmart('abc', 10)).toBe('abc')
    expect(truncateSmart('abc', 0)).toBe('')
  })

  it('renderEvidencePackage rotula seções e respeita orçamento', () => {
    const big = 'x'.repeat(2000)
    const out = renderEvidencePackage({
      sections: [
        { title: 'Essencial', body: big, priority: 1, minChars: 400 },
        { title: 'Útil', body: big, priority: 2, minChars: 200 },
        { title: 'Opcional', body: big, priority: 3, minChars: 0 }
      ]
    }, 1000)
    expect(out).toContain('## Essencial')
    expect(out).toContain('## Útil')
    expect(out.length).toBeLessThanOrEqual(1400) // budget + cabeçalhos/marcador de truncamento
  })

  it('renderEvidencePackage prioriza essencial sob orçamento apertado', () => {
    const long = 'x'.repeat(1500)
    const out = renderEvidencePackage({
      sections: [
        { title: 'Essencial', body: long, priority: 1, minChars: 500 },
        { title: 'Opcional', body: long, priority: 3, minChars: 0 }
      ]
    }, 600)
    const essStart = out.indexOf('## Essencial')
    const optStart = out.indexOf('## Opcional')
    // Essencial recebe quota mínima primeiro; opcional pode nem aparecer com 600 chars.
    expect(essStart).toBeGreaterThanOrEqual(0)
    if (optStart > 0) {
      // se aparecer, deve ser bem menor que a essencial
      const essBlock = out.slice(essStart, optStart)
      const optBlock = out.slice(optStart)
      expect(essBlock.length).toBeGreaterThan(optBlock.length)
    }
  })

  it('renderEvidencePackage emite notas separadas', () => {
    const out = renderEvidencePackage({
      sections: [{ title: 'A', body: 'corpo', priority: 1, minChars: 100 }],
      notes: ['web.buscar falhou: timeout']
    }, 500)
    expect(out).toContain('## Observações da coleta')
    expect(out).toContain('web.buscar falhou: timeout')
  })

  it('evidenceOf descarta seções vazias', () => {
    const pkg = evidenceOf([
      { title: 'A', body: 'útil', priority: 1 },
      { title: 'B', body: '', priority: 2 },
      null,
      undefined
    ])
    expect(pkg.sections).toHaveLength(1)
    expect(pkg.sections[0].title).toBe('A')
  })
})

describe('colmeia — pickRelevantFiles', () => {
  const files = [
    'src/main/agent.ts',
    'src/main/subagents/executor.ts',
    'src/main/subagents/profiles.ts',
    'src/renderer/components/HiveDashboard.tsx',
    'src/main/code.ts',
    'tests/coder.test.ts'
  ]

  it('ranqueia por tokens do objetivo', () => {
    // tokens: 'auditar','executor','dos','subagents' -> hits no caminho subagents/executor.ts
    const out = pickRelevantFiles(files, 'auditar executor dos subagents', 3)
    expect(out[0]).toBe('src/main/subagents/executor.ts')
    expect(out).not.toContain('tests/coder.test.ts')
  })

  it('fallback para lista geral quando nada bate', () => {
    const out = pickRelevantFiles(files, 'xy z', 2)
    expect(out).toEqual(files.slice(0, 2))
  })

  it('respeita limite max', () => {
    const many = Array.from({ length: 30 }, (_, i) => `mod${i}/file.ts`)
    expect(pickRelevantFiles(many, 'mod file', 5).length).toBeLessThanOrEqual(5)
  })
})

describe('colmeia — parseGitStatusFiles', () => {
  it('extrai paths simples e renames', () => {
    const out = parseGitStatusFiles(' M src/a.ts\n?? new.txt\nR  old.ts -> src/new.ts')
    expect(out).toContain('src/a.ts')
    expect(out).toContain('new.txt')
    expect(out).toContain('src/new.ts')
    expect(out).not.toContain('old.ts')
  })

  it('lida com string vazia', () => {
    expect(parseGitStatusFiles('')).toEqual([])
  })
})

describe('colmeia — parseReportTags', () => {
  it('extrai veredito APROVADO/REPROVADO', () => {
    expect(parseReportTags('[VEREDITO] APROVADO\n[RESUMO] tudo certo').verdict).toBe('APROVADO')
    expect(parseReportTags('Veredito: REPROVADO. Falta tipo.').verdict).toBe('REPROVADO')
  })

  it('extrai lista de arquivos do bloco [ARQUIVOS]', () => {
    const r = parseReportTags(
      '[ESCOPO] mudar X.\n[ARQUIVOS]\n- src/a.ts (editar): novo método\n- src/b.ts (criar): tipos\n[PASSOS]\n1. fazer'
    )
    expect(r.files).toContain('src/a.ts')
    expect(r.files).toContain('src/b.ts')
    expect(r.files).not.toContain('mudar')
  })

  it('extrai riscos do bloco [RISCOS]', () => {
    const r = parseReportTags(
      '[VEREDITO] APROVADO\n[RISCOS]\n- regressão na função Y se A não migrar\n- perf: O(n²) em loop grande'
    )
    expect(r.risks).toBeTruthy()
    expect(r.risks!.length).toBe(2)
    expect(r.risks![0]).toMatch(/regressão/i)
  })

  it('extrai [CAUSA RAIZ] do relatório do Prometeu', () => {
    const r = parseReportTags(
      '[CAUSA RAIZ] O método `foo` em src/main/x.ts:42 retorna undefined antes do await.\n[EVIDÊNCIA]\n- linha 42: return foo()\n[CORRECAO]\n1. src/main/x.ts:42 — adicionar await\n[VALIDAR]\nnpm test'
    )
    expect(r.rootCause).toMatch(/foo.*src\/main\/x\.ts/)
  })

  it('extrai [VALIDAR] como comando limpo (sem backticks, sem bullets)', () => {
    const r1 = parseReportTags('[VALIDAR]\n`npm run verify`\n')
    expect(r1.validateCmd).toBe('npm run verify')

    const r2 = parseReportTags('[VALIDAR]\n- npm test -- --reporter=verbose\n')
    expect(r2.validateCmd).toBe('npm test -- --reporter=verbose')

    const r3 = parseReportTags('[VALIDAR] npm run typecheck')
    expect(r3.validateCmd).toBe('npm run typecheck')
  })

  it('extrai [ESCOPO] como primeira linha do Hefesto', () => {
    const r = parseReportTags(
      '[ESCOPO] Adicionar campo `expiry` em UserProfile sem quebrar contratos existentes.\n[ARQUIVOS]\n- src/types.ts (editar): novo campo'
    )
    expect(r.scope).toMatch(/expiry.*UserProfile/i)
  })

  it('extrai [PROBLEMAS] estruturado da Têmis', () => {
    const r = parseReportTags(
      '[VEREDITO] REPROVADO\n[PROBLEMAS]\n- src/main/code.ts:456 — alta — `foo` retorna undefined quando cfg é null\n- src/renderer/App.tsx:12 — baixa — import não utilizado\n'
    )
    expect(r.problems).toHaveLength(2)
    expect(r.problems![0].file).toBe('src/main/code.ts')
    expect(r.problems![0].line).toBe(456)
    expect(r.problems![0].severity).toBe('alta')
    expect(r.problems![0].desc).toMatch(/foo.*undefined/)
    expect(r.problems![1].severity).toBe('baixa')
  })

  it('devolve objeto vazio quando não há tags', () => {
    expect(parseReportTags('texto livre sem template')).toEqual({})
  })

  it('extrai [RESUMO] (Atena/Têmis) para o relato falado', () => {
    const r = parseReportTags('[RESUMO] O lançamento foi confirmado para março de 2026.\n[FATOS]\n- fato — fonte — data')
    expect(r.summary).toBe('O lançamento foi confirmado para março de 2026.')
  })
})

describe('colmeia — missingReportTags (blocos obrigatórios)', () => {
  it('aceita bloco com colchetes, rótulo com dois-pontos e variação de acento', () => {
    expect(missingReportTags('[VEREDITO] APROVADO', ['VEREDITO'])).toEqual([])
    expect(missingReportTags('VEREDITO: APROVADO', ['VEREDITO'])).toEqual([])
    expect(missingReportTags('[CORREÇÃO]\n1. trocar x por y', ['CORRECAO'])).toEqual([])
  })

  it('aponta exatamente o que falta', () => {
    expect(missingReportTags('[CAUSA RAIZ] import errado', ['CAUSA RAIZ', 'CORRECAO', 'VALIDAR'])).toEqual([
      'CORRECAO',
      'VALIDAR'
    ])
    expect(missingReportTags('', ['VEREDITO'])).toEqual(['VEREDITO'])
    expect(missingReportTags('qualquer texto', undefined)).toEqual([])
  })
})

describe('colmeia — executeSubagentTask (rodada corretiva)', () => {
  const cfg = {} as AppConfig

  it('pede correção UMA vez quando o relatório vem sem os blocos do papel', async () => {
    const mock = vi.mocked(chatJSON)
    mock.mockReset()
    mock.mockResolvedValueOnce('análise solta, sem nenhum bloco rotulado')
    mock.mockResolvedValueOnce('[VEREDITO] APROVADO\n[RESUMO] Mudanças em ordem.')

    const r = await executeSubagentTask(AUDITOR, { goal: 'auditar o diff' }, cfg)

    expect(mock).toHaveBeenCalledTimes(2)
    expect(r.ok).toBe(true)
    expect(r.report).toContain('[VEREDITO]')
    // a mensagem corretiva cita o bloco que faltou
    expect(JSON.stringify(mock.mock.calls[1][1])).toContain('[VEREDITO]')
  })

  it('não refaz quando o relatório já vem completo', async () => {
    const mock = vi.mocked(chatJSON)
    mock.mockReset()
    mock.mockResolvedValueOnce('[VEREDITO] APROVADO\n[RESUMO] ok')

    const r = await executeSubagentTask(AUDITOR, { goal: 'auditar' }, cfg)

    expect(mock).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)
  })

  it('mantém o relatório original se a reescrita não melhorar', async () => {
    const mock = vi.mocked(chatJSON)
    mock.mockReset()
    mock.mockResolvedValueOnce('primeiro relatório sem blocos')
    mock.mockResolvedValueOnce('segundo igualmente sem blocos')

    const r = await executeSubagentTask(AUDITOR, { goal: 'auditar' }, cfg)

    expect(r.ok).toBe(true)
    expect(r.report).toBe('primeiro relatório sem blocos')
  })
})
