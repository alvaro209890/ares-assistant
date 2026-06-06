# Ponte com o Hermes

Este documento descreve a integração em que o Ares funciona como controle de voz e
desktop do Hermes. A ideia é preservar a qualidade do Hermes, delegando a ele o que
já é responsabilidade dele: WhatsApp, Trello, Obsidian, office de agentes e
automações externas.

## Servidor local da ponte (9Router) — `bridge/server.mjs`

Para a ponte funcionar de ponta a ponta **neste PC**, o repositório traz um servidor
local pronto em `bridge/server.mjs`. Ele expõe exatamente as rotas que o Ares chama
e usa o **mesmo cérebro do Ares**: 9Router `cx/gpt-5.5` (em `http://localhost:20128`).
Sem dependências externas (só `node:http` + `fetch`), roda em Node ≥ 18.

Rotas:

- `GET /health` — status (serviço, modelo, 9Router).
- `POST /message` — comando geral, respondido pelo 9Router (quando o pedido exige
  WhatsApp/Trello/Obsidian de verdade, ele avisa que isso requer o Hermes Desktop
  completo ligado).
- `POST /code` — tarefa de programação ("Hermes Code") com resposta **estruturada**
  (`summary`, `patches`, `tests`, `risks`, `commands`, `needsConfirmation`).

### Rodar

```bash
nvm use            # Node do .nvmrc (qualquer Node >=18 serve para o bridge)
npm run bridge     # sobe em http://127.0.0.1:18789
```

Variáveis de ambiente (todas opcionais):

| Variável | Padrão | Função |
| --- | --- | --- |
| `ARES_BRIDGE_PORT` | `18789` | porta de escuta |
| `ARES_BRIDGE_HOST` | `127.0.0.1` | host de escuta |
| `NINEROUTER_BASE_URL` | `http://localhost:20128/v1` | endpoint do 9Router |
| `NINEROUTER_MODEL` | `cx/gpt-5.5` | modelo (o mesmo do Ares) |
| `NINEROUTER_API_KEY` | `` | chave do 9Router (local é keyless) |
| `ARES_BRIDGE_TOKEN` | `` | se definido, exige `Authorization: Bearer <token>` |

### Sempre ligado (systemd --user)

Há um unit pronto em `bridge/ares-bridge.service`. Para deixar a ponte **sempre no ar
neste PC** (sobe no login; com `linger` ligado, persiste sem sessão aberta):

```bash
install -D -m 644 bridge/ares-bridge.service ~/.config/systemd/user/ares-bridge.service
systemctl --user daemon-reload
systemctl --user enable --now ares-bridge.service
systemctl --user status ares-bridge.service     # conferir
curl -s http://127.0.0.1:18789/health           # testar
```

Parar / desligar de vez:

```bash
systemctl --user stop ares-bridge.service       # parar agora
systemctl --user disable --now ares-bridge.service  # não subir mais no boot
```

### ⚠️ Conflito com o Hermes Desktop na :18789

O Hermes Desktop completo (WhatsApp/Trello/Obsidian/office) também ocupa a **:18789**
e **não divide a porta** — subir os dois ali dá `adapter exited code 1` no Hermes
Desktop. Regra: **rode só um de cada vez na :18789.**

- Vai usar o **Hermes Desktop**? Pare a ponte local antes:
  `systemctl --user stop ares-bridge.service`. O Ares já aponta para `:18789` e passa
  a falar com o Hermes real (inclusive WhatsApp/Trello).
- Quer os **dois ao mesmo tempo**? Rode a ponte local em outra porta
  (`ARES_BRIDGE_PORT=18790`) — mas lembre que o Ares só aponta para **uma** `baseUrl`
  por vez (Configurações > Ponte com o Hermes).

O servidor já recusa subir com mensagem clara se a porta estiver ocupada (`EADDRINUSE`),
então não chega a derrubar nada por acidente.

## Configuração

A config real fica em `~/.config/ares/config.json`. O template está em
`config.example.json`.

```json
{
  "integrations": {
    "hermes": {
      "enabled": false,
      "baseUrl": "http://localhost:18789",
      "messagePath": "/message",
      "codePath": "/code",
      "healthPath": "/health",
      "apiKey": "",
      "authHeader": "Authorization",
      "timeoutMs": 4000,
      "responsePath": ""
    }
  }
}
```

Campos:

- `enabled`: liga/desliga a ponte.
- `baseUrl`: URL base do Hermes.
- `messagePath`: rota de comando chamada via `POST`.
- `codePath`: rota dedicada para tarefas de programação.
- `healthPath`: rota de status chamada via `GET`.
- `apiKey`: token opcional.
- `authHeader`: cabeçalho do token. Com `Authorization`, o Ares envia `Bearer <token>`.
- `timeoutMs`: tempo máximo de resposta.
- `responsePath`: caminho opcional da resposta, por exemplo `data.reply`.

## Contrato HTTP

Por padrão o Ares chama:

```http
POST /message
Content-Type: application/json
Authorization: Bearer <apiKey opcional>
```

Payload:

```json
{
  "message": "comando original",
  "text": "comando original",
  "command": "comando original",
  "source": "ares",
  "client": "ares-desktop",
  "sessionId": "id-da-conversa"
}
```

O Hermes pode responder com texto puro ou JSON. O Ares procura a resposta em:

- caminho configurado por `responsePath`;
- `reply`, `response`, `answer`, `text`, `message`, `content`;
- `data.reply`, `data.response`, `data.answer`, `data.text`, `data.message`, `data.content`;
- `result.reply`, `result.response`, `result.text`, `result.message`, `result.output`;
- `output` ou `result`.

## Roteamento no Agente

O prompt do Ares orienta o uso de `hermes.executar` quando o pedido envolve:

- WhatsApp;
- Trello;
- Obsidian;
- office de agentes;
- Pedro, Junim ou Maicom;
- automações já existentes no Hermes.

Pedidos locais continuam no Ares: tarefas, calendário, listas, lembretes, memória,
clima, notícias, web, sistema e área de transferência.

Para programação, o prompt usa `codigo.workspace`, `codigo.buscar`, `codigo.ler` e
`codigo.hermes`. A rota dedicada é `codePath`; se ela responder `404` ou `405`, o
Ares faz fallback para `messagePath` com um payload textual iniciado por
`[ARES_CODE_TASK]`. A execução local (testes, build, terminal completo via
`codigo.terminal`, Git) roda na máquina do usuário, fora da ponte; análise
profunda e edição é que são delegadas ao Hermes Code. Detalhes do terminal e do
fluxo de autorização em [`PROGRAMACAO.md`](PROGRAMACAO.md).

## Segurança

Para ações externas sensíveis, como enviar mensagem, publicar algo ou alterar Trello
/ Obsidian, o Ares só deve delegar quando destinatário, conteúdo e alvo estiverem
claros. Se faltar dado, ele pede confirmação em vez de chamar a ferramenta.

## Diagnóstico

Em Configurações > Ponte com o Hermes:

1. Ative a ponte.
2. Ajuste endpoint, rotas, token e `responsePath`.
3. Clique em **TESTAR PONTE**.

Na tela Sistema, o painel **Ponte · Hermes** mostra:

- estado ativado/desativado;
- online/indisponível;
- URL base;
- rota de comando;
- rota de código;
- rota de status;
- timeout.

## Testes

Verificação rápida:

```bash
npm test
```

Verificação completa antes de publicar:

```bash
npm run verify
```

A suíte `tests/hermes.test.ts` usa um servidor HTTP local e valida o **cliente**
(lado Ares):

- montagem de URL;
- extração de resposta;
- envio de comando com token e `sessionId`;
- rota/cabeçalho/`responsePath` configuráveis;
- rota dedicada do Hermes Code e fallback para `messagePath`;
- ping de saúde;
- ponte desativada sem tocar a rede.

A suíte `tests/bridge.test.ts` valida o **servidor** (`bridge/server.mjs`) com um
9Router falso (hermético, sem rede real):

- `/health` informa serviço e modelo;
- `/message` responde via 9Router com `{reply}`;
- `/code` devolve resposta estruturada (`summary`/`patches`/`tests`/...);
- `/code` faz fallback para `summary` quando o modelo não devolve JSON;
- tarefa de código vazia retorna HTTP 400.

## Troubleshooting

- `desativada nas Configurações`: ligue `integrations.hermes.enabled`.
- `offline / inacessível`: confirme se o Hermes está rodando e se `baseUrl` está correto.
- `respondeu HTTP 404`: ajuste `healthPath`, `messagePath` ou `codePath`.
- `Hermes respondeu sem texto útil`: configure `responsePath` para o campo correto.
- `HTTP 401/403`: confira `apiKey` e `authHeader`.
- `timeout`: aumente `timeoutMs` ou investigue o tempo de resposta do Hermes.
