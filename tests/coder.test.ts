import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/shared/types'
import { applyCoderStep, parseCoderStep } from '../src/main/coder'

describe('coder — parseCoderStep', () => {
  it('lê um passo válido', () => {
    const step = parseCoderStep(
      JSON.stringify({ thought: 'fazer', files: [{ path: 'index.html', content: '<h1>oi</h1>' }], run: ['echo ok'], done: true, summary: 'pronto' })
    )
    expect(step.files).toHaveLength(1)
    expect(step.files[0].path).toBe('index.html')
    expect(step.run).toEqual(['echo ok'])
    expect(step.done).toBe(true)
    expect(step.summary).toBe('pronto')
  })

  it('extrai JSON cercado por crases e ignora arquivos inválidos', () => {
    const raw = 'Claro!\n```json\n' + JSON.stringify({ files: [{ path: 'a.js', content: 'x' }, { path: 123 }, { nope: 1 }], done: false }) + '\n```'
    const step = parseCoderStep(raw)
    expect(step.files).toHaveLength(1)
    expect(step.files[0].path).toBe('a.js')
  })

  it('degrada para vazio em lixo', () => {
    const step = parseCoderStep('isso não é json')
    expect(step.files).toHaveLength(0)
    expect(step.run).toHaveLength(0)
    expect(step.done).toBe(false)
  })
})

let root = ''
const cfg = (): AppConfig =>
  ({
    integrations: {
      code: {
        enabled: true,
        workspaceRoot: root,
        allowedRoots: [root],
        maxFileKB: 256,
        allowPatchApply: true,
        commandTimeoutMs: 30000,
        terminalEnabled: true,
        terminalAutoApprove: false,
        terminalSafe: ['echo'],
        allowedCommands: []
      }
    }
  }) as unknown as AppConfig

describe('coder — applyCoderStep', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ares-coder-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('escreve arquivos no projeto e recusa caminhos fora', async () => {
    const res = await applyCoderStep(cfg(), root, {
      files: [
        { path: 'src/app.js', content: 'console.log(1)' },
        { path: '../fora.txt', content: 'x' }
      ],
      run: [],
      done: true,
      summary: ''
    })
    expect(res.written).toContain('src/app.js')
    expect(existsSync(join(root, 'src', 'app.js'))).toBe(true)
    expect(readFileSync(join(root, 'src', 'app.js'), 'utf8')).toBe('console.log(1)')
    expect(res.skipped.join(' ')).toMatch(/fora/)
  })

  it('roda só comandos seguros e pula o que precisa de autorização', async () => {
    const res = await applyCoderStep(cfg(), root, {
      files: [],
      run: ['echo ola', 'npm install left-pad'],
      done: true,
      summary: ''
    })
    const echo = res.ran.find((r) => r.command === 'echo ola')
    const npm = res.ran.find((r) => r.command.startsWith('npm install'))
    expect(echo?.ran).toBe(true)
    expect(echo?.ok).toBe(true)
    expect(npm?.ran).toBe(false) // confirm-tier não roda sozinho
  })

  it('não escreve quando a permissão está desligada', async () => {
    const c = cfg()
    c.integrations.code.allowPatchApply = false
    const res = await applyCoderStep(c, root, { files: [{ path: 'x.txt', content: 'y' }], run: [], done: true, summary: '' })
    expect(res.written).toHaveLength(0)
    expect(res.skipped.length).toBeGreaterThan(0)
  })
})
