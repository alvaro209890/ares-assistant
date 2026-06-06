// ---------------------------------------------------------------------------
// Ponte local do Ares (compatível com Hermes), movida a 9Router.
//
// Expõe os endpoints que o Ares chama na "ponte com o Hermes":
//   GET  /health   -> status da ponte
//   POST /message  -> comando geral (delegação) respondido pelo 9Router
//   POST /code     -> tarefa de programação ("Hermes Code") com resposta
//                     ESTRUTURADA (summary/patches/tests/risks/commands)
//
// O cérebro é o MESMO do Ares: 9Router (`cx/gpt-5.5`) em http://localhost:20128.
// Sem dependências externas: usa apenas `node:http` e o `fetch` global.
//
// ATENÇÃO À PORTA 18789: o Hermes Desktop (WhatsApp/Trello/Obsidian/office) também
// usa a :18789. Rode SÓ UM de cada vez nessa porta. Para usar outra porta, defina
// ARES_BRIDGE_PORT e aponte o Ares para ela em Configurações > Ponte com o Hermes.
// ---------------------------------------------------------------------------

import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const MAX_BODY = 8 * 1024 * 1024 // 8 MB de corpo de requisição
const MAX_CONTEXT = 60_000 // limite do contexto de código enviado ao 9Router

export function resolveConfig(env = process.env) {
  return {
    port: Number(env.ARES_BRIDGE_PORT || 18789),
    host: env.ARES_BRIDGE_HOST || '127.0.0.1',
    nineRouterUrl: (env.NINEROUTER_BASE_URL || 'http://localhost:20128/v1').replace(/\/+$/, ''),
    model: env.NINEROUTER_MODEL || 'cx/gpt-5.5',
    apiKey: env.NINEROUTER_API_KEY || '', // 9Router local é keyless por padrão
    token: env.ARES_BRIDGE_TOKEN || '', // se definido, exige Authorization: Bearer <token>
    timeoutMs: Math.max(5000, Number(env.ARES_BRIDGE_TIMEOUT_MS || 120000))
  }
}

// --- Utilidades ------------------------------------------------------------

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('corpo muito grande'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('JSON inválido'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

/** Extrai o primeiro objeto JSON balanceado de um texto (tolerante a crases/ruído). */
function extractJsonObject(text) {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function parseJsonLoose(text) {
  const t = String(text || '').trim()
  if (!t) return null
  try {
    return JSON.parse(t)
  } catch {
    /* tenta extrair */
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      /* segue */
    }
  }
  const obj = extractJsonObject(t)
  if (obj) {
    try {
      return JSON.parse(obj)
    } catch {
      /* segue */
    }
  }
  return null
}

// --- Chamada ao 9Router ----------------------------------------------------

async function chat(cfg, messages, { temperature = 0.2 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
  let res
  try {
    res = await fetch(`${cfg.nineRouterUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
      },
      body: JSON.stringify({ model: cfg.model, messages, temperature }),
      signal: ctrl.signal
    })
  } catch (err) {
    throw new Error(err?.name === 'AbortError' ? '9Router: timeout' : `9Router inacessível: ${err?.message || err}`)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  if (!res.ok) throw new Error(`9Router HTTP ${res.status}: ${text.slice(0, 240)}`)
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('9Router devolveu resposta não-JSON')
  }
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

// --- Endpoints -------------------------------------------------------------

const MESSAGE_SYSTEM =
  'Você é o Hermes, o agente que o Ares aciona para comandos externos (WhatsApp, Trello, Obsidian, office de agentes Pedro/Junim/Maicom). ' +
  'Esta é a ponte LOCAL movida a 9Router: aqui você NÃO tem acesso real a essas integrações. ' +
  'Responda em pt-BR, de forma curta, útil e falável. Se o pedido exigir uma integração externa, diga em uma frase que isso precisa do Hermes Desktop completo ligado, e ofereça o que dá para resolver por texto agora.'

async function handleMessage(cfg, body) {
  const command = String(body.message || body.text || body.command || '').trim()
  if (!command) throw new Error('Diga qual comando enviar.')
  const reply = await chat(cfg, [
    { role: 'system', content: MESSAGE_SYSTEM },
    { role: 'user', content: command }
  ])
  return { reply: reply || 'Sem resposta.', model: cfg.model, source: 'ares-bridge' }
}

const MODE_HINT = {
  review: 'Revise o código: aponte bugs, riscos e melhorias. Em geral sem patches, a menos que a correção seja óbvia.',
  edit: 'Implemente a edição pedida com patches concretos (diff unificado válido quando possível).',
  debug: 'Investigue o bug, explique a causa raiz e, se claro, proponha o patch da correção.',
  tests: 'Proponha/ajuste testes; liste comandos para rodá-los.',
  refactor: 'Refatore preservando comportamento; explique a estratégia e os riscos.',
  explain: 'Explique o código/projeto com clareza; normalmente sem patches.',
  assist: 'Ajude com a tarefa de programação da melhor forma.'
}

const CODE_SYSTEM =
  'Você é o "Hermes Code", engenheiro de software sênior que recebe tarefas de programação delegadas pelo assistente Ares. Trabalha em pt-BR. ' +
  'Responda SEMPRE com UM ÚNICO objeto JSON válido, sem texto fora dele e sem crases, no formato: ' +
  '{"summary": "<resumo curto e falável em pt-BR>", "patches": [{"file": "rel/caminho.ts", "diff": "diff --git a/... b/...", "find": "...", "replace": "..."}], "tests": ["..."], "risks": ["..."], "commands": ["..."], "needsConfirmation": true}. ' +
  'Use "diff" (unificado, aplicável por `git apply`) quando possível; como alternativa use {file, find, replace}. ' +
  'Inclua "patches" só quando houver edição concreta; para revisão/explicação deixe "patches": [] e detalhe em "summary". ' +
  'Baseie-se apenas no contexto fornecido; se faltar arquivo essencial, diga isso em "summary" e liste em "risks".'

function buildCodeUserPrompt(body) {
  const mode = String(body.mode || 'assist')
  const task = String(body.task || '').trim()
  const parts = [
    `Modo: ${mode} — ${MODE_HINT[mode] || MODE_HINT.assist}`,
    `Tarefa: ${task || '(não especificada)'}`
  ]
  if (body.workspace) parts.push(`Workspace:\n${JSON.stringify(body.workspace).slice(0, 8000)}`)
  if (Array.isArray(body.files) && body.files.length) {
    let used = 0
    const blocks = []
    for (const f of body.files) {
      const content = typeof f?.content === 'string' ? f.content : ''
      const header = `>>> ${f?.file || 'arquivo'} (linhas ${f?.startLine || 1}-${f?.endLine || '?'})`
      const block = `${header}\n${content}`
      if (used + block.length > MAX_CONTEXT) break
      used += block.length
      blocks.push(block)
    }
    if (blocks.length) parts.push(`Arquivos (trechos com nº de linha):\n${blocks.join('\n\n')}`)
  }
  if (body.extra && Object.keys(body.extra).length) parts.push(`Extra: ${JSON.stringify(body.extra).slice(0, 2000)}`)
  return parts.join('\n\n')
}

async function handleCode(cfg, body) {
  const task = String(body.task || '').trim()
  if (!task) throw new Error('Diga qual tarefa de programação enviar.')
  const raw = await chat(
    cfg,
    [
      { role: 'system', content: CODE_SYSTEM },
      { role: 'user', content: buildCodeUserPrompt(body) }
    ],
    { temperature: 0.1 }
  )
  const parsed = parseJsonLoose(raw)
  if (parsed && typeof parsed === 'object') {
    // Normaliza para o contrato que o Ares espera preservar em `structured`.
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : task,
      patches: Array.isArray(parsed.patches) ? parsed.patches : [],
      tests: Array.isArray(parsed.tests) ? parsed.tests : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
      needsConfirmation: parsed.needsConfirmation !== false,
      model: cfg.model,
      source: 'ares-bridge'
    }
  }
  // Sem JSON: devolve ao menos o texto como summary (Ares lê `summary`/`reply`).
  return { summary: raw || 'Sem resposta.', reply: raw, model: cfg.model, source: 'ares-bridge' }
}

// --- Roteador HTTP ---------------------------------------------------------

function authorized(cfg, req) {
  if (!cfg.token) return true
  const header = String(req.headers['authorization'] || '')
  return header === `Bearer ${cfg.token}` || header === cfg.token
}

export function createBridgeServer(opts = {}) {
  const cfg = { ...resolveConfig(), ...opts }
  const server = createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0]
    try {
      if (req.method === 'GET' && (url === '/health' || url === '/')) {
        return sendJson(res, 200, {
          ok: true,
          service: 'ares-bridge',
          model: cfg.model,
          nineRouter: cfg.nineRouterUrl,
          endpoints: ['/health', '/message', '/code'],
          time: new Date().toISOString()
        })
      }
      if (req.method !== 'POST') return sendJson(res, 404, { error: 'rota não encontrada' })
      if (!authorized(cfg, req)) return sendJson(res, 401, { error: 'não autorizado' })

      const body = await readJsonBody(req)
      if (url === '/message') return sendJson(res, 200, await handleMessage(cfg, body))
      if (url === '/code') return sendJson(res, 200, await handleCode(cfg, body))
      return sendJson(res, 404, { error: 'rota não encontrada' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const status = /muito grande|inválido|Diga qual/i.test(msg) ? 400 : 502
      return sendJson(res, status, { error: msg })
    }
  })
  server._aresConfig = cfg
  return server
}

export function startBridge(env = process.env) {
  const cfg = resolveConfig(env)
  const server = createBridgeServer(cfg)
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(
        `\n[ares-bridge] A porta ${cfg.port} já está em uso.\n` +
          `  Provavelmente o Hermes Desktop já ocupa a :18789 (eles não podem dividir a porta).\n` +
          `  Pare o Hermes Desktop OU rode a ponte em outra porta:\n` +
          `    ARES_BRIDGE_PORT=18790 npm run bridge\n` +
          `  e aponte o Ares para essa porta em Configurações > Ponte com o Hermes.\n`
      )
    } else {
      console.error('[ares-bridge] erro:', err)
    }
    process.exit(1)
  })
  server.listen(cfg.port, cfg.host, () => {
    console.log(
      `[ares-bridge] ouvindo em http://${cfg.host}:${cfg.port}  ·  cérebro: ${cfg.model} @ ${cfg.nineRouterUrl}`
    )
    console.log('[ares-bridge] rotas: GET /health · POST /message · POST /code')
    if (!cfg.token) console.log('[ares-bridge] sem token (acesso local liberado em 127.0.0.1)')
  })
  return server
}

// Auto-inicia só quando executado diretamente (node bridge/server.mjs).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) startBridge()
