import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import type {
  AppConfig,
  CodeCommandResult,
  CodeDiagnosis,
  CodeDiagnosisCheck,
  CodeEditMode,
  CodeEditResult,
  CodeFileSnippet,
  CodePatchApplyResult,
  CodePatchPreview,
  CodeProjectIndex,
  CodeScaffoldResult,
  CodeSearchMatch,
  CodeDepsResult,
  CodeTerminalResult,
  CodeTodosResult,
  CodeWorkspaceSummary,
  CodeWriteResult,
  CommandClassification,
  DevToolResult,
  ProjectHealth
} from '../shared/types'
import { normalizeTemplate, slug, templateFiles } from './scaffold'
import { spawnAsync } from './exec'
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
} from './devtools'

export type CodeProgressFn = (event: { stream: 'stdout' | 'stderr'; chunk: string }) => void

const IGNORE_NAMES = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
  '.venv',
  '__pycache__'
])

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript React',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript React',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.css': 'CSS',
  '.html': 'HTML',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.c': 'C',
  '.h': 'C/C++',
  '.cpp': 'C++',
  '.cs': 'C#',
  '.php': 'PHP',
  '.rb': 'Ruby',
  '.sh': 'Shell',
  '.yml': 'YAML',
  '.yaml': 'YAML'
}

// Orcamento curto para pastas grandes: resultado parcial e voz responsiva.
const CODE_SCAN_TIMEOUT_MS = 2500

function codeConfig(cfg: AppConfig): AppConfig['integrations']['code'] {
  return cfg.integrations.code
}

/** Timeout de execução (ms), limitado entre 1s e 10min. */
function execTimeout(cfg: AppConfig): number {
  return Math.max(1000, Math.min(Number(codeConfig(cfg).commandTimeoutMs) || 120000, 10 * 60_000))
}

function ensureEnabled(cfg: AppConfig): void {
  if (!codeConfig(cfg).enabled) throw new Error('Ferramentas de programação desativadas nas Configurações.')
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Normaliza separadores de caminho vindos do LLM/usuário para o SO atual.
 * No Windows o `path` aceita "/" nativamente; no Linux uma barra invertida é
 * caractere VÁLIDO de nome de arquivo — "src\\main\\x.ts" viraria um arquivo
 * único esquisito. Convertendo "\\" -> "/" fora do Windows, o mesmo JSON do
 * modelo funciona idêntico nos dois sistemas. Pura e testável.
 */
export function normalizeCodePath(p: string): string {
  const raw = String(p || '').trim()
  if (!raw) return raw
  return process.platform === 'win32' ? raw : raw.replace(/\\+/g, '/')
}

function displayPath(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).join('/')
}

function relativeDisplayPath(root: string, target: string): string {
  return displayPath(relative(root, target))
}

function allowedRoots(cfg: AppConfig): string[] {
  return (codeConfig(cfg).allowedRoots || [])
    .map((r) => {
      const root = resolve(r)
      return existsSync(root) ? realpathSync(root) : root
    })
    .filter(Boolean)
}

function assertAllowed(cfg: AppConfig, target: string): void {
  const roots = allowedRoots(cfg)
  const physicalTarget = existsSync(target) ? realpathSync(target) : target
  if (!roots.length || roots.some((root) => isInside(root, physicalTarget))) return
  throw new Error(`Caminho fora das raízes permitidas para programação: ${physicalTarget}`)
}

export function resolveCodeWorkspace(cfg: AppConfig, requested = ''): string {
  ensureEnabled(cfg)
  const base = resolve(codeConfig(cfg).workspaceRoot || process.cwd())
  const raw = normalizeCodePath(requested)
  const target = raw ? (isAbsolute(raw) ? resolve(raw) : resolve(base, raw)) : base
  assertAllowed(cfg, target)
  if (existsSync(target) && statSync(target).isFile()) return dirname(target)
  return target
}

function resolveCodeFile(cfg: AppConfig, root: string, file: string): string {
  const clean = normalizeCodePath(file)
  const target = isAbsolute(clean) ? resolve(clean) : resolve(root, clean)
  assertAllowed(cfg, target)
  if (!isInside(root, target)) throw new Error(`Arquivo fora do workspace: ${file}`)
  return target
}

/**
 * Lê ±contextLines linhas em torno de `line` (1-based) num arquivo do projeto.
 * Prefixo "N: " em cada linha facilita o diagnóstico por número exato.
 * Usado pelo Prometeu para ver o código real no ponto do erro.
 */
export function readCodeContext(
  cfg: AppConfig,
  root: string,
  file: string,
  line: number,
  contextLines = 25
): string {
  const p = resolveCodeFile(cfg, root, file)
  const lines = readFileSync(p, 'utf-8').split(/\r?\n/)
  const start = Math.max(0, line - contextLines - 1)
  const end = Math.min(lines.length, line + contextLines)
  return lines
    .slice(start, end)
    .map((l, i) => `${start + i + 1}: ${l}`)
    .join('\n')
}

export function git(root: string, args: string[]): string | null {
  try {
    const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 1500 })
    if (res.status === 0) return String(res.stdout || '').trim()
  } catch {
    /* git é opcional */
  }
  return null
}

function timeoutSummary(command: string): string {
  return `Timeout ao executar "${command}". Operacao interrompida para manter o Ares responsivo.`
}

function packageInfo(root: string): Pick<CodeWorkspaceSummary, 'packageManager' | 'scripts'> {
  const pkgPath = join(root, 'package.json')
  let scripts: Record<string, string> | undefined
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg?.scripts && typeof pkg.scripts === 'object') scripts = pkg.scripts
    } catch {
      /* package inválido não impede análise estrutural */
    }
  }
  const packageManager = existsSync(join(root, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : existsSync(join(root, 'yarn.lock'))
      ? 'yarn'
      : existsSync(join(root, 'package-lock.json'))
        ? 'npm'
        : undefined
  return { packageManager, scripts }
}

function languageFor(file: string): string {
  return LANGUAGE_BY_EXT[extname(file).toLowerCase()] || 'Outros'
}

// Comandos que costumam demorar (instalar, compilar, empacotar, testar suites). Usado
// para o Ares avisar "iniciando a tarefa, senhor" ANTES de bloquear na execução, em vez
// de deixar o usuário no vácuo esperando.
const LONG_RUNNING_RE =
  /\b(install|ci|build|compile|bundle|rebuild|test|tsc|typecheck|webpack|rollup|electron-builder|docker\s+(build|compose)|make|cargo\s+(build|test|run)|go\s+(build|test)|gradlew?|mvn|pip\s+install|poetry\s+install|composer\s+install)\b/i

/** Heurística: o comando provavelmente é de longa duração (build/install/test)? */
export function isLongRunningCommand(command: string): boolean {
  const c = String(command || '').trim().toLowerCase()
  if (!c) return false
  // "npm i" / "yarn add" / "pnpm install" e afins
  if (/\b(npm|pnpm|yarn|bun)\b\s+(install|add|ci|i|update|up|dedupe)\b/.test(c)) return true
  return LONG_RUNNING_RE.test(c)
}

const SERVER_COMMAND_RE =
  /\b(dev|start|watch|server|nodemon|live-server|vite|http-server|http\.server|webpack-dev-server|browser-sync|serve|develop)\b/i

export function isServerCommand(command: string): boolean {
  const c = String(command || '').trim().toLowerCase()
  return SERVER_COMMAND_RE.test(c)
}

/**
 * Após editar/aplicar um patch, qual comando de validação oferecer proativamente.
 * Prioriza teste; na ausência, build/typecheck/lint. Retorna null se nada se aplicar.
 */
export function proactiveValidationCommand(
  scripts: Record<string, string> | undefined,
  packageManager = 'npm'
): string | null {
  if (!scripts) return null
  const pm = packageManager || 'npm'
  if (scripts.test) return `${pm} test`
  for (const name of ['build', 'typecheck', 'lint', 'verify'] as const) {
    if (scripts[name]) return `${pm} run ${name}`
  }
  return null
}

/** Saúde estrutural (rápida, SEM rodar comandos) a partir de sinais já coletados. */
export function structuralHealth(input: {
  dirty: boolean
  hasPackage: boolean
  hasTestScript: boolean
  hasLockfile: boolean
  timedOut: boolean
}): ProjectHealth {
  const signals: string[] = []
  if (input.dirty) signals.push('há alterações sem commit')
  if (input.hasPackage && !input.hasTestScript) signals.push('sem script de teste configurado')
  if (input.hasPackage && !input.hasLockfile) signals.push('sem lockfile — dependências podem variar')
  if (input.timedOut) signals.push('análise parcial: projeto grande')
  const label = signals.length ? `pontos de atenção: ${signals.join('; ')}` : 'estrutura em ordem'
  return { ok: signals.length === 0, label, signals }
}

/** Saúde após o diagnóstico real (typecheck/lint/test executados). Falável. */
export function assessDiagnosisHealth(checks: CodeDiagnosisCheck[]): ProjectHealth {
  const ran = checks.filter((c) => c.ran)
  const failed = ran.filter((c) => !c.ok)
  if (!ran.length) {
    return { ok: true, label: 'sem checagens automáticas disponíveis', signals: [] }
  }
  if (!failed.length) {
    return { ok: true, label: `tudo verde: ${ran.map((c) => c.name).join(', ')} passaram`, signals: [] }
  }
  const names = failed.map((c) => c.name)
  return {
    ok: false,
    label: `atenção: ${names.join(' e ')} ${names.length > 1 ? 'falharam' : 'falhou'} (${failed.length} de ${ran.length})`,
    signals: names
  }
}

function isLikelyText(path: string, maxBytes: number): boolean {
  try {
    const st = statSync(path)
    if (!st.isFile() || st.size > maxBytes) return false
    const sample = readFileSync(path).subarray(0, Math.min(st.size, 2048))
    return !sample.includes(0)
  } catch {
    return false
  }
}

function walkFiles(
  root: string,
  maxDepth: number,
  maxFiles: number,
  timeoutMs = CODE_SCAN_TIMEOUT_MS
): { files: string[]; ignored: string[]; languages: Record<string, number>; timedOut: boolean } {
  const files: string[] = []
  const ignored: string[] = []
  const languages: Record<string, number> = {}
  const deadline = Date.now() + Math.max(250, timeoutMs)
  let timedOut = false

  const walk = (dir: string, depth: number): void => {
    if (Date.now() > deadline) {
      timedOut = true
      return
    }
    if (files.length >= maxFiles || depth > maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries.sort()) {
      if (Date.now() > deadline) {
        timedOut = true
        return
      }
      if (files.length >= maxFiles) return
      const abs = join(dir, name)
      const rel = relativeDisplayPath(root, abs)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (IGNORE_NAMES.has(name)) {
          ignored.push(rel)
          continue
        }
        walk(abs, depth + 1)
      } else if (st.isFile()) {
        files.push(rel)
        const lang = languageFor(name)
        languages[lang] = (languages[lang] || 0) + 1
      }
    }
  }

  walk(root, 0)
  return { files, ignored, languages, timedOut }
}

interface GeospatialReport {
  isGIS: boolean
  shapefilesCount: number
  missingMandatory: string[]
  missingPrj: string[]
}

function checkGeospatialHealth(files: string[]): GeospatialReport {
  const gisExtensions = new Set([
    '.shp', '.shx', '.dbf', '.prj', '.mxd', '.qgs', '.qgz', '.gpkg',
    '.kml', '.kmz', '.geojson', '.tif', '.tiff', '.dxf', '.dwg'
  ])
  let isGIS = false
  const shapefilesMap = new Map<string, { shp?: boolean; shx?: boolean; dbf?: boolean; prj?: boolean }>()

  for (const f of files) {
    const ext = extname(f).toLowerCase()
    if (gisExtensions.has(ext)) {
      isGIS = true
    }
    if (['.shp', '.shx', '.dbf', '.prj'].includes(ext)) {
      const baseKey = f.slice(0, -ext.length)
      if (!shapefilesMap.has(baseKey)) {
        shapefilesMap.set(baseKey, {})
      }
      const item = shapefilesMap.get(baseKey)!
      if (ext === '.shp') item.shp = true
      else if (ext === '.shx') item.shx = true
      else if (ext === '.dbf') item.dbf = true
      else if (ext === '.prj') item.prj = true
    }
  }

  const missingMandatory: string[] = []
  const missingPrj: string[] = []
  let shapefilesCount = 0

  for (const [baseKey, parts] of shapefilesMap.entries()) {
    if (!parts.shp && !parts.shx && !parts.dbf && !parts.prj) continue
    shapefilesCount++
    const basenameOnly = basename(baseKey)
    const missingParts: string[] = []
    if (!parts.shp) missingParts.push('.shp')
    if (!parts.shx) missingParts.push('.shx')
    if (!parts.dbf) missingParts.push('.dbf')

    if (missingParts.length > 0) {
      missingMandatory.push(`shapefile '${basenameOnly}' incompleto (falta ${missingParts.join(', ')})`)
    } else if (!parts.prj) {
      missingPrj.push(`shapefile '${basenameOnly}' sem arquivo de projeção (.prj)`)
    }
  }

  return {
    isGIS: isGIS || shapefilesCount > 0,
    shapefilesCount,
    missingMandatory,
    missingPrj
  }
}

export function summarizeCodeWorkspace(cfg: AppConfig, requested = ''): CodeWorkspaceSummary {
  const root = resolveCodeWorkspace(cfg, requested)
  const name = basename(root)
  if (!existsSync(root)) {
    return { root, name, exists: false, languages: {}, files: [], ignored: [], hints: ['workspace não encontrado'] }
  }

  const { files, ignored, languages, timedOut } = walkFiles(root, 4, 180)
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = git(root, ['status', '--short'])
  const pkg = packageInfo(root)
  const hints: string[] = []

  const geo = checkGeospatialHealth(files)

  if (geo.isGIS) {
    hints.push('projeto SIG/Geospacial detectado')
    if (geo.shapefilesCount > 0) hints.push(`${geo.shapefilesCount} shapefile(s) detectado(s)`)
    if (files.some((f) => f.endsWith('.mxd'))) hints.push('projeto ArcGIS (.mxd) detectado')
    if (files.some((f) => f.endsWith('.qgs') || f.endsWith('.qgz'))) hints.push('projeto QGIS (.qgs/.qgz) detectado')
  } else {
    if (pkg.scripts?.test) hints.push(`teste disponível: ${pkg.packageManager || 'npm'} run test`)
    if (pkg.scripts?.verify) hints.push(`verificação completa: ${pkg.packageManager || 'npm'} run verify`)
    if (pkg.scripts?.build) hints.push(`build disponível: ${pkg.packageManager || 'npm'} run build`)
    if (files.some((f) => f.endsWith('tsconfig.json'))) hints.push('TypeScript detectado')
    if (files.some((f) => f.endsWith('electron.vite.config.ts'))) hints.push('Electron + Vite detectado')
  }
  if (timedOut) hints.push('analise parcial: limite de tempo atingido para manter a voz responsiva')

  let health: ProjectHealth
  if (geo.isGIS) {
    const signals: string[] = []
    if (status) signals.push('há alterações de dados sem commit')
    signals.push(...geo.missingMandatory)
    signals.push(...geo.missingPrj)
    if (timedOut) signals.push('análise parcial: projeto grande')

    const label = signals.length ? `pontos de atenção no projeto SIG: ${signals.join('; ')}` : 'repositório de dados SIG em ordem'
    health = { ok: geo.missingMandatory.length === 0, label, signals }
  } else {
    const hasPackage = files.some((f) => f === 'package.json')
    health = structuralHealth({
      dirty: !!status,
      hasPackage,
      hasTestScript: !!pkg.scripts?.test,
      hasLockfile: files.some((f) => /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(f)),
      timedOut
    })
  }

  return {
    root,
    name,
    exists: true,
    git: branch ? { branch, dirty: !!status, status: status ? status.split('\n').slice(0, 80) : [] } : undefined,
    ...pkg,
    languages,
    files,
    ignored: ignored.slice(0, 80),
    hints,
    health
  }
}

function matchesFilter(file: string, filter = ''): boolean {
  const f = filter.trim()
  if (!f) return true
  if (f.startsWith('*.')) return file.endsWith(f.slice(1))
  if (f.includes('*')) {
    const re = new RegExp('^' + f.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
    return re.test(file)
  }
  return file.includes(f)
}

export function searchCode(
  cfg: AppConfig,
  opts: { root?: string; query: string; filter?: string; maxResults?: number }
): { root: string; query: string; matches: CodeSearchMatch[]; truncated: boolean } {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const query = String(opts.query || '').trim()
  if (!query) throw new Error('Diga o texto que devo procurar no código.')
  const maxResults = Math.max(1, Math.min(Number(opts.maxResults) || codeConfig(cfg).maxSearchResults, 200))
  const internalLimit = maxResults + 1
  const maxBytes = Math.max(1, codeConfig(cfg).maxFileKB) * 1024
  const { files, timedOut } = walkFiles(root, 8, 2000)
  const matches: CodeSearchMatch[] = []
  const deadline = Date.now() + CODE_SCAN_TIMEOUT_MS

  for (const rel of files) {
    if (matches.length >= internalLimit || Date.now() > deadline) break
    if (!matchesFilter(rel, opts.filter || '')) continue
    const abs = resolveCodeFile(cfg, root, rel)
    if (!isLikelyText(abs, maxBytes)) continue
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(query.toLowerCase())) {
        matches.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 240) })
        if (matches.length >= internalLimit) break
      }
    }
  }

  return { root, query, matches: matches.slice(0, maxResults), truncated: timedOut || Date.now() > deadline || matches.length > maxResults }
}

export function readCodeFile(
  cfg: AppConfig,
  opts: { root?: string; file: string; startLine?: number; lines?: number }
): CodeFileSnippet {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const abs = resolveCodeFile(cfg, root, String(opts.file || ''))
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`Arquivo não encontrado: ${opts.file}`)
  const maxBytes = Math.max(1, codeConfig(cfg).maxFileKB) * 1024
  if (!isLikelyText(abs, maxBytes)) throw new Error(`Arquivo muito grande ou binário: ${opts.file}`)

  const all = readFileSync(abs, 'utf8').split(/\r?\n/)
  const totalLines = all.length
  const start = Math.max(1, Number(opts.startLine) || 1)
  const count = Math.max(1, Math.min(Number(opts.lines) || 120, 240))
  const end = Math.min(totalLines, start + count - 1)
  const content = all
    .slice(start - 1, end)
    .map((line, idx) => `${start + idx}: ${line}`)
    .join('\n')

  return {
    file: relativeDisplayPath(root, abs),
    startLine: start,
    endLine: end,
    totalLines,
    truncated: end < totalLines || start > 1,
    content
  }
}

// ---------------------------------------------------------------------------
// Skill `codigo.explicar`: análise de um trecho/arquivo para explicação ou
// documentação rápida. Junta num único resultado tudo que o modelo precisa
// para explicar com precisão: código com números de linha, mapa de símbolos,
// imports/exports e métricas simples. Só leitura — quem redige a explicação
// é o Ares na rodada seguinte.
// ---------------------------------------------------------------------------

/** Extrai os módulos importados de um arquivo (TS/JS/Python/Go básico). Pura. */
export function parseImports(content: string, ext: string): string[] {
  const out = new Set<string>()
  const lines = String(content || '').split(/\r?\n/)
  const e = String(ext || '').toLowerCase()
  for (const line of lines.slice(0, 400)) {
    if (e === '.py') {
      const m = line.match(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/)
      if (m) out.add(m[1] || m[2])
      continue
    }
    const m =
      line.match(/^\s*import\s+(?:[\w${},*\s]+\s+from\s+)?['"]([^'"]+)['"]/) ||
      line.match(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/)
    if (m) out.add(m[1])
  }
  return [...out].slice(0, 40)
}

export interface CodeExplainResult {
  root: string
  file: string
  language: string
  startLine: number
  endLine: number
  totalLines: number
  content: string
  outline: OutlineItem[]
  imports: string[]
  exports: string[]
  todoCount: number
  hints: string[]
}

export function explainCode(
  cfg: AppConfig,
  opts: { root?: string; file: string; startLine?: number; endLine?: number }
): CodeExplainResult {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const abs = resolveCodeFile(cfg, root, String(opts.file || ''))
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`Arquivo não encontrado: ${opts.file}`)
  const maxBytes = Math.max(1, codeConfig(cfg).maxFileKB) * 1024
  if (!isLikelyText(abs, maxBytes)) throw new Error(`Arquivo muito grande ou binário: ${opts.file}`)

  const all = readFileSync(abs, 'utf8')
  const lines = all.split(/\r?\n/)
  const totalLines = lines.length
  const start = Math.max(1, Math.min(Number(opts.startLine) || 1, totalLines))
  const requestedEnd = Number(opts.endLine) || 0
  const end = Math.min(totalLines, Math.max(start, requestedEnd || start + 159))
  const content = lines
    .slice(start - 1, end)
    .map((line, idx) => `${start + idx}: ${line}`)
    .join('\n')

  const ext = extname(abs)
  const outline = outlineSource(all, ext)
  const imports = parseImports(all, ext)
  const exports = exportedNames(all)
  const todoCount = lines.reduce((n, l) => (matchTodoLine(l) ? n + 1 : n), 0)

  const hints: string[] = []
  if (outline.length) hints.push(`${outline.length} símbolo(s) declarado(s)`)
  if (exports.length) hints.push(`exporta: ${exports.slice(0, 6).join(', ')}${exports.length > 6 ? '…' : ''}`)
  if (imports.length) hints.push(`depende de: ${imports.slice(0, 6).join(', ')}${imports.length > 6 ? '…' : ''}`)
  if (todoCount) hints.push(`${todoCount} pendência(s) TODO/FIXME no arquivo`)
  if (end < totalLines || start > 1) hints.push(`trecho parcial (${start}-${end} de ${totalLines} linhas)`)

  return {
    root,
    file: relativeDisplayPath(root, abs),
    language: languageFor(abs),
    startLine: start,
    endLine: end,
    totalLines,
    content,
    outline,
    imports,
    exports,
    todoCount,
    hints
  }
}

// ---------------------------------------------------------------------------
// Navegação estilo agente: listar (glob), esboço (outline), referências e
// substituição projeto-inteiro — ferramentas no espírito de Glob/Outline/Grep/
// MultiEdit dos agentes de código (Claude Code/openclaude), adaptadas ao
// protocolo falável do Ares: resultados compactos, contáveis e seguros.
// ---------------------------------------------------------------------------

/** Lista arquivos do projeto por padrão glob simples ("*.ts", "src/*"). */
export function listCodeFiles(
  cfg: AppConfig,
  opts: { root?: string; pattern?: string; maxResults?: number } = {}
): { root: string; pattern: string; files: string[]; total: number; truncated: boolean } {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const pattern = String(opts.pattern || '').trim()
  const maxResults = Math.max(1, Math.min(Number(opts.maxResults) || 80, 200))
  const { files, timedOut } = walkFiles(root, 8, 2000)
  const matched = pattern ? files.filter((f) => matchesFilter(f, pattern)) : files
  return {
    root,
    pattern,
    files: matched.slice(0, maxResults),
    total: matched.length,
    truncated: timedOut || matched.length > maxResults
  }
}

export interface OutlineItem {
  kind: string
  name: string
  line: number
}

type OutlinePattern = { re: RegExp; kind: string }

const OUTLINE_TS: OutlinePattern[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function' },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: 'type' },
  { re: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' },
  // const fn = (...) => / const fn = async x =>
  { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>/, kind: 'function' }
]
const OUTLINE_PY: OutlinePattern[] = [
  { re: /^\s*class\s+([A-Za-z_][\w]*)/, kind: 'class' },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/, kind: 'function' }
]
const OUTLINE_GO: OutlinePattern[] = [
  { re: /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)/, kind: 'function' },
  { re: /^type\s+([A-Za-z_][\w]*)/, kind: 'type' }
]

function outlinePatterns(ext: string): OutlinePattern[] {
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'].includes(ext)) return OUTLINE_TS
  if (ext === '.py') return OUTLINE_PY
  if (ext === '.go') return OUTLINE_GO
  return OUTLINE_TS // heurística razoável para C-likes
}

/** Esboço de um arquivo: funções/classes/tipos com a linha onde começam. Pura. */
export function outlineSource(content: string, ext: string): OutlineItem[] {
  const patterns = outlinePatterns(String(ext || '').toLowerCase())
  const items: OutlineItem[] = []
  const lines = String(content || '').split(/\r?\n/)
  for (let i = 0; i < lines.length && items.length < 120; i++) {
    for (const { re, kind } of patterns) {
      const m = lines[i].match(re)
      if (m) {
        items.push({ kind, name: m[1], line: i + 1 })
        break
      }
    }
  }
  return items
}

/** Skill `codigo.esboco`: o "mapa" de um arquivo, para ir direto ao trecho certo. */
export function outlineCodeFile(
  cfg: AppConfig,
  opts: { root?: string; file: string }
): { root: string; file: string; totalLines: number; items: OutlineItem[] } {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const abs = resolveCodeFile(cfg, root, String(opts.file || ''))
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`Arquivo não encontrado: ${opts.file}`)
  const maxBytes = Math.max(1, codeConfig(cfg).maxFileKB) * 1024
  if (!isLikelyText(abs, maxBytes)) throw new Error(`Arquivo muito grande ou binário: ${opts.file}`)
  const content = readFileSync(abs, 'utf8')
  return {
    root,
    file: relativeDisplayPath(root, abs),
    totalLines: content.split(/\r?\n/).length,
    items: outlineSource(content, extname(abs))
  }
}

/** Onde um símbolo é usado no projeto (contagem por arquivo) — base para refatorar. */
export function findCodeReferences(
  cfg: AppConfig,
  opts: { root?: string; symbol: string; maxResults?: number }
): {
  root: string
  symbol: string
  total: number
  files: Array<{ file: string; count: number; line: number; sample: string }>
  truncated: boolean
} {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const symbol = String(opts.symbol || '').trim()
  if (symbol.length < 2 || !/^[\w$.]+$/.test(symbol)) {
    throw new Error('Diga o nome do símbolo (função, classe, variável) a procurar.')
  }
  const maxResults = Math.max(1, Math.min(Number(opts.maxResults) || 40, 100))
  const maxBytes = Math.max(1, codeConfig(cfg).maxFileKB) * 1024
  const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
  const { files, timedOut } = walkFiles(root, 8, 2000)
  const out: Array<{ file: string; count: number; line: number; sample: string }> = []
  const deadline = Date.now() + CODE_SCAN_TIMEOUT_MS
  let total = 0
  let clipped = false

  for (const rel of files) {
    if (Date.now() > deadline) {
      clipped = true
      break
    }
    const abs = resolveCodeFile(cfg, root, rel)
    if (!isLikelyText(abs, maxBytes)) continue
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
    let count = 0
    let firstLine = 0
    let sample = ''
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        count++
        if (!firstLine) {
          firstLine = i + 1
          sample = lines[i].trim().slice(0, 200)
        }
      }
    }
    if (count > 0) {
      total += count
      if (out.length < maxResults) out.push({ file: rel, count, line: firstLine, sample })
      else clipped = true
    }
  }

  out.sort((a, b) => b.count - a.count)
  return { root, symbol, total, files: out, truncated: timedOut || clipped }
}

const REPLACE_MAX_FILES = 40

/**
 * Substituição literal em TODO o projeto (refatoração por voz). Sem `apply`,
 * devolve só a PRÉVIA (arquivos e contagens) para o usuário confirmar; com
 * `apply`, exige "Permitir aplicar patches" e respeita os mesmos bloqueios de
 * caminho sensível da edição. Limitada a ${REPLACE_MAX_FILES} arquivos por vez.
 */
export function replaceInProject(
  cfg: AppConfig,
  opts: { root?: string; find: string; replace: string; filter?: string; apply?: boolean }
): {
  root: string
  find: string
  replace: string
  applied: boolean
  totalMatches: number
  files: Array<{ file: string; count: number }>
  skipped: string[]
  truncated: boolean
} {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const find = String(opts.find ?? '')
  const replacement = String(opts.replace ?? '')
  if (find.length < 2) throw new Error('Diga o texto a substituir (ao menos 2 caracteres).')
  if (find === replacement) throw new Error('O texto novo é igual ao antigo — nada a fazer.')
  if (opts.apply) ensureCanWrite(cfg)

  const maxBytes = Math.max(1, codeConfig(cfg).maxFileKB) * 1024
  const { files, timedOut } = walkFiles(root, 8, 2000)
  const hits: Array<{ file: string; abs: string; count: number; next: string }> = []
  const skipped: string[] = []
  const deadline = Date.now() + CODE_SCAN_TIMEOUT_MS
  let clipped = false

  for (const rel of files) {
    if (Date.now() > deadline) {
      clipped = true
      break
    }
    if (!matchesFilter(rel, opts.filter || '')) continue
    const abs = resolveCodeFile(cfg, root, rel)
    if (!isLikelyText(abs, maxBytes)) continue
    const current = readFileSync(abs, 'utf8')
    const count = current.split(find).length - 1
    if (count === 0) continue
    try {
      assertSafeEditPath(rel)
    } catch {
      skipped.push(rel)
      continue
    }
    if (hits.length >= REPLACE_MAX_FILES) {
      clipped = true
      break
    }
    hits.push({ file: rel, abs, count, next: current.split(find).join(replacement) })
  }

  if (opts.apply && clipped) {
    throw new Error(
      `Substituição atinge mais de ${REPLACE_MAX_FILES} arquivos ou o projeto é muito grande. Restrinja com um filtro (ex.: "src/*.ts").`
    )
  }
  if (opts.apply) {
    for (const h of hits) writeFileSync(h.abs, h.next, 'utf8')
  }
  return {
    root,
    find,
    replace: replacement,
    applied: !!opts.apply && hits.length > 0,
    totalMatches: hits.reduce((n, h) => n + h.count, 0),
    files: hits.map((h) => ({ file: h.file, count: h.count })),
    skipped,
    truncated: timedOut || clipped
  }
}

type TextMatch = { start: number; end: number; strategy: string }

function lineOffsets(content: string): number[] {
  const offsets = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

function exactMatches(content: string, needle: string): TextMatch[] {
  const matches: TextMatch[] = []
  if (!needle) return matches
  let idx = content.indexOf(needle)
  while (idx !== -1) {
    matches.push({ start: idx, end: idx + needle.length, strategy: 'exact' })
    idx = content.indexOf(needle, idx + Math.max(1, needle.length))
  }
  return matches
}

function lineTrimmedMatches(content: string, needle: string): TextMatch[] {
  const oldLines = needle.replace(/\r\n/g, '\n').split('\n')
  if (!oldLines.length) return []
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const offsets = lineOffsets(content.replace(/\r\n/g, '\n'))
  const want = oldLines.map((l) => l.trimEnd())
  const matches: TextMatch[] = []
  for (let i = 0; i <= lines.length - oldLines.length; i++) {
    const got = lines.slice(i, i + oldLines.length).map((l) => l.trimEnd())
    if (got.length === want.length && got.every((line, idx) => line.trim() === want[idx].trim())) {
      const start = offsets[i]
      const endLine = i + oldLines.length - 1
      const end = offsets[endLine] + lines[endLine].length
      matches.push({ start, end, strategy: 'line_trimmed' })
    }
  }
  return matches
}

function whitespaceRegexMatches(content: string, needle: string): TextMatch[] {
  const compact = needle.trim()
  if (!compact || !/\s/.test(compact)) return []
  const pattern = compact
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  const re = new RegExp(pattern, 'g')
  const matches: TextMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    matches.push({ start: m.index, end: m.index + m[0].length, strategy: 'whitespace_normalized' })
    if (m[0].length === 0) re.lastIndex++
  }
  return matches
}

function findFlexibleMatches(content: string, needle: string): TextMatch[] {
  const exact = exactMatches(content, needle)
  if (exact.length) return exact
  const lineTrimmed = lineTrimmedMatches(content, needle)
  if (lineTrimmed.length) return lineTrimmed
  return whitespaceRegexMatches(content, needle)
}

function applyTextReplacements(content: string, matches: TextMatch[], replacement: string, mode: CodeEditMode): string {
  let next = content
  for (const m of [...matches].sort((a, b) => b.start - a.start)) {
    const insert =
      mode === 'insert_before'
        ? replacement + next.slice(m.start, m.end)
        : mode === 'insert_after'
          ? next.slice(m.start, m.end) + replacement
          : replacement
    next = next.slice(0, m.start) + insert + next.slice(m.end)
  }
  return next
}

function lineRangeEdit(content: string, startLine: number, endLine: number, replacement: string): { next: string; matchCount: number } {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const start = Math.max(1, Math.floor(startLine || 1))
  const end = Math.max(start, Math.floor(endLine || start))
  if (start > lines.length + 1) throw new Error(`Linha inicial fora do arquivo: ${start}`)
  const before = lines.slice(0, start - 1)
  const after = lines.slice(Math.min(end, lines.length))
  const repl = replacement.split(/\r?\n/)
  const next = [...before, ...repl, ...after].join('\n')
  return { next, matchCount: Math.max(1, Math.min(end, lines.length) - start + 1) }
}

function editPreview(content: string, file: string): string {
  const lines = content.split(/\r?\n/).slice(0, 8).join('\n')
  return `${file}\n${lines}`.slice(0, 900)
}

function normalizeEditMode(mode: unknown): CodeEditMode {
  return ['replace', 'insert_before', 'insert_after', 'line_range'].includes(String(mode))
    ? (String(mode) as CodeEditMode)
    : 'replace'
}

function assertSafeEditPath(file: string): void {
  const parts = displayPath(file).split('/')
  const name = parts[parts.length - 1]?.toLowerCase() || ''
  if (parts.includes('.git') || parts.includes('.ssh')) throw new Error('Edição bloqueada em diretório sensível.')
  if (['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519'].includes(name)) {
    throw new Error(`Edição bloqueada em arquivo sensível: ${file}`)
  }
}

export function editCodeFile(
  cfg: AppConfig,
  opts: {
    root?: string
    file: string
    mode?: CodeEditMode
    oldText?: string
    newText?: string
    anchor?: string
    startLine?: number
    endLine?: number
    replaceAll?: boolean
    expectedMatches?: number
  }
): CodeEditResult {
  ensureCanWrite(cfg)
  const root = resolveCodeWorkspace(cfg, opts.root)
  const file = String(opts.file || '').trim()
  if (!file) throw new Error('Diga o arquivo a editar.')
  assertSafeEditPath(file)
  const abs = resolveCodeFile(cfg, root, file)
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`Arquivo não encontrado: ${file}`)
  const maxBytes = Math.max(1, codeConfig(cfg).maxFileKB) * 1024
  if (!isLikelyText(abs, maxBytes)) throw new Error(`Arquivo muito grande ou binário: ${file}`)

  const current = readFileSync(abs, 'utf8')
  const mode = normalizeEditMode(opts.mode)
  const replacement = String(opts.newText ?? '')
  let next = current
  let matchCount = 0
  let strategy = 'none'

  if (mode === 'line_range') {
    const edited = lineRangeEdit(current, Number(opts.startLine || 1), Number(opts.endLine || opts.startLine || 1), replacement)
    next = edited.next
    matchCount = edited.matchCount
    strategy = 'line_range'
  } else {
    const needle = mode === 'replace' ? String(opts.oldText || '') : String(opts.anchor || opts.oldText || '')
    if (!needle) throw new Error(mode === 'replace' ? 'oldText é obrigatório para replace.' : 'anchor é obrigatório para inserção.')
    const matches = findFlexibleMatches(current, needle)
    if (!matches.length) throw new Error(`Trecho não encontrado em ${file}. Releia o arquivo e passe uma âncora mais específica.`)
    if (matches.length > 1 && !opts.replaceAll) {
      throw new Error(`Trecho encontrado ${matches.length} vezes em ${file}. Use replaceAll ou forneça mais contexto.`)
    }
    const used = opts.replaceAll ? matches : [matches[0]]
    next = applyTextReplacements(current, used, replacement, mode)
    matchCount = used.length
    strategy = used[0].strategy
  }

  if (typeof opts.expectedMatches === 'number' && opts.expectedMatches >= 0 && matchCount !== opts.expectedMatches) {
    throw new Error(`Edição recusada: esperado ${opts.expectedMatches} ocorrência(s), encontrado ${matchCount}.`)
  }
  const changed = next !== current
  if (changed) writeFileSync(abs, next, 'utf8')
  return {
    root,
    file: relativeDisplayPath(root, abs),
    mode,
    changed,
    strategy,
    matchCount,
    bytes: Buffer.byteLength(next, 'utf8'),
    preview: editPreview(next, relativeDisplayPath(root, abs))
  }
}

export function codePromptContext(cfg: AppConfig): string {
  const c = codeConfig(cfg)
  if (!c.enabled) return 'Ferramentas de programação locais: desativadas.'
  return [
    `Ferramentas de programação locais: ativadas com leitura, edição precisa, escrita, patches, terminal e coder autônomo nativos.`,
    `Workspace padrão: ${c.workspaceRoot}.`,
    `Raízes permitidas: ${(c.allowedRoots || []).join(', ') || '(sem restrição explícita)'}.`,
    `Limites: arquivo até ${c.maxFileKB} KB, ${c.maxSearchResults} resultados de busca, ${c.maxContextChars} caracteres de contexto interno.`
  ].join('\n')
}

function splitCommand(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | '' = ''
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      if (ch === quote) quote = ''
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function isCommandAllowed(cfg: AppConfig, command: string): boolean {
  const c = command.trim().replace(/\s+/g, ' ')
  if (!c || /[;&|<>`$]/.test(c)) return false
  return (codeConfig(cfg).allowedCommands || []).some((allowed) => {
    const a = allowed.trim().replace(/\s+/g, ' ')
    return c === a || c.startsWith(`${a} --`)
  })
}

export function runCodeCommand(
  cfg: AppConfig,
  opts: { root?: string; command: string; signal?: AbortSignal; onProgress?: CodeProgressFn }
): Promise<CodeCommandResult> {
  // Guardas SÍNCRONAS (lançam antes de retornar a Promise — os testes contam com isso).
  const root = resolveCodeWorkspace(cfg, opts.root)
  const command = String(opts.command || '').trim().replace(/\s+/g, ' ')
  if (!isCommandAllowed(cfg, command)) throw new Error(`Comando não permitido para programação: ${command}`)
  const parts = splitCommand(command)
  if (!parts.length) throw new Error('Comando vazio.')

  const started = Date.now()
  return spawnAsync(parts[0], parts.slice(1), {
    cwd: root,
    timeoutMs: execTimeout(cfg),
    signal: opts.signal,
    onChunk: (stream, chunk) => opts.onProgress?.({ stream, chunk })
  }).then((res) => ({
      root,
      command,
      ok: !res.timedOut && !res.aborted && res.code === 0,
      code: res.code,
      stdout: res.timedOut ? '' : res.stdout.slice(0, 12000),
      stderr: res.aborted
        ? 'Comando interrompido pelo usuário.'
        : res.timedOut
          ? timeoutSummary(command)
          : res.stderr.slice(0, 12000),
      durationMs: Date.now() - started
    }))
}

// ---------------------------------------------------------------------------
// Terminal completo com autorização.
// Três camadas: 'blocked' (catastrófico, nunca roda nem com autorização),
// 'allowed' (allowlist + prefixos seguros, roda direto) e 'confirm' (qualquer
// outro comando: exige autorização explícita do usuário). O Ares pede o "sim"
// em voz antes de rodar comandos da camada 'confirm'.
// ---------------------------------------------------------------------------

// Padrões catastróficos/irreversíveis ou de elevação de privilégio. Bloqueados
// sempre, mesmo que o usuário "autorize" — para isso o usuário deve usar um
// terminal de verdade, fora do Ares.
const BLOCKED_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /(^|[\s;&|])sudo(\s|$)/, why: 'elevação de privilégio (sudo) não é permitida' },
  { re: /(^|[\s;&|])su(\s|$)/, why: 'troca de usuário (su) não é permitida' },
  { re: /(^|[\s;&|])doas(\s|$)/, why: 'elevação de privilégio (doas) não é permitida' },
  { re: /rm\s+(-\S*\s+)*-\S*[rf]\S*\s+(-\S*\s+)*(\/|~|\$home|\.{1,2}|\*)(\s|\/|$|[)'"`;&|])/, why: 'remoção recursiva de raiz/HOME/diretório atual' },
  { re: /rm\s+-\S*[rf].*\s\/(\s|$|[)'"`;&|])/, why: 'remoção recursiva da raiz do sistema' },
  { re: /\bmkfs(\.\w+)?\b/, why: 'formatação de sistema de arquivos' },
  { re: /\bdd\b[^\n]*\bof=\/dev\//, why: 'escrita direta em dispositivo de bloco' },
  { re: /[>]\s*\/dev\/(sd|nvme|hd|mmcblk|disk)/, why: 'escrita direta em disco' },
  { re: /\b(shutdown|reboot|poweroff|halt)\b/, why: 'desligar/reiniciar a máquina' },
  { re: /\binit\s+[06]\b/, why: 'mudança de runlevel (desligar/reiniciar)' },
  { re: /:\s*\(\s*\)\s*\{.*\|\s*:.*&\s*\}/, why: 'fork bomb' },
  { re: /:\(\)\{/, why: 'fork bomb' },
  { re: /\bchmod\s+-\S*r\S*\s+0*777\s+\//, why: 'permissões recursivas 777 na raiz' },
  { re: /\bchown\s+-\S*r\S*\s+\S+\s+\/(\s|$)/, why: 'troca de dono recursiva na raiz' },
  { re: /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba|z|fi|da)?sh\b/, why: 'baixar e executar script remoto direto no shell' }
]

const DEFAULT_TERMINAL_SAFE = [
  'ls',
  'pwd',
  'cat',
  'head',
  'tail',
  'wc',
  'echo',
  'which',
  'where',
  'env',
  'dir',
  'type',
  'Get-ChildItem',
  'Get-Content',
  'date',
  'whoami',
  'uname',
  'grep',
  'rg',
  'find',
  'tree',
  'git status',
  'git diff',
  'git log',
  'git branch',
  'git show',
  'git remote',
  'git add',
  'git commit',
  'git checkout',
  'git restore',
  'git stash',
  'git merge',
  'git pull',
  'git fetch',
  'git init',
  'touch',
  'mkdir',
  'node --version',
  'npm --version',
  'npm ls',
  'npm install',
  'npm ci',
  'npm run',
  'pnpm install',
  'pnpm run',
  'yarn install',
  'yarn run',
  'bun install',
  'bun run',
  'npx',
  'tsc',
  'npx tsc',
  'vite',
  'node',
  'python',
  'python3',
  'make',
  'go run',
  'go build',
  'go test',
  'cargo run',
  'cargo build',
  'cargo test'
]

function normalizeCommand(command: string): string {
  return String(command || '').trim().replace(/\s+/g, ' ')
}

function matchesPrefix(command: string, prefix: string): boolean {
  const c = command.toLowerCase()
  const p = prefix.trim().toLowerCase()
  if (!p) return false
  return c === p || c.startsWith(`${p} `)
}

function terminalSafePrefixes(cfg: AppConfig): string[] {
  const list = codeConfig(cfg).terminalSafe
  return Array.isArray(list) && list.length ? list : DEFAULT_TERMINAL_SAFE
}

/**
 * Quebra um comando nos operadores de shell (`;`, `&&`, `||`, `|`, `&`, nova linha),
 * respeitando aspas. Cada trecho é um sub-comando independente, classificado por conta
 * própria — fecha o bypass de "prefixo seguro + comando perigoso encadeado"
 * (ex.: `git status && rm -rf algo`).
 */
export function splitShellSegments(command: string): string[] {
  const segs: string[] = []
  let cur = ''
  let quote: '"' | "'" | '' = ''
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      if (ch === quote) quote = ''
      cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '|' || ch === '&') {
      if (command[i + 1] === ch) i++ // consome || e &&
      segs.push(cur)
      cur = ''
      continue
    }
    if (ch === ';' || ch === '\n' || ch === '\r') {
      segs.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  segs.push(cur)
  return segs.map((s) => s.trim()).filter(Boolean)
}

// Substituição de comando / process substitution: canais que permitem ESCONDER um
// comando dentro de um trecho aparentemente seguro (ex.: `echo $(rm -rf algo)`,
// `cat \`id\``). Na presença deles, o comando nunca é 'allowed' — vai para 'confirm'
// para o usuário ver o texto literal e decidir.
const COMMAND_SUBSTITUTION_RE = /\$\(|`|<\(|>\(/

/**
 * Classifica um comando antes de executá-lo. Não roda nada — apenas decide a camada de
 * segurança. Defesa em profundidade: a denylist é checada no comando inteiro E em cada
 * trecho; o tier 'allowed' (auto-executável, sem confirmação) só vale quando TODOS os
 * trechos batem em prefixo seguro/allowlist E não há substituição de comando. Qualquer
 * outra coisa cai em 'confirm' (exige o "sim" do usuário). Testável isoladamente.
 */
export function classifyCommand(cfg: AppConfig, command: string): CommandClassification {
  const c = normalizeCommand(command)
  if (!c) return { tier: 'blocked', reason: 'comando vazio' }
  // Caracteres de controle (exceto whitespace normal) são recusados — evitam truques de
  // ofuscação com bytes nulos/escape.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(c)) {
    return { tier: 'blocked', reason: 'caracteres de controle não são permitidos' }
  }
  const lower = c.toLowerCase()
  for (const { re, why } of BLOCKED_PATTERNS) {
    if (re.test(lower)) return { tier: 'blocked', reason: why }
  }

  const segments = splitShellSegments(c)
  // A denylist também roda em cada trecho (defesa em profundidade contra padrões
  // ancorados no início do comando, como sudo/su).
  for (const seg of segments) {
    const sl = seg.toLowerCase()
    for (const { re, why } of BLOCKED_PATTERNS) {
      if (re.test(sl)) return { tier: 'blocked', reason: why }
    }
  }

  const allowlist = codeConfig(cfg).allowedCommands || []
  const safe = terminalSafePrefixes(cfg)
  const isAllowedSegment = (seg: string): boolean =>
    allowlist.some((a) => matchesPrefix(seg, a)) || safe.some((p) => matchesPrefix(seg, p))

  if (COMMAND_SUBSTITUTION_RE.test(c)) {
    return { tier: 'confirm', reason: 'substituição de comando ($(), crases): requer autorização do usuário' }
  }
  if (segments.length > 0 && segments.every(isAllowedSegment)) {
    return {
      tier: 'allowed',
      reason: segments.length > 1 ? 'todos os trechos são seguros/allowlist' : 'comando seguro (somente leitura/dev)'
    }
  }
  return { tier: 'confirm', reason: 'comando fora da allowlist ou com encadeamento perigoso: requer autorização do usuário' }
}

/**
 * Executa um comando no terminal do projeto via shell real, com pipes e operadores.
 * No Windows usa PowerShell; nos demais sistemas usa bash. Comandos 'confirm' só
 * rodam quando `approved` é true (ou `terminalAutoApprove` está ligado); 'blocked'
 * nunca roda.
 */
function platformShell(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    // -EncodedCommand (base64 UTF-16LE) elimina TODA a dança de escapes entre o
    // JSON do modelo -> linha de comando do Windows -> parser do PowerShell:
    // aspas aninhadas, cifrões e acentos chegam intactos. -NonInteractive evita
    // prompts que travariam o turno.
    const encoded = Buffer.from(command, 'utf16le').toString('base64')
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]
    }
  }
  // Linux/macOS: bash quando existir; sh é o fallback universal (containers/minimal).
  return { file: existsSync('/bin/bash') || existsSync('/usr/bin/bash') ? 'bash' : 'sh', args: ['-lc', command] }
}

export function runCodeTerminal(
  cfg: AppConfig,
  opts: { root?: string; command: string; approved?: boolean; sessionId?: string; signal?: AbortSignal; onProgress?: CodeProgressFn }
): Promise<CodeTerminalResult> {
  // Guardas SÍNCRONAS (lançam antes de retornar a Promise).
  if (codeConfig(cfg).terminalEnabled === false) throw new Error('Terminal desativado nas Configurações.')
  const root = resolveCodeWorkspace(cfg, opts.root)
  const command = normalizeCommand(opts.command)
  if (!command) throw new Error('Comando vazio.')

  const cls = classifyCommand(cfg, command)
  const empty = { root, command, tier: cls.tier, ran: false, ok: false, code: null, stdout: '', stderr: '', durationMs: 0, reason: cls.reason }

  if (cls.tier === 'blocked') throw new Error(`Comando bloqueado por segurança: ${cls.reason}`)

  const autoApprove = codeConfig(cfg).terminalAutoApprove === true
  if (cls.tier === 'confirm' && !opts.approved && !autoApprove) {
    return Promise.resolve({ ...empty, requiresApproval: true })
  }

  const started = Date.now()
  const shell = platformShell(command)
  const background = isServerCommand(command)
  return spawnAsync(shell.file, shell.args, {
    cwd: root,
    timeoutMs: execTimeout(cfg),
    signal: opts.signal,
    onChunk: (stream, chunk) => opts.onProgress?.({ stream, chunk }),
    background,
    sessionId: opts.sessionId
  }).then((res) => ({
    ...empty,
    requiresApproval: false,
    ran: true,
    ok: res.background ? true : (!res.timedOut && !res.aborted && res.code === 0),
    code: res.code,
    stdout: res.timedOut ? '' : res.stdout.slice(0, 16000),
    stderr: res.aborted
      ? 'Comando interrompido pelo usuário.'
      : res.timedOut
        ? timeoutSummary(command)
        : res.stderr.slice(0, 16000),
    durationMs: Date.now() - started
  }))
}

function gitResult(
  cfg: AppConfig,
  root: string,
  args: string[],
  signal?: AbortSignal,
  onProgress?: CodeProgressFn
): Promise<CodeCommandResult> {
  const command = `git ${args.join(' ')}`
  const started = Date.now()
  return spawnAsync('git', ['-C', root, ...args], {
    timeoutMs: execTimeout(cfg),
    signal,
    onChunk: (stream, chunk) => onProgress?.({ stream, chunk })
  }).then((res) => ({
    root,
    command,
    ok: !res.timedOut && !res.aborted && res.code === 0,
    code: res.code,
    stdout: res.timedOut ? '' : res.stdout.slice(0, 16000),
    stderr: res.aborted
      ? 'Comando interrompido pelo usuário.'
      : res.timedOut
        ? timeoutSummary(command)
        : res.stderr.slice(0, 16000),
    durationMs: Date.now() - started
  }))
}

export function runCodeGit(
  cfg: AppConfig,
  opts: { root?: string; operation: string; file?: string; signal?: AbortSignal; onProgress?: CodeProgressFn }
): Promise<CodeCommandResult> {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const op = String(opts.operation || '').trim()
  const file = opts.file ? relativeDisplayPath(root, resolveCodeFile(cfg, root, opts.file)) : ''
  if (file && (file.startsWith('..') || isAbsolute(file))) throw new Error(`Arquivo fora do workspace: ${opts.file}`)
  if (op === 'status') return gitResult(cfg, root, ['status', '--short'], opts.signal, opts.onProgress)
  if (op === 'diffStat') return gitResult(cfg, root, file ? ['diff', '--stat', '--', file] : ['diff', '--stat'], opts.signal, opts.onProgress)
  if (op === 'diff') return gitResult(cfg, root, file ? ['diff', '--', file] : ['diff'], opts.signal, opts.onProgress)
  if (op === 'log') return gitResult(cfg, root, ['log', '--oneline', '-10'], opts.signal, opts.onProgress)
  throw new Error(`Operação Git não permitida: ${op}`)
}

// ---------------------------------------------------------------------------
// Git avançado: diff ESTRUTURADO (arquivos + adições/remoções) e sugestão de
// commit semântico (Conventional Commits) deduzida do conjunto de mudanças.
// Continua só-leitura: commitar de fato passa pelo codigo.terminal com
// autorização do usuário.
// ---------------------------------------------------------------------------

export interface GitDiffFileStat {
  file: string
  additions: number
  deletions: number
}

/** Parseia a saída de `git diff --numstat` ("adds\tdels\tarquivo"). Pura e testável. */
export function parseGitNumstat(out: string): GitDiffFileStat[] {
  const files: GitDiffFileStat[] = []
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (!m) continue
    // Renames vêm como "{velho => novo}/x" ou "velho => novo": fica com o destino.
    let file = m[3].trim().replace(/^"|"$/g, '')
    file = file.replace(/\{[^}]*=>\s*([^}]*)\}/g, '$1').replace(/^.*\s=>\s/, '').replace(/\/{2,}/g, '/')
    if (!file) continue
    files.push({
      file: displayPath(file),
      additions: m[1] === '-' ? 0 : Number(m[1]),
      deletions: m[2] === '-' ? 0 : Number(m[2])
    })
  }
  return files
}

/** Escopo do commit: diretório dominante das mudanças (ex.: src/main -> "main"). Pura. */
function commitScope(names: string[]): string {
  const counts = new Map<string, number>()
  for (const n of names) {
    const parts = n.split('/')
    const seg = parts[0] === 'src' && parts.length > 2 ? parts[1] : parts.length > 1 ? parts[0] : ''
    if (seg) counts.set(seg, (counts.get(seg) || 0) + 1)
  }
  let best = ''
  let max = 0
  for (const [k, v] of counts) {
    if (v > max) {
      best = k
      max = v
    }
  }
  return max >= Math.ceil(names.length / 2) ? best : ''
}

/**
 * Sugere uma mensagem de commit semântico a partir do diff estruturado e do
 * `git status --short` (para detectar arquivos novos). Heurística determinística
 * — o Ares pode refiná-la na fala, mas isto dá um ponto de partida correto.
 * Pura e testável.
 */
export function suggestCommitMessage(files: GitDiffFileStat[], statusShort = ''): string {
  if (!files.length) return ''
  const names = files.map((f) => f.file)
  const all = (re: RegExp): boolean => names.every((n) => re.test(n))
  const newFiles = new Set(
    String(statusShort || '')
      .split(/\r?\n/)
      .filter((l) => /^\s*(\?\?|A)/.test(l))
      .map((l) => displayPath(l.replace(/^[^ ]+\s+/, '').trim().replace(/^"|"$/g, '')))
  )
  const hasNew = names.some((n) => newFiles.has(n))
  const onlyConfig = all(/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig.*\.json|\.eslintrc.*|vite\.config.*|electron\.vite\.config.*|\.github\/)/i)

  let type = 'refactor'
  if (all(/\.(md|rst|txt)$/i)) type = 'docs'
  else if (all(/(^|\/)(tests?|__tests__|spec)\//i) || all(/\.(test|spec)\.[jt]sx?$/i)) type = 'test'
  else if (onlyConfig) type = 'chore'
  else if (hasNew) type = 'feat'
  else if (files.reduce((n, f) => n + f.additions, 0) <= files.reduce((n, f) => n + f.deletions, 0) + 10) type = 'fix'

  const scope = commitScope(names)
  const shortNames = names.map((n) => basename(n))
  const what =
    names.length === 1
      ? `ajusta ${shortNames[0]}`
      : `atualiza ${names.length} arquivos (${shortNames.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''})`
  return `${type}${scope ? `(${scope})` : ''}: ${what}`
}

export interface GitStructuredDiff {
  root: string
  files: GitDiffFileStat[]
  totalAdditions: number
  totalDeletions: number
  staged: number
  suggestedCommit: string
  summary: string
}

/**
 * Diff estruturado do repositório: numstat (working tree + staged) somado por
 * arquivo, totais e sugestão de commit semântico. Falável via `summary`.
 */
export async function gitStructuredDiff(
  cfg: AppConfig,
  opts: { root?: string; file?: string; signal?: AbortSignal; onProgress?: CodeProgressFn } = {}
): Promise<GitStructuredDiff> {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const file = opts.file ? relativeDisplayPath(root, resolveCodeFile(cfg, root, opts.file)) : ''
  const pathArgs = file ? ['--', file] : []
  const [unstaged, staged, status] = await Promise.all([
    gitResult(cfg, root, ['diff', '--numstat', ...pathArgs], opts.signal, opts.onProgress),
    gitResult(cfg, root, ['diff', '--numstat', '--cached', ...pathArgs], opts.signal, opts.onProgress),
    gitResult(cfg, root, ['status', '--short'], opts.signal, opts.onProgress)
  ])
  if (!unstaged.ok && !staged.ok) {
    throw new Error(unstaged.stderr.trim() || 'Não consegui ler o diff do Git (o diretório é um repositório?).')
  }
  const merged = new Map<string, GitDiffFileStat>()
  for (const f of [...parseGitNumstat(unstaged.stdout), ...parseGitNumstat(staged.stdout)]) {
    const cur = merged.get(f.file)
    if (cur) {
      cur.additions += f.additions
      cur.deletions += f.deletions
    } else {
      merged.set(f.file, { ...f })
    }
  }
  const files = [...merged.values()].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
  const totalAdditions = files.reduce((n, f) => n + f.additions, 0)
  const totalDeletions = files.reduce((n, f) => n + f.deletions, 0)
  const stagedCount = parseGitNumstat(staged.stdout).length
  const suggestedCommit = suggestCommitMessage(files, status.stdout)
  const summary = files.length
    ? `${files.length} arquivo(s) alterado(s), +${totalAdditions} −${totalDeletions}${suggestedCommit ? `. Commit sugerido: ${suggestedCommit}` : ''}`
    : 'Sem alterações no diff.'
  return { root, files: files.slice(0, 80), totalAdditions, totalDeletions, staged: stagedCount, suggestedCommit, summary }
}

function indexPath(root: string): string {
  // Windows guarda em %APPDATA%\ares (mesma base do userData); Unix em ~/.config/ares.
  const base =
    process.platform === 'win32'
      ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'ares')
      : join(homedir(), '.config', 'ares')
  const dir = join(base, 'code-indexes')
  mkdirSync(dir, { recursive: true })
  const key = createHash('sha1').update(root).digest('hex')
  return join(dir, `${key}.json`)
}

function exportedNames(content: string): string[] {
  const names = new Set<string>()
  const re = /\bexport\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) names.add(m[1])
  return [...names].slice(0, 40)
}

export function buildCodeIndex(cfg: AppConfig, opts: { root?: string; refresh?: boolean } = {}): CodeProjectIndex {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const store = indexPath(root)
  if (!opts.refresh && existsSync(store)) {
    try {
      return JSON.parse(readFileSync(store, 'utf8')) as CodeProjectIndex
    } catch {
      /* índice corrompido: reconstrói */
    }
  }

  const maxFiles = Math.max(20, Math.min(Number(codeConfig(cfg).indexMaxFiles) || 600, 5000))
  const maxBytes = Math.max(1, codeConfig(cfg).maxFileKB) * 1024
  const { files } = walkFiles(root, 10, maxFiles)
  const pkg = packageInfo(root)
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = git(root, ['status', '--short'])
  const indexed: CodeProjectIndex['files'] = []

  for (const file of files) {
    const abs = resolveCodeFile(cfg, root, file)
    if (!isLikelyText(abs, maxBytes)) continue
    const st = statSync(abs)
    const content = readFileSync(abs, 'utf8')
    indexed.push({
      file,
      language: languageFor(file),
      bytes: st.size,
      lines: content.split(/\r?\n/).length,
      exports: exportedNames(content)
    })
  }

  const index: CodeProjectIndex = {
    root,
    generatedAt: Date.now(),
    fileCount: indexed.length,
    files: indexed,
    scripts: pkg.scripts,
    git: branch ? { branch, dirty: !!status, status: status ? status.split('\n').slice(0, 80) : [] } : undefined
  }
  writeFileSync(store, JSON.stringify(index, null, 2), 'utf8')
  return index
}

type PatchInput = { diff?: unknown; patches?: unknown }

function patchDiff(input: PatchInput): string {
  const direct = typeof input.diff === 'string' ? input.diff : ''
  if (direct.trim()) return direct
  if (!Array.isArray(input.patches)) return ''
  return input.patches
    .map((p) => (p && typeof p === 'object' && typeof (p as Record<string, unknown>).diff === 'string' ? (p as Record<string, string>).diff : ''))
    .filter((x) => x.trim())
    .join('\n')
}

function textPatches(input: PatchInput): Array<{ file: string; find?: string; replace?: string; content?: string; all?: boolean }> {
  if (!Array.isArray(input.patches)) return []
  return input.patches
    .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : null))
    .filter((p): p is Record<string, unknown> => !!p && typeof p.file === 'string')
    .map((p) => ({
      file: String(p.file),
      find: typeof p.find === 'string' ? p.find : undefined,
      replace: typeof p.replace === 'string' ? p.replace : undefined,
      content: typeof p.content === 'string' ? p.content : undefined,
      all: p.all === true
    }))
}

function diffFiles(diff: string): string[] {
  const files = new Set<string>()
  for (const line of diff.split(/\r?\n/)) {
    const m =
      line.match(/^diff --git a\/(.+?) b\/(.+)$/) ||
      line.match(/^\+\+\+ b\/(.+)$/) ||
      line.match(/^--- a\/(.+)$/)
    if (!m) continue
    const file = (m[2] || m[1] || '').trim()
    if (file && file !== '/dev/null') files.add(file)
  }
  return [...files]
}

function validatePatchFiles(cfg: AppConfig, root: string, files: string[]): string[] {
  const warnings: string[] = []
  for (const file of files) {
    if (isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
      warnings.push(`path recusado: ${file}`)
      continue
    }
    try {
      resolveCodeFile(cfg, root, file)
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e))
    }
  }
  return warnings
}

export function previewCodePatch(cfg: AppConfig, opts: { root?: string; diff?: unknown; patches?: unknown }): CodePatchPreview {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const diff = patchDiff(opts)
  const textOps = textPatches(opts)
  const files = diff ? diffFiles(diff) : textOps.map((p) => p.file)
  const warnings = validatePatchFiles(cfg, root, files)
  const additions = diff
    ? diff.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
    : textOps.reduce((n, p) => n + (p.content ? p.content.split(/\r?\n/).length : String(p.replace || '').split(/\r?\n/).length), 0)
  const deletions = diff
    ? diff.split(/\r?\n/).filter((line) => line.startsWith('-') && !line.startsWith('---')).length
    : textOps.reduce((n, p) => n + (p.content ? 0 : String(p.find || '').split(/\r?\n/).length), 0)

  let canApply = warnings.length === 0 && files.length > 0
  if (diff && canApply) {
    const check = spawnSync('git', ['-C', root, 'apply', '--check', '--whitespace=nowarn', '-'], {
      input: diff,
      encoding: 'utf8',
      timeout: 10000
    })
    if (check.status !== 0) {
      canApply = false
      warnings.push(String(check.stderr || check.stdout || 'git apply --check falhou').trim())
    }
  }
  if (!diff && textOps.length) {
    for (const op of textOps) {
      const abs = resolveCodeFile(cfg, root, op.file)
      if (!existsSync(abs)) {
        // Patch com "content" cria o arquivo novo; só find/replace exige existir.
        if (op.content !== undefined) continue
        canApply = false
        warnings.push(`arquivo não encontrado: ${op.file}`)
        continue
      }
      const current = readFileSync(abs, 'utf8')
      if (op.find !== undefined && !current.includes(op.find)) {
        canApply = false
        warnings.push(`trecho não encontrado em ${op.file}`)
      }
    }
  }
  return { root, files, additions, deletions, canApply, warnings }
}

// ---------------------------------------------------------------------------
// Validação de sintaxe pós-patch (estilo AST barato, sem dependências):
// JSON.parse para .json e um scanner de delimitadores balanceados — ciente de
// strings, template literals, comentários e regex literais — para C-likes.
// Não substitui o typecheck, mas pega o estrago típico de patch mal aplicado
// (chave/parêntese a menos) e permite REVERTER automaticamente antes de
// quebrar o build.
// ---------------------------------------------------------------------------

const SYNTAX_CHECK_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'])

// Palavras-chave após as quais "/" inicia um REGEX (e não uma divisão).
const REGEX_PREFIX_WORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'yield', 'await', 'throw'
])

/** Valida a sintaxe "estrutural" de um arquivo. Pura e testável. */
export function validateSourceSyntax(content: string, ext: string): { ok: boolean; error?: string } {
  const e = String(ext || '').toLowerCase()
  if (e === '.json') {
    try {
      JSON.parse(content)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `JSON inválido: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  if (!SYNTAX_CHECK_EXTS.has(e)) return { ok: true }

  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const stack: Array<{ ch: string; line: number }> = []
  const n = content.length
  let i = 0
  let line = 1
  let lastSig = '' // último caractere significativo (decide regex vs divisão)
  let lastWord = '' // última palavra (keywords que antecedem regex)

  const regexCanStart = (): boolean => {
    if (REGEX_PREFIX_WORDS.has(lastWord)) return true
    if (!lastSig) return true
    return !/[A-Za-z0-9_$)\]}]/.test(lastSig)
  }

  while (i < n) {
    const ch = content[i]
    if (ch === '\n') {
      line++
      i++
      continue
    }
    if (ch === '/' && content[i + 1] === '/') {
      while (i < n && content[i] !== '\n') i++
      continue
    }
    if (ch === '/' && content[i + 1] === '*') {
      i += 2
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) {
        if (content[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }
    if (ch === '"' || ch === "'") {
      i++
      while (i < n && content[i] !== ch) {
        if (content[i] === '\\') i++
        else if (content[i] === '\n') break // string não fechada na linha: tolera (CSS/erro pré-existente)
        i++
      }
      i++
      lastSig = ch
      lastWord = ''
      continue
    }
    if (ch === '`') {
      i++
      while (i < n) {
        if (content[i] === '\\') {
          i += 2
          continue
        }
        if (content[i] === '\n') {
          line++
          i++
          continue
        }
        if (content[i] === '`') break
        if (content[i] === '$' && content[i + 1] === '{') {
          // Expressão embutida: consome contando chaves e pulando strings internas.
          i += 2
          let depth = 1
          while (i < n && depth > 0) {
            const c = content[i]
            if (c === '\\') i++
            else if (c === '\n') line++
            else if (c === '"' || c === "'") {
              const q = c
              i++
              while (i < n && content[i] !== q) {
                if (content[i] === '\\') i++
                i++
              }
            } else if (c === '{') depth++
            else if (c === '}') depth--
            i++
          }
          continue
        }
        i++
      }
      i++
      lastSig = '`'
      lastWord = ''
      continue
    }
    if (ch === '/' && e !== '.css' && regexCanStart()) {
      // Regex literal: pula até a barra final (respeitando classes [...] e escapes).
      const startLine = line
      let j = i + 1
      let inClass = false
      let closed = false
      while (j < n) {
        const c = content[j]
        if (c === '\\') {
          j += 2
          continue
        }
        if (c === '\n') break // regex não atravessa linha: trata como divisão mesmo
        if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) {
          closed = true
          break
        }
        j++
      }
      if (closed) {
        i = j + 1
        lastSig = '/'
        lastWord = ''
        line = startLine
        continue
      }
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push({ ch, line })
      lastSig = ch
      lastWord = ''
      i++
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack.pop()
      if (!top || top.ch !== pairs[ch]) {
        return { ok: false, error: `delimitador desbalanceado: "${ch}" inesperado na linha ${line}` }
      }
      lastSig = ch
      lastWord = ''
      i++
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$]/.test(content[j])) j++
      lastWord = content.slice(i, j)
      lastSig = content[j - 1]
      i = j
      continue
    }
    if (!/\s/.test(ch)) {
      lastSig = ch
      lastWord = ''
    }
    i++
  }
  if (stack.length) {
    const top = stack[stack.length - 1]
    return { ok: false, error: `"${top.ch}" aberto na linha ${top.line} sem fechamento` }
  }
  return { ok: true }
}

/**
 * Compara a sintaxe antes/depois dos arquivos tocados pelo patch. Só acusa o
 * arquivo que estava VÁLIDO antes e ficou inválido depois — arquivos que já
 * vinham quebrados (ou que o scanner não entende) não geram falso rollback.
 */
function syntaxRegressions(
  cfg: AppConfig,
  root: string,
  files: string[],
  before: Map<string, string | null>
): string[] {
  const broken: string[] = []
  for (const file of files) {
    const ext = extname(file).toLowerCase()
    if (!SYNTAX_CHECK_EXTS.has(ext)) continue
    let abs: string
    try {
      abs = resolveCodeFile(cfg, root, file)
    } catch {
      continue
    }
    if (!existsSync(abs)) continue
    const prev = before.get(file)
    const prevOk = prev == null ? true : validateSourceSyntax(prev, ext).ok
    if (!prevOk) continue
    const after = validateSourceSyntax(readFileSync(abs, 'utf8'), ext)
    if (!after.ok) broken.push(`${file}: ${after.error}`)
  }
  return broken
}

export function applyCodePatch(cfg: AppConfig, opts: { root?: string; diff?: unknown; patches?: unknown }): CodePatchApplyResult {
  if (!codeConfig(cfg).allowPatchApply) throw new Error('Aplicação de patches desativada nas Configurações.')
  const preview = previewCodePatch(cfg, opts)
  if (!preview.canApply) return { ...preview, applied: false, output: preview.warnings.join('\n') }
  const diff = patchDiff(opts)

  // Snapshot dos arquivos afetados ANTES de tocar no disco: é a base do rollback
  // automático quando o patch quebra a sintaxe de um arquivo que estava válido.
  const snapshots = new Map<string, string | null>()
  for (const file of preview.files) {
    try {
      const abs = resolveCodeFile(cfg, preview.root, file)
      snapshots.set(file, existsSync(abs) ? readFileSync(abs, 'utf8') : null)
    } catch {
      /* arquivo fora do workspace já foi barrado no preview */
    }
  }
  const rollback = (): void => {
    for (const [file, prev] of snapshots) {
      try {
        const abs = resolveCodeFile(cfg, preview.root, file)
        if (prev === null) {
          if (existsSync(abs)) unlinkSync(abs)
        } else {
          writeFileSync(abs, prev, 'utf8')
        }
      } catch {
        /* melhor esforço: segue revertendo os demais */
      }
    }
  }

  let applied = false
  let output = ''
  if (diff) {
    const res = spawnSync('git', ['-C', preview.root, 'apply', '--whitespace=nowarn', '-'], {
      input: diff,
      encoding: 'utf8',
      timeout: 10000
    })
    applied = res.status === 0
    output = String(res.stderr || res.stdout || (applied ? 'patch aplicado' : 'falha ao aplicar patch')).trim()
  } else {
    for (const op of textPatches(opts)) {
      const abs = resolveCodeFile(cfg, preview.root, op.file)
      const current = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
      const next =
        op.content !== undefined
          ? op.content
          : op.all
            ? current.split(op.find || '').join(op.replace || '')
            : current.replace(op.find || '', op.replace || '')
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, next, 'utf8')
    }
    applied = true
    output = 'patch textual aplicado'
  }

  if (applied) {
    const broken = syntaxRegressions(cfg, preview.root, preview.files, snapshots)
    if (broken.length) {
      rollback()
      return {
        ...preview,
        applied: false,
        reverted: true,
        warnings: [...preview.warnings, ...broken],
        output: `patch REVERTIDO automaticamente: a sintaxe quebrou em ${broken.join('; ')}`
      }
    }
  }
  return { ...preview, applied, output }
}

// ---------------------------------------------------------------------------
// Criar/scaffold/diagnóstico — o Ares CONSTRÓI projetos, não só lê.
// Escritas no disco são protegidas por `allowPatchApply` e por `allowedRoots`.
// ---------------------------------------------------------------------------

function ensureCanWrite(cfg: AppConfig): void {
  ensureEnabled(cfg)
  if (!codeConfig(cfg).allowPatchApply) {
    throw new Error('Criação/escrita de arquivos desativada. Ligue "Permitir aplicar patches" nas Configurações.')
  }
}

function dirIsEmpty(dir: string): boolean {
  try {
    return readdirSync(dir).filter((n) => n !== '.git').length === 0
  } catch {
    return true
  }
}

/** Cria um projeto a partir de um template, dentro das raízes permitidas. */
export function scaffoldProject(
  cfg: AppConfig,
  opts: { tipo?: string; nome: string; path?: string; force?: boolean }
): CodeScaffoldResult {
  ensureCanWrite(cfg)
  const base = resolveCodeWorkspace(cfg, opts.path)
  const folder = slug(opts.nome)
  const root = join(base, folder)
  assertAllowed(cfg, root)
  if (existsSync(root) && !dirIsEmpty(root) && !opts.force) {
    throw new Error(`A pasta "${folder}" já existe e não está vazia. Escolha outro nome ou use force.`)
  }
  mkdirSync(root, { recursive: true })

  const template = normalizeTemplate(opts.tipo || 'site')
  const files = templateFiles(template, opts.nome)
  const created: string[] = []
  const skipped: string[] = []
  for (const [file, content] of Object.entries(files)) {
    const abs = resolveCodeFile(cfg, root, file)
    if (existsSync(abs) && !opts.force) {
      skipped.push(file)
      continue
    }
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
    created.push(file)
  }

  const hints =
    template === 'node'
      ? [`cd ${folder}`, 'rode: node index.js', 'teste: npm test']
      : [`abra ${folder}/index.html no navegador`, `ou: cd ${folder} && python3 -m http.server 8000`]
  return { root, template, created, skipped, hints }
}

/** Escreve (cria/sobrescreve) um arquivo no workspace, dentro das raízes permitidas. */
export function writeCodeFile(
  cfg: AppConfig,
  opts: { root?: string; file: string; content: string; overwrite?: boolean }
): CodeWriteResult {
  ensureCanWrite(cfg)
  const root = resolveCodeWorkspace(cfg, opts.root)
  const file = String(opts.file || '').trim()
  if (!file) throw new Error('Diga o caminho do arquivo a criar.')
  const abs = resolveCodeFile(cfg, root, file)
  const existed = existsSync(abs)
  if (existed && !opts.overwrite) {
    throw new Error(`O arquivo "${file}" já existe. Use overwrite para substituir.`)
  }
  mkdirSync(dirname(abs), { recursive: true })
  const content = String(opts.content ?? '')
  writeFileSync(abs, content, 'utf8')
  return { file: relativeDisplayPath(root, abs), bytes: Buffer.byteLength(content, 'utf8'), created: !existed, overwritten: existed }
}

const DIAGNOSE_SCRIPTS = ['typecheck', 'lint', 'test'] as const

/** Decide quais checagens rodar a partir dos scripts do projeto e da allowlist. Pura. */
export function planDiagnosis(
  scripts: Record<string, string> | undefined,
  packageManager: string,
  allowedCommands: string[]
): Array<{ name: string; command: string; allowed: boolean }> {
  const pm = packageManager || 'npm'
  const allowed = (allowedCommands || []).map((a) => a.trim().replace(/\s+/g, ' '))
  const isAllowed = (cmd: string): boolean => allowed.some((a) => cmd === a || cmd.startsWith(`${a} `) || cmd.startsWith(`${a} --`))
  const plan: Array<{ name: string; command: string; allowed: boolean }> = []
  for (const name of DIAGNOSE_SCRIPTS) {
    if (!scripts || !scripts[name]) continue
    const command = name === 'test' ? `${pm} test` : `${pm} run ${name}`
    plan.push({ name, command, allowed: isAllowed(command) })
  }
  return plan
}

/** Diagnostica a saúde do projeto: roda as checagens disponíveis e permitidas. */
export async function diagnoseProject(
  cfg: AppConfig,
  opts: { root?: string; signal?: AbortSignal; onProgress?: CodeProgressFn } = {}
): Promise<CodeDiagnosis> {
  const summary = summarizeCodeWorkspace(cfg, opts.root)
  const root = summary.root
  const name = summary.name
  const plan = planDiagnosis(summary.scripts, summary.packageManager || 'npm', codeConfig(cfg).allowedCommands || [])
  const checks: CodeDiagnosisCheck[] = []
  const hints: string[] = []

  for (const step of plan) {
    if (!step.allowed) {
      checks.push({ name: step.name, command: step.command, ran: false, ok: false, code: null, summary: 'não permitido na allowlist' })
      hints.push(`adicione "${step.command}" à allowlist para checar ${step.name}`)
      continue
    }
    const res = await runCodeCommand(cfg, { root, command: step.command, signal: opts.signal, onProgress: opts.onProgress })
    const tail = (res.ok ? res.stdout : res.stderr || res.stdout).split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
    checks.push({ name: step.name, command: step.command, ran: true, ok: res.ok, code: res.code, summary: tail.slice(0, 240) })
  }

  if (!summary.scripts) hints.push('sem package.json: nada para testar automaticamente')
  if (summary.git?.dirty) hints.push('há alterações sem commit')

  const ran = checks.filter((c) => c.ran)
  const ok = ran.length > 0 ? ran.every((c) => c.ok) : true
  return { root, name, ok, checks, hints, health: assessDiagnosisHealth(checks) }
}

// ---------------------------------------------------------------------------
// Skills de qualidade: testar / lintar / formatar.
// Detecção pura em devtools.ts; aqui é só resolver o workspace, rodar o runner
// detectado (comando FIXO/curado, sem shell) e devolver um resultado falável.
// ---------------------------------------------------------------------------

const TAIL_LINES = 8

function tailOf(text: string): string {
  return text.split(/\r?\n/).filter(Boolean).slice(-TAIL_LINES).join('\n').slice(0, 1200)
}

/** Núcleo comum das três skills: detecta o comando, roda e monta o DevToolResult. */
async function runDevTool(
  cfg: AppConfig,
  kind: DevToolResult['kind'],
  detect: (p: { scripts?: Record<string, string>; packageManager?: string; files: string[] }) => { command: string; runner: string } | null,
  noneHint: string,
  opts: { root?: string; signal?: AbortSignal; onProgress?: CodeProgressFn }
): Promise<DevToolResult> {
  const summary = summarizeCodeWorkspace(cfg, opts.root)
  const root = summary.root
  const base: DevToolResult = {
    root,
    kind,
    command: '',
    detected: false,
    ran: false,
    ok: false,
    code: null,
    summary: noneHint,
    stdoutTail: '',
    hint: noneHint
  }
  if (!summary.exists) return { ...base, summary: 'workspace não encontrado', hint: 'workspace não encontrado' }

  const detected = detect({ scripts: summary.scripts, packageManager: summary.packageManager, files: summary.files })
  if (!detected) return base

  const parts = splitCommand(detected.command)
  if (!parts.length) return { ...base, command: detected.command }

  const res = await spawnAsync(parts[0], parts.slice(1), {
    cwd: root,
    timeoutMs: execTimeout(cfg),
    signal: opts.signal,
    onChunk: (stream, chunk) => opts.onProgress?.({ stream, chunk })
  })
  const ok = !res.timedOut && !res.aborted && res.code === 0
  const combined = `${res.stdout}\n${res.stderr}`

  const out: DevToolResult = {
    root,
    kind,
    command: detected.command,
    detected: true,
    ran: !res.timedOut,
    ok,
    code: res.code,
    summary: '',
    stdoutTail: tailOf(res.stdout || res.stderr)
  }

  if (kind === 'test') {
    const counts = parseTestCounts(combined)
    out.passed = counts.passed
    out.failed = counts.failed
    out.total = counts.total
    out.summary = describeDevResult({ kind, ok, timedOut: res.timedOut, aborted: res.aborted, counts })
  } else if (kind === 'lint') {
    const problems = parseLintCount(combined)
    out.problems = problems
    // eslint/ruff saem com código !=0 quando há problemas — considere "rodou ok" se contamos os problemas.
    if (typeof problems === 'number') out.ok = problems === 0 && (res.code === 0 || res.code === 1)
    out.summary = describeDevResult({ kind, ok: out.ok, timedOut: res.timedOut, aborted: res.aborted, problems })
  } else if (kind === 'typecheck') {
    const problems = parseTypecheckCount(combined)
    out.problems = problems
    // tsc/mypy saem com código !=0 quando há erros — "rodou ok" se contamos zero erros.
    if (typeof problems === 'number') out.ok = problems === 0 && (res.code === 0 || res.code === 1 || res.code === 2)
    out.summary = describeDevResult({ kind, ok: out.ok, timedOut: res.timedOut, aborted: res.aborted, problems })
  } else {
    out.summary = describeDevResult({ kind, ok, timedOut: res.timedOut, aborted: res.aborted })
  }
  return out
}

/** Skill `codigo.testar`: roda os testes do projeto e resume passou/falhou. */
export function runTests(cfg: AppConfig, opts: { root?: string; signal?: AbortSignal; onProgress?: CodeProgressFn } = {}): Promise<DevToolResult> {
  return runDevTool(cfg, 'test', detectTestCommand, 'nenhum runner de testes detectado (sem script "test" nem vitest/jest/pytest/go)', opts)
}

/** Skill `codigo.lint`: roda o linter do projeto e conta os problemas. */
export function runLint(cfg: AppConfig, opts: { root?: string; signal?: AbortSignal; onProgress?: CodeProgressFn } = {}): Promise<DevToolResult> {
  return runDevTool(cfg, 'lint', detectLintCommand, 'nenhum linter detectado (sem script "lint" nem eslint/ruff)', opts)
}

/** Skill `codigo.formatar`: aplica o formatador do projeto. */
export function runFormat(cfg: AppConfig, opts: { root?: string; signal?: AbortSignal; onProgress?: CodeProgressFn } = {}): Promise<DevToolResult> {
  return runDevTool(cfg, 'format', detectFormatCommand, 'nenhum formatador detectado (sem script "format" nem prettier/ruff/gofmt)', opts)
}

/** Skill `codigo.typecheck`: checa os tipos do projeto e conta os erros. */
export function runTypecheck(cfg: AppConfig, opts: { root?: string; signal?: AbortSignal; onProgress?: CodeProgressFn } = {}): Promise<DevToolResult> {
  return runDevTool(cfg, 'typecheck', detectTypecheckCommand, 'nenhuma checagem de tipos detectada (sem script "typecheck", tsconfig, mypy ou go)', opts)
}

// ---------------------------------------------------------------------------
// Skill `codigo.deps`: saúde das dependências (desatualizadas + vulnerabilidades).
// Só leitura, comandos FIXOS (`npm outdated --json` / `npm audit --json`); exige
// rede para consultar o registro — sem rede, devolve checked:false com fala honesta.
// ---------------------------------------------------------------------------

const DEPS_MAX_LISTED = 12

export async function checkDependencies(
  cfg: AppConfig,
  opts: { root?: string; signal?: AbortSignal; onProgress?: CodeProgressFn } = {}
): Promise<CodeDepsResult> {
  const summary = summarizeCodeWorkspace(cfg, opts.root)
  const root = summary.root
  const manager = summary.packageManager || 'npm'
  const base: CodeDepsResult = {
    root,
    manager,
    checked: false,
    outdated: [],
    vulnerabilities: null,
    summary: ''
  }
  if (!summary.exists) return { ...base, summary: 'Workspace não encontrado.', hint: 'workspace não encontrado' }
  if (!existsSync(join(root, 'package.json'))) {
    return { ...base, summary: 'Este projeto não usa package.json; não há dependências npm para checar.', hint: 'sem package.json' }
  }

  const run = (args: string[]) =>
    spawnAsync('npm', args, {
      cwd: root,
      timeoutMs: execTimeout(cfg),
      signal: opts.signal,
      onChunk: (stream, chunk) => opts.onProgress?.({ stream, chunk })
    })

  // `npm outdated` sai com código 1 quando HÁ desatualizadas — não é erro.
  const outdatedRes = await run(['outdated', '--json'])
  const outdatedOk = !outdatedRes.timedOut && !outdatedRes.aborted && outdatedRes.stdout.trim().length > 0
  const outdated = outdatedOk ? parseNpmOutdated(outdatedRes.stdout) : []

  // `npm audit` precisa de lockfile; falha silenciosa vira vulnerabilities:null.
  let vulnerabilities: CodeDepsResult['vulnerabilities'] = null
  const hasLock = existsSync(join(root, 'package-lock.json')) || existsSync(join(root, 'npm-shrinkwrap.json'))
  if (hasLock) {
    const auditRes = await run(['audit', '--json'])
    if (!auditRes.timedOut && !auditRes.aborted) vulnerabilities = parseNpmAudit(auditRes.stdout)
  }

  const checked = outdatedOk || vulnerabilities != null
  return {
    ...base,
    checked,
    outdated: outdated.slice(0, DEPS_MAX_LISTED),
    vulnerabilities,
    summary: describeDepsResult({ checked, outdated, vulns: vulnerabilities }),
    hint: checked ? undefined : 'sem acesso ao registro npm (offline?)'
  }
}

// ---------------------------------------------------------------------------
// Skill `codigo.todo`: varre o projeto atrás de TODO/FIXME/HACK/BUG/XXX em
// comentários. Só leitura, sem processos externos.
// ---------------------------------------------------------------------------

const TODOS_MAX_ITEMS = 40

export function scanTodos(
  cfg: AppConfig,
  opts: { root?: string; filter?: string; maxResults?: number } = {}
): CodeTodosResult {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const maxResults = Math.max(1, Math.min(Number(opts.maxResults) || TODOS_MAX_ITEMS, 200))
  const maxBytes = Math.max(1, codeConfig(cfg).maxFileKB) * 1024
  const { files, timedOut } = walkFiles(root, 8, 2000)
  const items: CodeTodosResult['items'] = []
  const byTag: Record<string, number> = {}
  let total = 0
  const deadline = Date.now() + CODE_SCAN_TIMEOUT_MS

  for (const rel of files) {
    if (Date.now() > deadline) break
    if (!matchesFilter(rel, opts.filter || '')) continue
    const abs = resolveCodeFile(cfg, root, rel)
    if (!isLikelyText(abs, maxBytes)) continue
    let lines: string[]
    try {
      lines = readFileSync(abs, 'utf8').split(/\r?\n/)
    } catch {
      continue
    }
    for (let i = 0; i < lines.length; i++) {
      const hit = matchTodoLine(lines[i])
      if (!hit) continue
      total++
      byTag[hit.tag] = (byTag[hit.tag] || 0) + 1
      if (items.length < maxResults) items.push({ file: rel, line: i + 1, tag: hit.tag, text: hit.text })
    }
  }

  return {
    root,
    total,
    byTag,
    items,
    truncated: timedOut || Date.now() > deadline || total > items.length,
    summary: describeTodosResult({ total, byTag })
  }
}
