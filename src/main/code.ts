import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import type {
  AppConfig,
  CodeCommandResult,
  CodeDiagnosis,
  CodeDiagnosisCheck,
  CodeFileSnippet,
  CodePatchApplyResult,
  CodePatchPreview,
  CodeProjectIndex,
  CodeScaffoldResult,
  CodeSearchMatch,
  CodeTerminalResult,
  CodeWorkspaceSummary,
  CodeWriteResult,
  CommandClassification
} from '../shared/types'
import { normalizeTemplate, slug, templateFiles } from './scaffold'

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

function languageFor(file: string): string {
  return LANGUAGE_BY_EXT[extname(file).toLowerCase()] || 'Outros'
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
    file: relativeDisplayPath(root, abs),
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
    `Ferramentas de programação locais: ativadas com leitura, escrita, patches, terminal e coder autônomo nativos.`,
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

export function runCodeCommand(cfg: AppConfig, opts: { root?: string; command: string }): CodeCommandResult {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const command = String(opts.command || '').trim().replace(/\s+/g, ' ')
  if (!isCommandAllowed(cfg, command)) throw new Error(`Comando não permitido para programação: ${command}`)
  const parts = splitCommand(command)
  if (!parts.length) throw new Error('Comando vazio.')

  const started = Date.now()
  const res = spawnSync(parts[0], parts.slice(1), {
    cwd: root,
    encoding: 'utf8',
    timeout: Math.max(1000, Math.min(Number(codeConfig(cfg).commandTimeoutMs) || 120000, 10 * 60_000)),
    maxBuffer: 1024 * 1024 * 4
  })

  return {
    root,
    command,
    ok: res.status === 0,
    code: res.status,
    stdout: String(res.stdout || '').slice(0, 12000),
    stderr: (res.error ? String(res.error.message || res.error) + '\n' : '') + String(res.stderr || '').slice(0, 12000),
    durationMs: Date.now() - started
  }
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
  { re: /rm\s+(-\S*\s+)*-\S*[rf]\S*\s+(-\S*\s+)*(\/|~|\$home|\.{1,2}|\*)(\s|\/|$)/, why: 'remoção recursiva de raiz/HOME/diretório atual' },
  { re: /rm\s+-\S*[rf].*\s\/(\s|$)/, why: 'remoção recursiva da raiz do sistema' },
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
  'node --version',
  'npm --version',
  'npm ls',
  'npx tsc --noEmit'
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
 * Classifica um comando antes de executá-lo. Não roda nada — apenas decide a
 * camada de segurança. Usado pelo terminal e testável isoladamente.
 */
export function classifyCommand(cfg: AppConfig, command: string): CommandClassification {
  const c = normalizeCommand(command)
  if (!c) return { tier: 'blocked', reason: 'comando vazio' }
  const lower = c.toLowerCase()
  for (const { re, why } of BLOCKED_PATTERNS) {
    if (re.test(lower)) return { tier: 'blocked', reason: why }
  }
  const allowlist = codeConfig(cfg).allowedCommands || []
  if (allowlist.some((a) => matchesPrefix(c, a))) return { tier: 'allowed', reason: 'comando na allowlist' }
  if (terminalSafePrefixes(cfg).some((p) => matchesPrefix(c, p))) return { tier: 'allowed', reason: 'comando seguro (somente leitura/dev)' }
  return { tier: 'confirm', reason: 'comando fora da allowlist: requer autorização do usuário' }
}

/**
 * Executa um comando no terminal do projeto via shell real, com pipes e operadores.
 * No Windows usa PowerShell; nos demais sistemas usa bash. Comandos 'confirm' só
 * rodam quando `approved` é true (ou `terminalAutoApprove` está ligado); 'blocked'
 * nunca roda.
 */
function platformShell(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
    }
  }
  return { file: 'bash', args: ['-lc', command] }
}

export function runCodeTerminal(
  cfg: AppConfig,
  opts: { root?: string; command: string; approved?: boolean }
): CodeTerminalResult {
  if (codeConfig(cfg).terminalEnabled === false) throw new Error('Terminal desativado nas Configurações.')
  const root = resolveCodeWorkspace(cfg, opts.root)
  const command = normalizeCommand(opts.command)
  if (!command) throw new Error('Comando vazio.')

  const cls = classifyCommand(cfg, command)
  const empty = { root, command, tier: cls.tier, ran: false, ok: false, code: null, stdout: '', stderr: '', durationMs: 0, reason: cls.reason }

  if (cls.tier === 'blocked') throw new Error(`Comando bloqueado por segurança: ${cls.reason}`)

  const autoApprove = codeConfig(cfg).terminalAutoApprove === true
  if (cls.tier === 'confirm' && !opts.approved && !autoApprove) {
    return { ...empty, requiresApproval: true }
  }

  const started = Date.now()
  const shell = platformShell(command)
  const res = spawnSync(shell.file, shell.args, {
    cwd: root,
    encoding: 'utf8',
    timeout: Math.max(1000, Math.min(Number(codeConfig(cfg).commandTimeoutMs) || 120000, 10 * 60_000)),
    maxBuffer: 1024 * 1024 * 8
  })

  return {
    ...empty,
    requiresApproval: false,
    ran: true,
    ok: res.status === 0,
    code: res.status,
    stdout: String(res.stdout || '').slice(0, 16000),
    stderr: (res.error ? String(res.error.message || res.error) + '\n' : '') + String(res.stderr || '').slice(0, 16000),
    durationMs: Date.now() - started
  }
}

function gitResult(cfg: AppConfig, root: string, args: string[]): CodeCommandResult {
  const command = `git ${args.join(' ')}`
  const started = Date.now()
  const res = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: Math.max(1000, Math.min(Number(codeConfig(cfg).commandTimeoutMs) || 120000, 10 * 60_000)),
    maxBuffer: 1024 * 1024 * 4
  })
  return {
    root,
    command,
    ok: res.status === 0,
    code: res.status,
    stdout: String(res.stdout || '').slice(0, 16000),
    stderr: (res.error ? String(res.error.message || res.error) + '\n' : '') + String(res.stderr || '').slice(0, 16000),
    durationMs: Date.now() - started
  }
}

export function runCodeGit(
  cfg: AppConfig,
  opts: { root?: string; operation: string; file?: string }
): CodeCommandResult {
  const root = resolveCodeWorkspace(cfg, opts.root)
  const op = String(opts.operation || '').trim()
  const file = opts.file ? relativeDisplayPath(root, resolveCodeFile(cfg, root, opts.file)) : ''
  if (file && (file.startsWith('..') || isAbsolute(file))) throw new Error(`Arquivo fora do workspace: ${opts.file}`)
  if (op === 'status') return gitResult(cfg, root, ['status', '--short'])
  if (op === 'diffStat') return gitResult(cfg, root, file ? ['diff', '--stat', '--', file] : ['diff', '--stat'])
  if (op === 'diff') return gitResult(cfg, root, file ? ['diff', '--', file] : ['diff'])
  if (op === 'log') return gitResult(cfg, root, ['log', '--oneline', '-10'])
  throw new Error(`Operação Git não permitida: ${op}`)
}

function indexPath(root: string): string {
  const dir = join(homedir(), '.config', 'ares', 'code-indexes')
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

export function applyCodePatch(cfg: AppConfig, opts: { root?: string; diff?: unknown; patches?: unknown }): CodePatchApplyResult {
  if (!codeConfig(cfg).allowPatchApply) throw new Error('Aplicação de patches desativada nas Configurações.')
  const preview = previewCodePatch(cfg, opts)
  if (!preview.canApply) return { ...preview, applied: false, output: preview.warnings.join('\n') }
  const diff = patchDiff(opts)
  if (diff) {
    const res = spawnSync('git', ['-C', preview.root, 'apply', '--whitespace=nowarn', '-'], {
      input: diff,
      encoding: 'utf8',
      timeout: 10000
    })
    return {
      ...preview,
      applied: res.status === 0,
      output: String(res.stderr || res.stdout || (res.status === 0 ? 'patch aplicado' : 'falha ao aplicar patch')).trim()
    }
  }
  for (const op of textPatches(opts)) {
    const abs = resolveCodeFile(cfg, preview.root, op.file)
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
    const next =
      op.content !== undefined
        ? op.content
        : op.all
          ? current.split(op.find || '').join(op.replace || '')
          : current.replace(op.find || '', op.replace || '')
    writeFileSync(abs, next, 'utf8')
  }
  return { ...preview, applied: true, output: 'patch textual aplicado' }
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
export function diagnoseProject(cfg: AppConfig, opts: { root?: string } = {}): CodeDiagnosis {
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
    const res = runCodeCommand(cfg, { root, command: step.command })
    const tail = (res.ok ? res.stdout : res.stderr || res.stdout).split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
    checks.push({ name: step.name, command: step.command, ran: true, ok: res.ok, code: res.code, summary: tail.slice(0, 240) })
  }

  if (!summary.scripts) hints.push('sem package.json: nada para testar automaticamente')
  if (summary.git?.dirty) hints.push('há alterações sem commit')

  const ran = checks.filter((c) => c.ran)
  const ok = ran.length > 0 ? ran.every((c) => c.ok) : true
  return { root, name, ok, checks, hints }
}
