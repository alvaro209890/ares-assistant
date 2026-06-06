import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/shared/types'
import { delegateCodeToHermes, readCodeFile, searchCode, summarizeCodeWorkspace } from '../src/main/code'

let root = ''
let server: Server
let hermesUrl = ''
const codeRequests: unknown[] = []

function writeProjectFile(file: string, content: string): void {
  const abs = join(root, file)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

function config(patch: Partial<AppConfig['integrations']['code']> = {}): AppConfig {
  return {
    nineRouter: { baseUrl: 'http://localhost:20128/v1', apiKey: '', model: 'cx/gpt-5.5' },
    grog: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: '', sttModel: 'whisper-large-v3-turbo' },
    tts: { enabled: true, engine: 'auto', piperVoice: 'pt_BR-faber-medium', webVoiceURI: '', rate: 1, pitch: 1, volume: 1 },
    integrations: {
      weatherCity: 'São Paulo',
      newsTopic: '',
      location: { enabled: false },
      hermes: {
        enabled: true,
        baseUrl: hermesUrl,
        messagePath: '/message',
        codePath: '/code',
        healthPath: '/health',
        apiKey: '',
        authHeader: 'Authorization',
        timeoutMs: 3000,
        responsePath: ''
      },
      code: {
        enabled: true,
        workspaceRoot: root,
        allowedRoots: [root],
        maxFileKB: 128,
        maxSearchResults: 20,
        maxContextChars: 12000,
        ...patch
      }
    },
    ui: {
      continuousMode: false,
      micSensitivity: 0.5,
      silenceMs: 1350,
      postSpeechPauseMs: 450,
      proactiveSuggestions: true,
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

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ares-code-test-'))
  writeProjectFile(
    'package.json',
    JSON.stringify({ scripts: { test: 'vitest run', build: 'vite build', verify: 'npm run test && npm run build' } }, null, 2)
  )
  writeProjectFile('src/main.ts', 'export function greet(name: string): string {\n  return `ola ${name}`\n}\n')
  writeProjectFile('src/feature.ts', 'import { greet } from "./main"\nexport const message = greet("Ares")\n')
  writeProjectFile('node_modules/pkg/index.js', 'ignored content')

  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/code') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        codeRequests.push(body)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ reply: `analisado: ${body.task}` }))
        return
      }
      res.statusCode = 404
      res.end('not found')
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      hermesUrl = `http://127.0.0.1:${address.port}`
      resolve()
    })
  })
})

afterAll(async () => {
  rmSync(root, { recursive: true, force: true })
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
})

beforeEach(() => {
  codeRequests.length = 0
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

  it('delega tarefa de programação ao Hermes com workspace e snippets', async () => {
    const result = await delegateCodeToHermes(config(), 'sess-dev', {
      task: 'analise a função greet',
      mode: 'review',
      files: ['src/main.ts']
    })

    expect(result.reply).toBe('analisado: analise a função greet')
    expect(codeRequests).toHaveLength(1)
    expect(codeRequests[0]).toMatchObject({
      task: 'analise a função greet',
      mode: 'review',
      source: 'ares',
      client: 'ares-desktop',
      capability: 'code',
      sessionId: 'sess-dev'
    })
    expect(JSON.stringify(codeRequests[0])).toContain('src/main.ts')
  })
})
