import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/shared/types'
import { extractHermesReply, hermesExecute, hermesUrl, pingHermes } from '../src/main/hermes'

type HermesConfig = AppConfig['integrations']['hermes']

const requests: Array<{
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: string
}> = []

let server: Server
let baseUrl = ''

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function config(patch: Partial<HermesConfig> = {}): HermesConfig {
  return {
    enabled: true,
    baseUrl,
    messagePath: '/message',
    healthPath: '/health',
    apiKey: '',
    authHeader: 'Authorization',
    timeoutMs: 3000,
    responsePath: '',
    ...patch
  }
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req)
    requests.push({ method: req.method || '', url: req.url || '', headers: req.headers, body })
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'GET' && req.url === '/health') {
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.method === 'POST' && req.url === '/message') {
      const json = JSON.parse(body)
      res.end(JSON.stringify({ reply: `recebido: ${json.message}`, sessionId: json.sessionId }))
      return
    }

    if (req.method === 'POST' && req.url === '/nested') {
      res.end(JSON.stringify({ data: { answer: 'resposta no caminho configurado' } }))
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      baseUrl = `http://127.0.0.1:${address.port}`
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

beforeEach(() => {
  requests.length = 0
})

describe('ponte Hermes', () => {
  it('monta URLs sem duplicar barras e aceita path absoluto', () => {
    expect(hermesUrl('http://localhost:18789/', '/message')).toBe('http://localhost:18789/message')
    expect(hermesUrl('http://localhost:18789/api', 'message')).toBe('http://localhost:18789/api/message')
    expect(hermesUrl('http://localhost:18789', 'https://hermes.local/inbox')).toBe('https://hermes.local/inbox')
  })

  it('extrai respostas nos formatos comuns do Hermes', () => {
    expect(extractHermesReply('{"reply":"ok"}')).toBe('ok')
    expect(extractHermesReply('{"data":{"answer":"feito"}}')).toBe('feito')
    expect(extractHermesReply('{"payload":{"texto":"custom"}}', 'payload.texto')).toBe('custom')
    expect(extractHermesReply('texto puro')).toBe('texto puro')
  })

  it('envia comando com token, origem e id de sessão', async () => {
    const result = await hermesExecute(config({ apiKey: 'secret-token' }), 'mandar resumo no WhatsApp', 'sess-42')

    expect(result.reply).toBe('recebido: mandar resumo no WhatsApp')
    expect(result.status).toBe(200)

    const req = requests.find((item) => item.url === '/message')
    expect(req?.method).toBe('POST')
    expect(req?.headers.authorization).toBe('Bearer secret-token')
    expect(JSON.parse(req?.body || '{}')).toMatchObject({
      message: 'mandar resumo no WhatsApp',
      text: 'mandar resumo no WhatsApp',
      command: 'mandar resumo no WhatsApp',
      source: 'ares',
      client: 'ares-desktop',
      sessionId: 'sess-42'
    })
  })

  it('respeita rota, cabeçalho e caminho de resposta configuráveis', async () => {
    const result = await hermesExecute(
      config({
        messagePath: '/nested',
        apiKey: 'abc',
        authHeader: 'X-Hermes-Key',
        responsePath: 'data.answer'
      }),
      'acionar office'
    )

    expect(result.reply).toBe('resposta no caminho configurado')
    const req = requests.find((item) => item.url === '/nested')
    expect(req?.headers['x-hermes-key']).toBe('abc')
  })

  it('reporta status online pelo healthPath', async () => {
    const status = await pingHermes(config())

    expect(status.ok).toBe(true)
    expect(status.enabled).toBe(true)
    expect(status.detail).toContain('/health')
  })

  it('reporta ponte desativada sem tocar a rede', async () => {
    const status = await pingHermes(config({ enabled: false }))

    expect(status.ok).toBe(false)
    expect(status.detail).toContain('desativada')
    expect(requests).toHaveLength(0)
  })
})
