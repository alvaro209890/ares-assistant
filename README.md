# Ares — Assistente de IA pessoal

App desktop Electron + React/Vite/TypeScript com visual HUD futurista, orbe 3D,
voz, tarefas Kanban, memória persistente e integrações locais/externas.

Esta etapa roda apenas em modo de desenvolvimento. Não empacote agora.
O `electron-builder` permanece configurado para `.deb` futuro, mas não é usado no fluxo abaixo.

## Rodar em desenvolvimento

```bash
cd /home/acer/Documentos/Ares
npm install
npm run dev
```

Pré-requisitos:

- Node.js 18+.
- 9 Router local em `http://localhost:20128/v1`, modelo `cx/gpt-5.5`.
- Chave Groq para transcrição Whisper, detectada automaticamente quando existir em `~/.config/saldopro/backend.env`.

## Voz

O Ares usa Piper neural local no Linux por padrão (`tts.engine: "auto"`), com Web Speech/Chromium como fallback.
O painel Configurações permite:

- ativar/desativar fala;
- escolher motor: automático, Piper ou Chromium;
- selecionar voz Piper instalada;
- selecionar voz Chromium carregada via `voiceschanged`;
- ajustar velocidade, tom e volume;
- testar a voz.

No Linux, os arquivos do Piper ficam em `~/.config/ares/piper/`. A voz padrão é `pt_BR-faber-medium`.

## Tarefas / Kanban

A tela Tarefas salva tudo em `~/.config/ares/tasks.json`.

Recursos:

- colunas editáveis;
- cartões com título, descrição, etiqueta de cor, prioridade, prazo e lembrete;
- subtarefas com progresso;
- busca por título/descrição;
- filtros por cor, prazo e status;
- ordenação por prazo ou prioridade;
- arrastar cartões entre colunas;
- notificação nativa Electron quando um lembrete chega;
- fala curta do Ares no lembrete quando a voz está ativa.

Também funciona por voz/texto:

- “crie uma tarefa para comprar café”;
- “adicione a subtarefa moer os grãos na tarefa comprar café”;
- “mova comprar café para concluído”;
- “defina um lembrete para comprar café hoje às 18h”.

## Memória e conversas

Persistência local em `~/.config/ares/`:

- `sessions.json`: histórico e sessões de conversa;
- `memory.json`: fatos/preferências de longo prazo;
- `calendar.json`: agenda local.

Na tela Memória você pode:

- abrir conversas antigas;
- criar nova conversa;
- renomear/apagar sessões;
- ver, adicionar e remover fatos da memória.

Comandos como “Ares, lembre-se que prefiro respostas curtas” salvam fatos automaticamente.
O Ares injeta os fatos e um resumo do histórico longo no prompt para manter contexto sem enviar tudo sempre.

## Calendário local

A tela Calendário cria, lista e remove eventos locais com título, data/hora e descrição.
Eventos do dia aparecem no Assistente. Eventos vencidos disparam notificação nativa e fala curta, como os lembretes de tarefas.

Também funciona por voz/texto:

- “crie um evento reunião amanhã às 9h”;
- “liste minha agenda de hoje”;
- “remova o evento reunião”.

## Integrações

As integrações atuais não exigem chave:

- Clima: Open-Meteo.
- Busca web: DuckDuckGo HTML.
- Notícias: Google News RSS em pt-BR.

Exemplos:

- “como está o tempo em São Paulo?”;
- “busque na web a versão mais recente do Electron”;
- “quais as notícias de hoje?”.

Erros de internet, cidade não encontrada ou serviço fora do ar aparecem de forma amigável no app e podem ser falados se a voz estiver ativa.

## Configuração

A config real é criada no primeiro uso:

- Linux: `~/.config/ares/config.json`
- Windows: `%APPDATA%\ares\config.json`

Template: `config.example.json`.

Campos principais:

| Campo | Uso |
| --- | --- |
| `nineRouter.baseUrl` | endpoint OpenAI-compatible do 9 Router |
| `nineRouter.model` | modelo do cérebro, padrão `cx/gpt-5.5` |
| `nineRouter.apiKey` | vazio para localhost |
| `grog.apiKey` | chave Groq para Whisper |
| `tts.engine` | `auto`, `piper` ou `web` |
| `tts.piperVoice` | voz neural local |
| `tts.webVoiceURI` | voz Chromium/Web Speech |
| `tts.rate`, `tts.pitch`, `tts.volume` | ajustes da fala |
| `integrations.weatherCity` | cidade padrão do widget de clima |
| `integrations.newsTopic` | tema padrão de notícias |

## Protocolo JSON de ações

O LLM deve responder sempre com um único objeto JSON:

```json
{
  "fala": "Tarefa criada, senhor.",
  "acoes": [
    {
      "tipo": "tarefa.criar",
      "coluna": "A Fazer",
      "titulo": "comprar café",
      "prioridade": "media"
    }
  ]
}
```

Sem ação:

```json
{ "fala": "Estou aqui, senhor.", "acoes": [] }
```

Ações disponíveis:

- `tarefa.criar`
- `tarefa.mover`
- `tarefa.concluir`
- `tarefa.reabrir`
- `tarefa.remover`
- `tarefa.editar`
- `tarefa.subtarefa.adicionar`
- `tarefa.subtarefa.concluir`
- `tarefa.lembrete.definir`
- `coluna.criar`
- `coluna.renomear`
- `coluna.remover`
- `memoria.salvar`
- `memoria.remover`
- `evento.criar`
- `evento.remover`
- `clima.consultar`
- `web.buscar`
- `noticias.listar`
- `agenda.listar`
- `tarefa.listar`

Ferramentas de consulta (`clima.consultar`, `web.buscar`, `noticias.listar`, `agenda.listar`, `tarefa.listar`) são executadas pelo app e reenviadas ao LLM para a resposta final.

## Verificação rápida

```bash
npx tsc --noEmit
npm run dev
```

Não rode `npm run dist:deb` nesta etapa.

## Empacotamento futuro

Quando for solicitado, o alvo configurado é `.deb`:

```bash
npm run dist:deb
```
