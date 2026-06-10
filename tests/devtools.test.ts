import { describe, expect, it } from 'vitest'
import {
  detectTestCommand,
  detectLintCommand,
  detectFormatCommand,
  detectTypecheckCommand,
  parseTestCounts,
  parseLintCount,
  parseTypecheckCount,
  parseNpmOutdated,
  parseNpmAudit,
  matchTodoLine,
  describeDevResult,
  describeDepsResult,
  describeTodosResult
} from '../src/main/devtools'

describe('detecção de comando — testar', () => {
  it('prefere o script "test" do package.json (com o gerenciador certo)', () => {
    expect(detectTestCommand({ scripts: { test: 'vitest run' }, packageManager: 'pnpm', files: [] })).toEqual({
      command: 'pnpm test',
      runner: 'script'
    })
  })
  it('cai para vitest/jest/pytest/go por arquivo de config quando não há script', () => {
    expect(detectTestCommand({ files: ['vitest.config.ts'] })?.command).toBe('npx vitest run')
    expect(detectTestCommand({ files: ['jest.config.js'] })?.command).toBe('npx jest')
    expect(detectTestCommand({ files: ['pyproject.toml', 'app/main.py'] })?.command).toBe('pytest')
    expect(detectTestCommand({ files: ['go.mod'] })?.command).toBe('go test ./...')
  })
  it('devolve null quando não há como testar', () => {
    expect(detectTestCommand({ files: ['readme.md'] })).toBeNull()
  })
})

describe('detecção de comando — lint e format', () => {
  it('lint: script, eslint, ruff', () => {
    expect(detectLintCommand({ scripts: { lint: 'eslint .' }, packageManager: 'npm', files: [] })?.command).toBe('npm run lint')
    expect(detectLintCommand({ files: ['eslint.config.mjs'] })?.command).toBe('npx eslint .')
    expect(detectLintCommand({ files: ['pyproject.toml', 'x.py'] })?.command).toBe('ruff check .')
    expect(detectLintCommand({ files: ['index.html'] })).toBeNull()
  })
  it('format: script, prettier, gofmt', () => {
    expect(detectFormatCommand({ scripts: { format: 'prettier --write .' }, files: [] })?.command).toBe('npm run format')
    expect(detectFormatCommand({ files: ['.prettierrc.json'] })?.command).toBe('npx prettier --write .')
    expect(detectFormatCommand({ files: ['go.mod'] })?.command).toBe('gofmt -w .')
    expect(detectFormatCommand({ files: ['x.txt'] })).toBeNull()
  })
})

describe('parsing de testes', () => {
  it('vitest — tudo passou', () => {
    expect(parseTestCounts('Test Files  20 passed (20)\n      Tests  189 passed (189)')).toEqual({
      passed: 189,
      failed: 0,
      total: 189
    })
  })
  it('vitest — com falhas', () => {
    expect(parseTestCounts('Tests  2 failed | 187 passed (189)')).toEqual({ failed: 2, passed: 187, total: 189 })
  })
  it('jest', () => {
    expect(parseTestCounts('Tests:       1 failed, 5 passed, 6 total')).toEqual({ failed: 1, passed: 5, total: 6 })
  })
  it('pytest — passou e falhou-primeiro', () => {
    expect(parseTestCounts('===== 3 passed in 0.05s =====')).toEqual({ passed: 3, failed: 0, total: 3 })
    expect(parseTestCounts('===== 1 failed, 3 passed in 0.10s =====')).toEqual({ failed: 1, passed: 3, total: 4 })
  })
  it('node --test (TAP)', () => {
    expect(parseTestCounts('# tests 6\n# pass 5\n# fail 1')).toEqual({ passed: 5, failed: 1, total: 6 })
  })
  it('saída desconhecida → vazio', () => {
    expect(parseTestCounts('compilou tudo certo')).toEqual({})
  })
})

describe('parsing de lint', () => {
  it('eslint conta problemas; ruff conta erros; limpo = 0', () => {
    expect(parseLintCount('✖ 8 problems (3 errors, 5 warnings)')).toBe(8)
    expect(parseLintCount('Found 5 errors.')).toBe(5)
    expect(parseLintCount('All checks passed!')).toBe(0)
    expect(parseLintCount('algo aleatório')).toBeUndefined()
  })
})

describe('resumo falável', () => {
  it('testes', () => {
    expect(describeDevResult({ kind: 'test', ok: true, timedOut: false, aborted: false, counts: { passed: 189, failed: 0, total: 189 } })).toMatch(/Todos os 189 testes passaram/)
    expect(describeDevResult({ kind: 'test', ok: false, timedOut: false, aborted: false, counts: { passed: 187, failed: 2, total: 189 } })).toMatch(/2 testes falharam de 189/)
    expect(describeDevResult({ kind: 'test', ok: false, timedOut: false, aborted: false, counts: { passed: 0, failed: 1, total: 1 } })).toMatch(/1 teste falhou/)
  })
  it('lint e format', () => {
    expect(describeDevResult({ kind: 'lint', ok: true, timedOut: false, aborted: false, problems: 0 })).toMatch(/sem problemas/i)
    expect(describeDevResult({ kind: 'lint', ok: false, timedOut: false, aborted: false, problems: 3 })).toMatch(/3 problemas encontrados/)
    expect(describeDevResult({ kind: 'format', ok: true, timedOut: false, aborted: false })).toMatch(/Formatação aplicada/)
  })
  it('interrupção e timeout', () => {
    expect(describeDevResult({ kind: 'test', ok: false, timedOut: false, aborted: true })).toMatch(/Interrompido/)
    expect(describeDevResult({ kind: 'test', ok: false, timedOut: true, aborted: false })).toMatch(/tempo limite/)
  })
})

describe('detecção de comando — typecheck', () => {
  it('prefere o script "typecheck" do package.json', () => {
    expect(detectTypecheckCommand({ scripts: { typecheck: 'tsc --noEmit' }, packageManager: 'pnpm', files: [] })).toEqual({
      command: 'pnpm run typecheck',
      runner: 'script'
    })
    expect(detectTypecheckCommand({ scripts: { 'check:types': 'tsc' }, files: [] })?.command).toBe('npm run check:types')
  })
  it('cai para tsc/mypy/go vet por arquivos do projeto', () => {
    expect(detectTypecheckCommand({ files: ['tsconfig.json'] })?.command).toBe('npx tsc --noEmit')
    expect(detectTypecheckCommand({ files: ['mypy.ini', 'app/main.py'] })?.command).toBe('mypy .')
    expect(detectTypecheckCommand({ files: ['go.mod'] })?.command).toBe('go vet ./...')
    expect(detectTypecheckCommand({ files: ['index.html'] })).toBeNull()
  })
})

describe('parsing de typecheck', () => {
  it('conta erros do tsc e do mypy', () => {
    expect(parseTypecheckCount('Found 12 errors in 3 files.')).toBe(12)
    expect(parseTypecheckCount('Found 1 error.')).toBe(1)
    expect(parseTypecheckCount('Success: no issues found in 12 source files')).toBe(0)
    expect(parseTypecheckCount('saida qualquer')).toBeUndefined()
  })
  it('resumo falável de typecheck', () => {
    expect(describeDevResult({ kind: 'typecheck', ok: true, timedOut: false, aborted: false, problems: 0 })).toBe(
      'Tipos verificados, sem erros.'
    )
    expect(describeDevResult({ kind: 'typecheck', ok: false, timedOut: false, aborted: false, problems: 3 })).toBe(
      '3 erros de tipo encontrados.'
    )
    expect(describeDevResult({ kind: 'typecheck', ok: false, timedOut: false, aborted: false })).toBe(
      'A checagem de tipos apontou erros.'
    )
  })
})

describe('dependências — npm outdated/audit', () => {
  it('parseNpmOutdated lê o JSON e ordena por nome', () => {
    const json = JSON.stringify({
      zod: { current: '3.0.0', wanted: '3.1.0', latest: '4.0.0' },
      axios: { current: '1.0.0', wanted: '1.2.0', latest: '1.2.0' }
    })
    const deps = parseNpmOutdated(json)
    expect(deps.map((d) => d.name)).toEqual(['axios', 'zod'])
    expect(deps[1]).toEqual({ name: 'zod', current: '3.0.0', wanted: '3.1.0', latest: '4.0.0' })
  })
  it('parseNpmOutdated tolera JSON inválido/vazio', () => {
    expect(parseNpmOutdated('')).toEqual([])
    expect(parseNpmOutdated('nao é json')).toEqual([])
    expect(parseNpmOutdated('[]')).toEqual([])
  })
  it('parseNpmAudit extrai as contagens de vulnerabilidades', () => {
    const json = JSON.stringify({ metadata: { vulnerabilities: { critical: 1, high: 2, moderate: 0, low: 3, total: 6 } } })
    expect(parseNpmAudit(json)).toEqual({ critical: 1, high: 2, moderate: 0, low: 3, total: 6 })
    expect(parseNpmAudit('{}')).toBeNull()
    expect(parseNpmAudit('xx')).toBeNull()
  })
  it('describeDepsResult fala em pt-BR e prioriza vulnerabilidades graves', () => {
    expect(describeDepsResult({ checked: false, outdated: [], vulns: null })).toMatch(/Não consegui consultar/)
    expect(describeDepsResult({ checked: true, outdated: [], vulns: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 } })).toBe(
      'Dependências em dia. Sem vulnerabilidades conhecidas.'
    )
    const out = [{ name: 'a', current: '1', wanted: '1', latest: '2' }]
    expect(describeDepsResult({ checked: true, outdated: out, vulns: { critical: 1, high: 0, moderate: 0, low: 0, total: 1 } })).toBe(
      '1 dependência desatualizada. 1 vulnerabilidade, 1 grave.'
    )
  })
})

describe('pendências no código (TODO/FIXME)', () => {
  it('reconhece tags em comentários de várias linguagens', () => {
    expect(matchTodoLine('// TODO: revisar isso')).toEqual({ tag: 'TODO', text: 'revisar isso' })
    expect(matchTodoLine('# FIXME corrigir encoding')).toEqual({ tag: 'FIXME', text: 'corrigir encoding' })
    expect(matchTodoLine('/* HACK gambiarra temporária */')).toEqual({ tag: 'HACK', text: 'gambiarra temporária' })
    expect(matchTodoLine('<!-- BUG: quebra no Safari -->')).toEqual({ tag: 'BUG', text: 'quebra no Safari' })
  })
  it('ignora prosa comum sem marcador de comentário', () => {
    expect(matchTodoLine('analisei todo o projeto')).toBeNull()
    expect(matchTodoLine('const todo = lista[0]')).toBeNull()
  })
  it('describeTodosResult resume com urgências', () => {
    expect(describeTodosResult({ total: 0, byTag: {} })).toBe('Nenhuma pendência marcada no código.')
    expect(describeTodosResult({ total: 5, byTag: { TODO: 3, FIXME: 2 } })).toBe('5 pendências marcadas no código, 2 urgentes.')
    expect(describeTodosResult({ total: 1, byTag: { TODO: 1 } })).toBe('1 pendência marcada no código.')
  })
})
