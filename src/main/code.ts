import { spawnSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import type { AppConfig, CodeFileSnippet, CodeHermesResult, CodeSearchMatch, CodeWorkspaceSummary } from '../shared/types'
import { hermesCodeTask } from './hermes'

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

function codeConfig(cfg: AppConfig): AppConfig['integrations']['code'] {
  return cfg.integrations.code
}

function ensureEnabled(cfg: AppConfig): void {
  if (!codeConfig(cfg).enabled) throw new Error('Ferramentas de programação desativadas nas Configurações.')
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
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
  const raw = String(requested || '').trim()
  const target = raw ? (isAbsolute(raw) ? resolve(raw) : resolve(base, raw)) : base
  assertAllowed(cfg, target)
  if (existsSync(target) && statSync(target).isFile()) return dirname(target)
  return target
}

function resolveCodeFile(cfg: AppConfig, root: string, file: string): string {
  const target = isAbsolute(file) ? resolve(file) : resolve(root, file)
  assertAllowed(cfg, target)
  if (!isInside(root, target)) throw new Error(`Arquivo fora do workspace: ${file}`)
  return target
}

function git(root: string, args: string[]): string | null {
  try {
    const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 1500 })
    if (res.status === 0) return String(res.stdout || '').trim()
  } catch {
    /* git é opcional */
  }
  return null
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

function walkFiles(root: string, maxDepth: number, maxFiles: number): { files: string[]; ignored: string[]; languages: Record<string, number> } {
  const files: string[] = []
  const ignored: string[] = []
  const languages: Record<string, number> = {}

  const walk = (dir: string, depth: number): void => {
    if (files.length >= maxFiles || depth > maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries.sort()) {
      if (files.length >= maxFiles) return
      const abs = join(dir, name)
      const rel = relative(root, abs)
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
        const lang = LANGUAGE_BY_EXT[extname(name).toLowerCase()] || 'Outros'
        languages[lang] = (languages[lang] || 0) + 1
      }
    }
  }

  walk(root, 0)
  return { files, ignored, languages }
}

export function summarizeCodeWorkspace(cfg: AppConfig, requested = ''): CodeWorkspaceSummary {
  const root = resolveCodeWorkspace(cfg, requested)
  const name = basename(root)
  if (!existsSync(root)) {
    return { root, name, exists: false, languages: {}, files: [], ignored: [], hints: ['workspace não encontrado'] }
  }

  const { files, ignored, languages } = walkFiles(root, 4, 180)
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = git(root, ['status', '--short'])
  const pkg = packageInfo(root)
  const hints: string[] = []
  if (pkg.scripts?.test) hints.push(`teste disponível: ${pkg.packageManager || 'npm'} run test`)
  if (pkg.scripts?.verify) hints.push(`verificação completa: ${pkg.packageManager || 'npm'} run verify`)
  if (pkg.scripts?.build) hints.push(`build disponível: ${pkg.packageManager || 'npm'} run build`)
  if (files.some((f) => f.endsWith('tsconfig.json'))) hints.push('TypeScript detectado')
  if (files.some((f) => f.endsWith('electron.vite.config.ts'))) hints.push('Electron + Vite detectado')

  return {
    root,
    name,
    exists: true,
    git: branch ? { branch, dirty: !!status, status: status ? status.split('\n').slice(0, 80) : [] } : undefined,
    ...pkg,
    languages,
    files,
    ignored: ignored.slice(0, 80),
    hints
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
  const { files } = walkFiles(root, 8, 2000)
  const matches: CodeSearchMatch[] = []

  for (const rel of files) {
    if (matches.length >= internalLimit) break
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

  return { root, query, matches: matches.slice(0, maxResults), truncated: matches.length > maxResults }
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
    file: relative(root, abs),
    startLine: start,
    endLine: end,
    totalLines,
    truncated: end < totalLines || start > 1,
    content
  }
}

export function codePromptContext(cfg: AppConfig): string {
  const c = codeConfig(cfg)
  if (!c.enabled) return 'Ferramentas de programação locais: desativadas.'
  return [
    `Ferramentas de programação locais: ativadas (read-only).`,
    `Workspace padrão: ${c.workspaceRoot}.`,
    `Raízes permitidas: ${(c.allowedRoots || []).join(', ') || '(sem restrição explícita)'}.`,
    `Limites: arquivo até ${c.maxFileKB} KB, ${c.maxSearchResults} resultados de busca, ${c.maxContextChars} caracteres de contexto para Hermes.`
  ].join('\n')
}

export async function delegateCodeToHermes(
  cfg: AppConfig,
  sessionId: string,
  opts: { task: string; mode?: string; root?: string; files?: string[]; extra?: Record<string, unknown> }
): Promise<CodeHermesResult> {
  if (!cfg.integrations.hermes.enabled) throw new Error('Ponte com o Hermes desativada nas Configurações.')
  const workspace = summarizeCodeWorkspace(cfg, opts.root)
  const snippets: CodeFileSnippet[] = []
  let usedChars = JSON.stringify(workspace).length
  const maxChars = Math.max(2000, codeConfig(cfg).maxContextChars)

  for (const file of opts.files || []) {
    if (!file || usedChars >= maxChars) continue
    const snippet = readCodeFile(cfg, { root: workspace.root, file, lines: 160 })
    usedChars += snippet.content.length
    if (usedChars <= maxChars) snippets.push(snippet)
  }

  return hermesCodeTask(
    cfg.integrations.hermes,
    {
      task: opts.task,
      mode: opts.mode || 'assist',
      workspace,
      files: snippets,
      extra: opts.extra
    },
    sessionId
  )
}
