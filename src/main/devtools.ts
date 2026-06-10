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

/** Comando para CHECAR TIPOS do projeto (typecheck). */
export function detectTypecheckCommand(p: ProjectShape): DetectedCommand | null {
  const s = p.scripts || {}
  if (s.typecheck) return { command: pmRun(p.packageManager, 'typecheck'), runner: 'script' }
  if (s['check:types']) return { command: pmRun(p.packageManager, 'check:types'), runner: 'script' }
  if (s['type-check']) return { command: pmRun(p.packageManager, 'type-check'), runner: 'script' }
  if (has(p.files, 'tsconfig.json')) return { command: 'npx tsc --noEmit', runner: 'tsc' }
  if (has(p.files, 'mypy.ini', '.mypy.ini') && hasExt(p.files, '.py')) return { command: 'mypy .', runner: 'mypy' }
  if (has(p.files, 'go.mod')) return { command: 'go vet ./...', runner: 'go' }
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

/** Extrai a contagem de erros do typecheck (tsc, mypy). */
export function parseTypecheckCount(output: string): number | undefined {
  const out = output || ''
  // tsc: "Found 12 errors in 3 files." / "Found 1 error."
  let m = out.match(/Found\s+(\d+)\s+errors?/)
  if (m) return Number(m[1])
  // mypy: "Found 3 errors in 2 files (checked 10 source files)" coberto acima;
  // "Success: no issues found in 12 source files".
  if (/Success:\s*no issues found/i.test(out)) return 0
  return undefined
}

// ---------------------------------------------------------------------------
// Dependências: parsing do `npm outdated --json` e `npm audit --json`.
// ---------------------------------------------------------------------------

export interface OutdatedDep {
  name: string
  current: string
  wanted: string
  latest: string
}

/** Converte a saída JSON de `npm outdated --json` numa lista plana e ordenada. */
export function parseNpmOutdated(json: string): OutdatedDep[] {
  let data: unknown
  try {
    data = JSON.parse(json || '{}')
  } catch {
    return []
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const out: OutdatedDep[] = []
  for (const [name, raw] of Object.entries(data as Record<string, unknown>)) {
    const dep = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    out.push({
      name,
      current: String(dep.current ?? '?'),
      wanted: String(dep.wanted ?? '?'),
      latest: String(dep.latest ?? '?')
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export interface VulnCounts {
  critical: number
  high: number
  moderate: number
  low: number
  total: number
}

/** Extrai o total de vulnerabilidades de `npm audit --json` (metadata.vulnerabilities). */
export function parseNpmAudit(json: string): VulnCounts | null {
  let data: unknown
  try {
    data = JSON.parse(json || '{}')
  } catch {
    return null
  }
  const meta = (data as { metadata?: { vulnerabilities?: Record<string, unknown> } })?.metadata
  const v = meta?.vulnerabilities
  if (!v || typeof v !== 'object') return null
  const n = (key: string): number => {
    const value = Number((v as Record<string, unknown>)[key])
    return Number.isFinite(value) && value > 0 ? value : 0
  }
  const critical = n('critical')
  const high = n('high')
  const moderate = n('moderate')
  const low = n('low')
  const declaredTotal = n('total')
  return { critical, high, moderate, low, total: declaredTotal || critical + high + moderate + low }
}

// ---------------------------------------------------------------------------
// Pendências no código (TODO/FIXME/HACK/BUG/XXX em comentários).
// ---------------------------------------------------------------------------

export type TodoTag = 'TODO' | 'FIXME' | 'HACK' | 'BUG' | 'XXX'

// Exige um marcador de comentário antes da tag para não pegar texto comum
// ("todo o projeto") nem strings de prosa.
const TODO_LINE_RE = /(?:\/\/|\/\*|#|<!--|--|;|\*)\s*(TODO|FIXME|HACK|BUG|XXX)\b[:\s-]*(.*)/

/** Reconhece uma pendência numa linha de código; null se a linha não tiver. */
export function matchTodoLine(line: string): { tag: TodoTag; text: string } | null {
  const m = String(line || '').match(TODO_LINE_RE)
  if (!m) return null
  const text = m[2].replace(/\*\/\s*$|-->\s*$/, '').trim().slice(0, 160)
  return { tag: m[1] as TodoTag, text }
}

// ---------------------------------------------------------------------------
// Resumo falável
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Frase curta e falável do resultado (sem despejar a saída do runner). */
export function describeDevResult(input: {
  kind: 'test' | 'lint' | 'format' | 'typecheck'
  ok: boolean
  timedOut: boolean
  aborted: boolean
  counts?: TestCounts
  problems?: number
}): string {
  if (input.aborted) return 'Interrompido pelo senhor.'
  if (input.timedOut) return 'Demorou demais e foi interrompido por tempo limite.'

  if (input.kind === 'typecheck') {
    if (typeof input.problems === 'number') {
      return input.problems === 0
        ? 'Tipos verificados, sem erros.'
        : `${plural(input.problems, 'erro de tipo encontrado', 'erros de tipo encontrados')}.`
    }
    return input.ok ? 'Tipos verificados, sem erros.' : 'A checagem de tipos apontou erros.'
  }

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

/** Frase curta e falável do estado das dependências. */
export function describeDepsResult(input: {
  checked: boolean
  outdated: OutdatedDep[]
  vulns: VulnCounts | null
}): string {
  if (!input.checked) return 'Não consegui consultar o registro de pacotes agora.'
  const parts: string[] = []
  parts.push(
    input.outdated.length === 0
      ? 'Dependências em dia.'
      : `${plural(input.outdated.length, 'dependência desatualizada', 'dependências desatualizadas')}.`
  )
  if (input.vulns) {
    const grave = input.vulns.critical + input.vulns.high
    if (input.vulns.total === 0) parts.push('Sem vulnerabilidades conhecidas.')
    else if (grave > 0) parts.push(`${plural(input.vulns.total, 'vulnerabilidade', 'vulnerabilidades')}, ${grave} grave${grave === 1 ? '' : 's'}.`)
    else parts.push(`${plural(input.vulns.total, 'vulnerabilidade leve', 'vulnerabilidades leves')}.`)
  }
  return parts.join(' ')
}

/** Frase curta e falável das pendências encontradas no código. */
export function describeTodosResult(input: { total: number; byTag: Record<string, number> }): string {
  if (input.total === 0) return 'Nenhuma pendência marcada no código.'
  const fix = (input.byTag.FIXME || 0) + (input.byTag.BUG || 0)
  const base = `${plural(input.total, 'pendência marcada', 'pendências marcadas')} no código`
  return fix > 0 ? `${base}, ${fix} urgente${fix === 1 ? '' : 's'}.` : `${base}.`
}
