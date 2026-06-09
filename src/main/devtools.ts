// Skills de qualidade de código (programação e teste): detecção do runner certo
// para TESTAR, LINTAR e FORMATAR um projeto, e parsing do resultado em números
// falavéis (passou/falhou, problemas). Tudo PURO e testável — a cola de processo
// (spawn) fica em code.ts (runTests/runLint/runFormat).
//
// A detecção parte do package.json (scripts) e, na ausência de script, cai para
// runners conhecidos detectados por arquivos de configuração — sempre comandos
// FIXOS/curados (npm/pnpm/yarn/bun/npx/node/pytest/ruff/go), nunca texto livre.

export interface DetectedCommand {
  command: string
  runner: string // rótulo do runner (vitest/jest/pytest/node/go/eslint/ruff/prettier/script)
}

interface ProjectShape {
  scripts?: Record<string, string>
  packageManager?: string
  files: string[] // caminhos relativos (raiz do projeto)
}

const has = (files: string[], ...names: string[]): boolean =>
  names.some((n) => files.some((f) => f === n || f.endsWith(`/${n}`)))

const hasExt = (files: string[], ext: string): boolean => files.some((f) => f.endsWith(ext))

const pmRun = (pm: string | undefined, script: string): string => `${pm || 'npm'} run ${script}`

// ---------------------------------------------------------------------------
// Detecção de comandos
// ---------------------------------------------------------------------------

/** Comando para RODAR OS TESTES do projeto. */
export function detectTestCommand(p: ProjectShape): DetectedCommand | null {
  const s = p.scripts || {}
  if (s.test) return { command: `${p.packageManager || 'npm'} test`, runner: 'script' }
  if (s['test:unit']) return { command: pmRun(p.packageManager, 'test:unit'), runner: 'script' }
  if (has(p.files, 'vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.mts'))
    return { command: 'npx vitest run', runner: 'vitest' }
  if (has(p.files, 'jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs'))
    return { command: 'npx jest', runner: 'jest' }
  if (has(p.files, 'pyproject.toml', 'pytest.ini', 'tox.ini', 'setup.cfg') && hasExt(p.files, '.py'))
    return { command: 'pytest', runner: 'pytest' }
  if (has(p.files, 'go.mod')) return { command: 'go test ./...', runner: 'go' }
  return null
}

/** Comando para LINTAR o projeto. */
export function detectLintCommand(p: ProjectShape): DetectedCommand | null {
  const s = p.scripts || {}
  if (s.lint) return { command: pmRun(p.packageManager, 'lint'), runner: 'script' }
  if (has(p.files, '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts'))
    return { command: 'npx eslint .', runner: 'eslint' }
  if (has(p.files, 'ruff.toml', '.ruff.toml') || (has(p.files, 'pyproject.toml') && hasExt(p.files, '.py')))
    return { command: 'ruff check .', runner: 'ruff' }
  return null
}

/** Comando para FORMATAR o projeto. */
export function detectFormatCommand(p: ProjectShape): DetectedCommand | null {
  const s = p.scripts || {}
  if (s.format) return { command: pmRun(p.packageManager, 'format'), runner: 'script' }
  if (s.fmt) return { command: pmRun(p.packageManager, 'fmt'), runner: 'script' }
  if (has(p.files, '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.yml', '.prettierrc.yaml', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs'))
    return { command: 'npx prettier --write .', runner: 'prettier' }
  if (has(p.files, 'ruff.toml', '.ruff.toml') || (has(p.files, 'pyproject.toml') && hasExt(p.files, '.py')))
    return { command: 'ruff format .', runner: 'ruff' }
  if (has(p.files, 'go.mod')) return { command: 'gofmt -w .', runner: 'go' }
  return null
}

// ---------------------------------------------------------------------------
// Parsing de saída
// ---------------------------------------------------------------------------

export interface TestCounts {
  passed?: number
  failed?: number
  total?: number
}

/** Extrai passou/falhou/total de saídas comuns (vitest, jest, pytest, node --test). */
export function parseTestCounts(output: string): TestCounts {
  const out = output || ''
  // Vitest: "Tests  189 passed (189)" ou "Tests  2 failed | 187 passed (189)".
  let m = out.match(/\bTests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed\s*\((\d+)\)/)
  if (m) return { failed: m[1] ? Number(m[1]) : 0, passed: Number(m[2]), total: Number(m[3]) }
  // Vitest tudo falhou: "Tests  3 failed (3)".
  m = out.match(/\bTests\s+(\d+)\s+failed\s*\((\d+)\)/)
  if (m) return { failed: Number(m[1]), passed: Number(m[2]) - Number(m[1]), total: Number(m[2]) }
  // Jest: "Tests:  1 failed, 2 skipped, 5 passed, 8 total".
  m = out.match(/Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(\d+)\s+passed,\s*(\d+)\s+total/)
  if (m) return { failed: m[1] ? Number(m[1]) : 0, passed: Number(m[3]), total: Number(m[4]) }
  // pytest falhou primeiro: "1 failed, 3 passed in 0.1s".
  m = out.match(/(\d+)\s+failed,\s*(\d+)\s+passed\s+in\s/)
  if (m) return { failed: Number(m[1]), passed: Number(m[2]), total: Number(m[1]) + Number(m[2]) }
  // pytest: "3 passed in 0.05s" ou "3 passed, 1 failed in".
  m = out.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*\d+\s+skipped)?\s+in\s/)
  if (m) {
    const passed = Number(m[1])
    const failed = m[2] ? Number(m[2]) : 0
    return { passed, failed, total: passed + failed }
  }
  // node --test (TAP): "# pass 5" / "# fail 1".
  const pass = out.match(/#\s*pass\s+(\d+)/)
  const fail = out.match(/#\s*fail\s+(\d+)/)
  if (pass || fail) {
    const passed = pass ? Number(pass[1]) : 0
    const failed = fail ? Number(fail[1]) : 0
    return { passed, failed, total: passed + failed }
  }
  return {}
}

/** Extrai a contagem de problemas do lint (eslint, ruff). */
export function parseLintCount(output: string): number | undefined {
  const out = output || ''
  // eslint: "✖ 8 problems (3 errors, 5 warnings)".
  let m = out.match(/(\d+)\s+problems?\s*\(/)
  if (m) return Number(m[1])
  // ruff: "Found 5 errors." / "Found 1 error".
  m = out.match(/Found\s+(\d+)\s+error/)
  if (m) return Number(m[1])
  if (/All checks passed|0 problems/i.test(out)) return 0
  return undefined
}

// ---------------------------------------------------------------------------
// Resumo falável
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Frase curta e falável do resultado (sem despejar a saída do runner). */
export function describeDevResult(input: {
  kind: 'test' | 'lint' | 'format'
  ok: boolean
  timedOut: boolean
  aborted: boolean
  counts?: TestCounts
  problems?: number
}): string {
  if (input.aborted) return 'Interrompido pelo senhor.'
  if (input.timedOut) return 'Demorou demais e foi interrompido por tempo limite.'

  if (input.kind === 'test') {
    const c = input.counts || {}
    if (c.failed && c.failed > 0) {
      return `${plural(c.failed, 'teste falhou', 'testes falharam')}` + (c.total ? ` de ${c.total}.` : '.')
    }
    if (typeof c.passed === 'number') {
      return input.ok
        ? `Todos os ${plural(c.total ?? c.passed, 'teste passou', 'testes passaram')}.`
        : `Os testes terminaram com erro.`
    }
    return input.ok ? 'Testes concluídos com sucesso.' : 'Os testes falharam.'
  }

  if (input.kind === 'lint') {
    if (typeof input.problems === 'number') {
      return input.problems === 0
        ? 'Lint sem problemas.'
        : `${plural(input.problems, 'problema encontrado', 'problemas encontrados')} no lint.`
    }
    return input.ok ? 'Lint sem problemas.' : 'O lint apontou problemas.'
  }

  // format
  return input.ok ? 'Formatação aplicada.' : 'A formatação falhou.'
}
