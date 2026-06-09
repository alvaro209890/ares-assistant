import { describe, expect, it } from 'vitest'
import {
  detectTestCommand,
  detectLintCommand,
  detectFormatCommand,
  parseTestCounts,
  parseLintCount,
  describeDevResult
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
