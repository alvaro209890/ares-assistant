import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../src/shared/types'

vi.mock('../src/main/ninerouter', () => ({
  chatJSON: vi.fn()
}))

import { chatJSON } from '../src/main/ninerouter'
import { applyCoderStep, parseCoderStep, runCoderTask } from '../src/main/coder'

const brain = vi.mocked(chatJSON)

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

  it('detecta erros de parse e preenche parseError', () => {
    const step = parseCoderStep('isso não é json')
    expect(step.parseError).toBeDefined()
    expect(step.parseError).toMatch(/Unexpected token|is not valid JSON|Formato JSON inválido/i)
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
    brain.mockReset()
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

describe('coder — runCoderTask', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ares-coder-'))
    brain.mockReset()
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('não aceita done=true sem arquivo, comando ou evidência real', async () => {
    brain.mockResolvedValue(JSON.stringify({ files: [], run: [], done: true, summary: 'pronto' }))

    const res = await runCoderTask(cfg(), { objetivo: 'crie um site simples', passos: 2 })

    expect(res.ok).toBe(false)
    expect(res.done).toBe(false)
    expect(res.blockedReason).toMatch(/sem executar nenhuma ação real/)
  })

  it('emite progresso, escreve arquivo e marca validação executada', async () => {
    brain.mockResolvedValueOnce(
      JSON.stringify({
        thought: 'criar arquivo',
        files: [{ path: 'index.html', content: '<h1>Ares</h1>' }],
        run: ['echo ok'],
        done: true,
        summary: 'Site criado'
      })
    )
    const progress: string[] = []

    const res = await runCoderTask(cfg(), {
      objetivo: 'crie um site simples',
      onProgress: (label) => progress.push(label)
    })

    expect(res.ok).toBe(true)
    expect(res.done).toBe(true)
    expect(res.changedFiles).toContain('index.html')
    expect(res.validated).toBe(true)
    expect(res.validationSummary).toContain('echo ok')
    expect(progress.some((p) => /planejando passo/i.test(p))).toBe(true)
    expect(progress.some((p) => /Escrevendo index.html/i.test(p))).toBe(true)
    expect(progress.some((p) => /Rodando validação: echo ok/i.test(p))).toBe(true)
  })
})
