import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { shell } from 'electron'

// Login OAuth (PKCE) do OpenRouter para apps desktop. O fluxo:
//   1. geramos code_verifier + code_challenge (S256);
//   2. subimos um servidor http efêmero em 127.0.0.1 como callback;
//   3. abrimos o navegador na tela de autorização do OpenRouter;
//   4. ao autorizar, o navegador volta para o callback com ?code=...;
//   5. trocamos o code pela API key em /api/v1/auth/keys.
// Nenhuma dependência externa — usa o crypto/http/fetch nativos do Node.

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const SUCCESS_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Ares conectado</title><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#04070f;color:#a5f3fc;
font-family:system-ui,sans-serif}.card{text-align:center;padding:2rem 2.5rem;border:1px solid #22d3ee33;
border-radius:1rem;background:#0a1322}.dot{width:10px;height:10px;border-radius:50%;background:#34d399;
display:inline-block;box-shadow:0 0 12px #34d399;margin-right:.5rem}</style></head>
<body><div class="card"><h2><span class="dot"></span>Ares conectado ao OpenRouter</h2>
<p>Pode fechar esta aba e voltar ao aplicativo.</p></div>
<script>setTimeout(()=>window.close(),1500)</script></body></html>`

/** Faz o login OAuth do OpenRouter e devolve a API key. Lança em caso de falha/timeout. */
export async function openRouterOAuth(timeoutMs = 180_000): Promise<string> {
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())

  const code = await new Promise<string>((resolve, reject) => {
    let done = false
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      if (!url.pathname.startsWith('/callback')) {
        res.writeHead(404).end('not found')
        return
      }
      const received = url.searchParams.get('code')
      res.writeHead(received ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(received ? SUCCESS_HTML : '<p>Login sem código. Tente novamente.</p>')
      cleanup()
      if (received) resolve(received)
      else reject(new Error('O navegador voltou sem código de autorização.'))
    })
    const cleanup = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      server.close()
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Tempo esgotado aguardando a autorização no navegador.'))
    }, timeoutMs)
    server.on('error', (e) => {
      cleanup()
      reject(e)
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      const callback = `http://localhost:${port}/callback`
      const authUrl =
        'https://openrouter.ai/auth?callback_url=' +
        encodeURIComponent(callback) +
        '&code_challenge=' +
        encodeURIComponent(challenge) +
        '&code_challenge_method=S256'
      void shell.openExternal(authUrl)
    })
  })

  let res: Response
  try {
    res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' })
    })
  } catch (err: any) {
    throw new Error(`Não consegui trocar o código pela chave: ${err?.message || err}`)
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`OpenRouter recusou a troca do código (HTTP ${res.status}). ${txt.slice(0, 200)}`)
  }
  const json = (await res.json()) as { key?: string }
  if (!json.key) throw new Error('OpenRouter não retornou uma chave.')
  return json.key
}
