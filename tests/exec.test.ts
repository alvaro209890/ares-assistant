import { describe, expect, it } from 'vitest'
import { quoteWindowsArg, spawnAsync, windowsSpawnPlan } from '../src/main/exec'

const NODE = process.execPath // caminho do node atual, multiplataforma

describe('spawnAsync — execução não-bloqueante', () => {
  it('captura stdout e código de saída 0', async () => {
    const r = await spawnAsync(NODE, ['-e', 'process.stdout.write("ola")'], { timeoutMs: 5000 })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('ola')
    expect(r.timedOut).toBe(false)
    expect(r.aborted).toBe(false)
  })

  it('propaga código de saída diferente de zero e stderr', async () => {
    const r = await spawnAsync(NODE, ['-e', 'process.stderr.write("boom"); process.exit(3)'], { timeoutMs: 5000 })
    expect(r.code).toBe(3)
    expect(r.stderr).toContain('boom')
  })

  it('mata o processo no timeout', async () => {
    const r = await spawnAsync(NODE, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 100 })
    expect(r.timedOut).toBe(true)
  })

  it('aborta via AbortSignal sem travar', async () => {
    const ctrl = new AbortController()
    const p = spawnAsync(NODE, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 5000, signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 60)
    const r = await p
    expect(r.aborted).toBe(true)
  })

  it('transmite a saída em tempo real via onChunk', async () => {
    const chunks: string[] = []
    const r = await spawnAsync(NODE, ['-e', 'process.stdout.write("stream")'], {
      timeoutMs: 5000,
      onChunk: (_s, c) => chunks.push(c)
    })
    expect(chunks.join('')).toContain('stream')
    expect(r.stdout).toContain('stream')
  })

  it('não rejeita quando o binário não existe (erro de spawn)', async () => {
    const r = await spawnAsync('binario-que-nao-existe-xyz-123', [], { timeoutMs: 2000 })
    // Unix: erro de spawn (ENOENT) -> code null. Windows: o comando bare é roteado
    // por cmd.exe, que devolve código != 0 com a mensagem de "não reconhecido".
    if (process.platform === 'win32') expect(r.code).not.toBe(0)
    else expect(r.code).toBeNull()
    expect(r.stderr.length).toBeGreaterThan(0)
  })

  it('roda em segundo plano (background) e finaliza com killBackgroundProcesses', async () => {
    const sessionId = 'test-session-123'
    const r = await spawnAsync(NODE, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 10000,
      background: true,
      sessionId,
      startupTimeoutMs: 500
    })
    expect(r.background).toBe(true)
    expect(r.code).toBeNull()
    
    const { backgroundProcesses, killBackgroundProcesses } = await import('../src/main/exec')
    const set = backgroundProcesses.get(sessionId)
    expect(set).toBeDefined()
    expect(set?.size).toBe(1)
    
    killBackgroundProcesses(sessionId)
    expect(backgroundProcesses.has(sessionId)).toBe(false)
  })
})

describe('windowsSpawnPlan — shims .cmd no Windows (npm/npx/tsc)', () => {
  it('roteia comandos bare desconhecidos (shims .cmd) por cmd.exe', () => {
    expect(windowsSpawnPlan('npm', ['run', 'test'])).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm run test']
    })
    expect(windowsSpawnPlan('npx', ['tsc', '--noEmit']).file).toBe('cmd.exe')
    expect(windowsSpawnPlan('script.cmd', []).file).toBe('cmd.exe')
  })

  it('spawna direto executáveis nativos conhecidos e caminhos .exe', () => {
    expect(windowsSpawnPlan('git', ['status'])).toEqual({ file: 'git', args: ['status'] })
    expect(windowsSpawnPlan('node', ['-e', 'x'])).toEqual({ file: 'node', args: ['-e', 'x'] })
    expect(windowsSpawnPlan('powershell.exe', ['-NoProfile']).file).toBe('powershell.exe')
    expect(windowsSpawnPlan('C:\\tools\\app.exe', ['--ok']).file).toBe('C:\\tools\\app.exe')
  })

  it('re-cita argumentos com espaço/aspas para a linha do cmd.exe', () => {
    expect(quoteWindowsArg('simples')).toBe('simples')
    expect(quoteWindowsArg('com espaco')).toBe('"com espaco"')
    expect(quoteWindowsArg('a"b')).toBe('"a\\"b"')
    const plan = windowsSpawnPlan('npm', ['run', 'meu script'])
    expect(plan.args[3]).toBe('npm run "meu script"')
  })
})
