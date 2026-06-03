# Ares - Assistente de IA pessoal

Ares é um app desktop local em Electron + React/Vite/TypeScript. Ele combina uma interface HUD futurista, orbe 3D reativa, voz neural local, conversa por texto/voz, Kanban, calendário, memória persistente e integrações externas sem login.

O projeto roda em modo de desenvolvimento. O empacotamento `.deb` está configurado para o futuro, mas não deve ser executado nesta etapa.

## Visão Geral

- Interface: React, Tailwind, Framer Motion e Three.js.
- Desktop: Electron com `preload` tipado e `contextIsolation`.
- Cérebro: 9 Router local, padrão `cx/gpt-5.5`.
- Transcrição: Groq Whisper.
- Voz: Piper neural local no Linux, com Chromium Web Speech como fallback.
- Dados: tudo persistido localmente em `~/.config/ares/`.
- Integrações: Open-Meteo, DuckDuckGo HTML, Google News RSS e Nominatim/OpenStreetMap para nome da localização.

## Rodar em Desenvolvimento

```bash
cd /home/acer/Documentos/Ares
npm install
npm run dev
```

Scripts úteis:

```bash
npx tsc --noEmit
npm run build
npm run dev
```

Não rode `npm run dist:deb` agora. Esse comando existe apenas para empacotamento futuro.

## Estrutura do Projeto

```text
src/
  main/       Processo principal Electron, IPC, config, persistência, agente e ferramentas
  preload/    Ponte segura window.ares para o renderer
  renderer/   Interface React, telas, componentes, áudio e TTS
  shared/     Tipos e protocolo JSON compartilhados
```

Arquivos importantes:

- `src/main/index.ts`: janela Electron, permissões, IPC e inicialização.
- `src/main/agent.ts`: prompt do Ares, protocolo de ações e execução de ferramentas.
- `src/main/tools.ts`: clima, busca web, notícias e geocodificação reversa.
- `src/renderer/lib/store.tsx`: estado global do app, conversa, voz, localização e widgets.
- `src/renderer/lib/audio.ts`: microfone, análise de nível de áudio e conversa contínua.
- `src/renderer/components/Orb3D.tsx`: núcleo visual 3D do Ares.
- `src/renderer/screens/Assistant.tsx`: palco principal da orbe, widgets e conversa.

## Configuração

A config real é criada no primeiro uso:

- Linux: `~/.config/ares/config.json`
- Windows: `%APPDATA%\ares\config.json`

Template de referência: `config.example.json`.

Campos principais:

| Campo | Uso |
| --- | --- |
| `nineRouter.baseUrl` | endpoint OpenAI-compatible do 9 Router |
| `nineRouter.model` | modelo do cérebro, padrão `cx/gpt-5.5` |
| `nineRouter.apiKey` | vazio para localhost |
| `grog.apiKey` | chave Groq para Whisper/STT |
| `tts.engine` | `auto`, `piper` ou `web` |
| `tts.piperVoice` | voz neural local Piper |
| `tts.webVoiceURI` | voz Chromium/Web Speech |
| `tts.rate`, `tts.pitch`, `tts.volume` | ajustes de fala |
| `integrations.weatherCity` | cidade padrão quando a localização não está disponível |
| `integrations.location.enabled` | ativa uso de localização aproximada |
| `integrations.location.latitude/longitude` | coordenadas salvas localmente após permissão |
| `ui.continuousMode` | mantém o modo de conversa contínua ativo entre reinícios |

## Voz e Conversa Contínua

O Ares usa Piper por padrão no Linux. Os arquivos ficam em:

```text
~/.config/ares/piper/
```

No painel Configurações você pode:

- ativar ou silenciar a fala;
- escolher Piper, Chromium ou automático;
- escolher voz Piper;
- escolher voz Chromium carregada pelo evento `voiceschanged`;
- ajustar velocidade, tom e volume;
- testar a voz.

O modo Conversa Contínua usa o microfone em ciclos:

1. prepara o microfone;
2. calibra o ruído ambiente por alguns frames;
3. espera fala sustentada;
4. encerra a gravação após silêncio real;
5. transcreve com Whisper;
6. envia ao agente;
7. espera o Ares terminar de falar;
8. volta a ouvir.

Essa calibração reduz falsos disparos e evita cortar frases curtas.

## Localização

O Ares pode usar a localização aproximada do computador para melhorar clima e contexto local.

Como funciona:

- o renderer pede permissão via `navigator.geolocation`;
- o Electron permite `geolocation`;
- as coordenadas são salvas apenas em `~/.config/ares/config.json`;
- `src/main/tools.ts` usa Nominatim/OpenStreetMap para transformar coordenadas em cidade/região;
- o clima usa Open-Meteo diretamente por latitude/longitude quando disponível;
- o prompt recebe uma linha curta com a localização aproximada, sem enviar histórico extra.

Você pode ativar/desativar e atualizar manualmente em Configurações > Integrações > Detectar agora.

Se a permissão for negada, o app continua funcionando com `integrations.weatherCity`.

## Assistente e Orbe

A tela Assistente tem:

- núcleo 3D central em Three.js;
- retículo HUD proporcional ao tamanho da janela;
- widgets de clima, agenda e tarefas;
- conversa lateral;
- controles de texto, push-to-talk e conversa contínua.

Estados visuais:

- `idle`: respiração leve;
- `listening`: reação ao nível real do microfone;
- `thinking`: rotação e deformação mais intensa;
- `speaking`: pulsos sincronizados com a fala.

## Kanban

Persistência:

```text
~/.config/ares/tasks.json
```

Recursos:

- colunas editáveis;
- cartões com título, descrição, cor, prioridade, prazo e lembrete;
- subtarefas com progresso;
- busca por título/descrição;
- filtros por cor, prazo e status;
- ordenação por prazo ou prioridade;
- drag and drop;
- notificação nativa Electron;
- aviso falado quando a voz está ativa.

Exemplos:

- "crie uma tarefa para comprar café";
- "adicione a subtarefa moer os grãos na tarefa comprar café";
- "mova comprar café para concluído";
- "defina um lembrete para comprar café hoje às 18h".

## Calendário

Persistência:

```text
~/.config/ares/calendar.json
```

Recursos:

- criar eventos com título, data/hora e descrição;
- listar eventos;
- remover eventos;
- mostrar eventos do dia na tela Assistente;
- notificar quando o horário chega.

Exemplos:

- "crie um evento reunião amanhã às 9h";
- "liste minha agenda de hoje";
- "remova o evento reunião".

## Memória e Histórico

Persistência:

```text
~/.config/ares/memory.json
~/.config/ares/sessions.json
```

Memória de longo prazo:

- fatos e preferências do usuário;
- tela editável;
- comandos como "Ares, lembre-se que prefiro respostas curtas";
- injeção resumida no prompt do LLM.

Sessões:

- criar nova conversa;
- abrir conversa antiga;
- renomear;
- apagar;
- resumir histórico longo para preservar contexto sem mandar tudo sempre.

## Integrações Externas

Sem chave:

- Clima: Open-Meteo.
- Geocodificação reversa: Nominatim/OpenStreetMap.
- Busca web: DuckDuckGo HTML.
- Notícias: Google News RSS.

Com chave:

- Transcrição de voz: Groq Whisper.
- Cérebro: depende da configuração do 9 Router local/remoto.

Tratamento de erros:

- sem internet;
- serviço fora do ar;
- cidade não encontrada;
- permissão de localização negada;
- microfone indisponível.

O app exibe mensagem amigável e, quando fizer sentido, fala o aviso.

## Protocolo JSON de Ações

O LLM deve responder com um único objeto JSON:

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

Ações de mutação:

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

Ferramentas de consulta:

- `clima.consultar`
- `web.buscar`
- `noticias.listar`
- `agenda.listar`
- `tarefa.listar`

As ferramentas de consulta são executadas pelo processo principal. O resultado volta ao LLM para gerar a resposta final em linguagem natural.

## Fluxo de Dados do Agente

1. Renderer chama `window.ares.chat.ask(sessionId, text)`.
2. Main carrega config, sessão, memória, calendário e Kanban.
3. Main monta prompt com ferramentas, contexto local, localização e resumo.
4. 9 Router retorna `{ fala, acoes }`.
5. Main executa consultas e mutações.
6. Main persiste dados locais.
7. Renderer atualiza UI e fala a resposta.

## Segurança e Privacidade

- Não há login.
- Não há cadastro.
- Dados ficam no disco local.
- Coordenadas só são salvas após permissão de geolocalização.
- Chave Groq e config real ficam fora do Git.
- `nodeIntegration` fica desativado no renderer.
- O renderer acessa Electron apenas por `window.ares`.

## Verificação Antes de Publicar

```bash
npx tsc --noEmit
npm run build
```

Para desenvolvimento visual:

```bash
npm run dev
```

## Empacotamento Futuro

O alvo configurado é `.deb`:

```bash
npm run dist:deb
```

Não use esse comando até a etapa de empacotamento ser solicitada.
