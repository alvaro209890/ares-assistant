import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBridgeServer } from '../bridge/server.mjs'

// Fake do 9Router: responde no formato OpenAI (choices[0].message.content).
// Decide a resposta pelo prompt: se for "Hermes Code", devolve JSON estruturado;
// se a tarefa pedir PLAINTEXT, devolve texto puro (testa o fallback); senão, uma
// resposta curta de /message.
let nineRouter: Server
let nineUrl = ''
let bridge: Server
let bridgeUrl = ''

const CODE_JSON = {
  summary: 'corrige o roteamento',
  patches: [{ file: 'src/a.ts', diff: 'diff --git a/src/a.ts b/src/a.ts' }],
  tests: ['npm test'],
  risks: ['baixo risco'],
  commands: ['npm test'],
  needsConfirmation: true
}

beforeAll(async () => {
  nineRouter = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.from(c)))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const sys = String(body.messages?.[0]?.content || '')
      const user = String(body.messages?.[1]?.content || '')
      let content = 'Olá, aqui é o Hermes local.'
      if (sys.includes('Hermes Code')) {
        content = user.includes('PLAINTEXT') ? 'só um texto, sem json' : JSON.stringify(CODE_JSON)
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          id: 'x',
          object: 'chat.completion',
          model: body.model,
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
        })
      )
    })
  })
  await new Promise<void>((resolve) => {
    nineRouter.listen(0, '127.0.0.1', () => {
      nineUrl = `http://127.0.0.1:${(nineRouter.address() as AddressInfo).port}/v1`
      resolve()
    })
  })

  bridge = createBridgeServer({ nineRouterUrl: nineUrl, model: 'fake-model', host: '127.0.0.1' })
  await new Promise<void>((resolve) => {
    bridge.listen(0, '127.0.0.1', () => {
      bridgeUrl = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise<void>((r) => bridge.close(() => r()))
  await new Promise<void>((r) => nineRouter.close(() => r()))
})

const post = async (path: string, payload: unknown) => {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return { status: res.status, json: await res.json() }
}

describe('ponte local (Ares bridge)', () => {
  it('/health informa serviço e modelo', async () => {
    const res = await fetch(`${bridgeUrl}/health`)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.service).toBe('ares-bridge')
    expect(json.model).toBe('fake-model')
    expect(json.endpoints).toContain('/code')
  })

  it('/message responde via 9Router com {reply}', async () => {
    const { status, json } = await post('/message', { message: 'oi' })
    expect(status).toBe(200)
    expect(json.reply).toBe('Olá, aqui é o Hermes local.')
    expect(json.model).toBe('fake-model')
  })

  it('/code devolve resposta estruturada do Hermes Code', async () => {
    const { status, json } = await post('/code', {
      task: 'corrija o roteamento',
      mode: 'debug',
      workspace: { root: '/tmp/x', name: 'x' },
      files: [{ file: 'src/a.ts', startLine: 1, endLine: 3, content: '1: x' }]
    })
    expect(status).toBe(200)
    expect(json.summary).toBe('corrige o roteamento')
    expect(json.patches).toHaveLength(1)
    expect(json.patches[0].file).toBe('src/a.ts')
    expect(json.tests).toContain('npm test')
    expect(json.needsConfirmation).toBe(true)
    expect(json.source).toBe('ares-bridge')
  })

  it('/code faz fallback para summary quando o modelo não devolve JSON', async () => {
    const { status, json } = await post('/code', { task: 'PLAINTEXT por favor', mode: 'explain' })
    expect(status).toBe(200)
    expect(json.summary).toBe('só um texto, sem json')
    expect(json.patches).toBeUndefined()
  })

  it('rejeita tarefa de código vazia', async () => {
    const { status, json } = await post('/code', { mode: 'review' })
    expect(status).toBe(400)
    expect(json.error).toMatch(/tarefa/i)
  })
})
