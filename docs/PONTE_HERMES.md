# Ponte com o Hermes

Este documento descreve a integração em que o Ares funciona como controle de voz e
desktop do Hermes. A ideia é preservar a qualidade do Hermes, delegando a ele o que
já é responsabilidade dele: WhatsApp, Trello, Obsidian, office de agentes e
automações externas.

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

A suíte `tests/hermes.test.ts` usa um servidor HTTP local e valida:

- montagem de URL;
- extração de resposta;
- envio de comando com token e `sessionId`;
- rota/cabeçalho/`responsePath` configuráveis;
- rota dedicada do Hermes Code e fallback para `messagePath`;
- ping de saúde;
- ponte desativada sem tocar a rede.

## Troubleshooting

- `desativada nas Configurações`: ligue `integrations.hermes.enabled`.
- `offline / inacessível`: confirme se o Hermes está rodando e se `baseUrl` está correto.
- `respondeu HTTP 404`: ajuste `healthPath`, `messagePath` ou `codePath`.
- `Hermes respondeu sem texto útil`: configure `responsePath` para o campo correto.
- `HTTP 401/403`: confira `apiKey` e `authHeader`.
- `timeout`: aumente `timeoutMs` ou investigue o tempo de resposta do Hermes.
