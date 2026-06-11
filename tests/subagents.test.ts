import { describe, expect, it } from 'vitest'
import type { MemoryFact } from '../src/shared/types'
import { AUDITOR, ENGINEER, RESEARCHER, SUBAGENT_PROFILES, getSubagentProfile } from '../src/main/subagents/profiles'
import { buildTaskPrompt, parseReportTags, relevantMemories, summarizeReport } from '../src/main/subagents/executor'
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
  it('tem os três especialistas com campos completos', () => {
    expect(SUBAGENT_PROFILES).toHaveLength(3)
    for (const p of [RESEARCHER, ENGINEER, AUDITOR]) {
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

  it('getSubagentProfile acha por id e devolve null para desconhecido', () => {
    expect(getSubagentProfile('engineer')).toBe(ENGINEER)
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
    expect(out).not.toContain('O usuário prefere café sem açúcar')
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

  it('devolve objeto vazio quando não há tags', () => {
    expect(parseReportTags('texto livre sem template')).toEqual({})
  })
})
