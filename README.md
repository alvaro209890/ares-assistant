# Ares - Assistente de IA pessoal

Ares é um app desktop local em Electron + React/Vite/TypeScript. Ele combina uma interface HUD futurista, orbe 3D reativa, voz neural local, conversa por texto/voz, Kanban, calendário, memória persistente inteligente, briefing do dia, diagnóstico do sistema e integrações externas sem login.

O projeto roda em modo de desenvolvimento. O empacotamento `.deb` está configurado para o futuro, mas não deve ser executado nesta etapa.

## Visão Geral

- Interface: React, Tailwind, Framer Motion e Three.js.
- Desktop: Electron com `preload` tipado e `contextIsolation`.
- Cérebro: 9 Router local, padrão `cx/gpt-5.5`.
- Transcrição: Groq Whisper.
- Voz: Piper neural local no Linux, com Chromium Web Speech como fallback.
- Dados: tudo persistido localmente em `~/.config/ares/`.
- Integrações: Open-Meteo, DuckDuckGo HTML, Google News RSS e Nominatim/OpenStreetMap para nome da localização.

### O que há de novo

- **Agente mais esperto**: prompt com resolução de datas relativas (hoje, amanhã, semana que vem, daqui a 2 horas), respostas mais curtas quando a voz está ativa, validação forte das ações JSON e melhor decisão entre agir e só responder.
- **Memória inteligente**: categorias (perfil, preferências, rotina, trabalho, projetos, restrições, interesses), auto-extração de fatos da conversa, fila de revisão antes de salvar, atualização de fatos antigos em vez de duplicar e resumo compacto injetado no prompt.
- **Clima detalhado**: previsão por período (manhã/tarde/noite), sensação térmica, chuva, vento, umidade, alerta simples e horário/fonte da última atualização.
- **Briefing do dia**: painel e comando de voz com clima, agenda, tarefas vencidas/próximas, lembretes, notícias e sugestões proativas discretas.
- **Kanban e calendário**: etiquetas nomeadas, links/anexos locais, tarefas e eventos recorrentes, lembrete configurável antes do evento, visões “Hoje”, “Vencidas”, “Próximos 7 dias” e agenda por dia/semana.
- **Conversa contínua melhor**: sensibilidade do microfone, tempo de silêncio e pausa pós-fala configuráveis (evita que o Ares escute a própria voz).
- **Tela Sistema/Diagnóstico**: status do 9 Router, Groq, Piper, localização, arquivos de dados locais e versões do app.

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
- `src/main/agent.ts`: prompt do Ares, datas relativas, validação, execução de ferramentas e auto-extração de memória.
- `src/main/tools.ts`: clima (com períodos/alerta), busca web, notícias e geocodificação reversa.
- `src/main/briefing.ts`: monta o briefing do dia e sua versão falável.
- `src/main/diagnostics.ts`: status de serviços, localização e arquivos de dados.
- `src/main/data.ts`: memória (categorias, dedupe, resumo), calendário e sessões.
- `src/shared/protocol.ts`: parsing do envelope JSON e validação de ações.
- `src/renderer/lib/store.tsx`: estado global do app, conversa, voz, localização, briefing e widgets.
- `src/renderer/lib/audio.ts`: microfone, análise de nível de áudio e conversa contínua.
- `src/renderer/components/Orb3D.tsx`: núcleo visual 3D do Ares.
- `src/renderer/components/BriefingPanel.tsx`: painel do briefing do dia.
- `src/renderer/screens/Assistant.tsx`: palco principal da orbe, widgets e conversa.
- `src/renderer/screens/System.tsx`: tela de diagnóstico do sistema.

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
| `ui.micSensitivity` | 0..1 — quanto maior, mais sensível o microfone na conversa contínua |
| `ui.silenceMs` | tempo de silêncio (ms) para encerrar a fala no modo contínuo |
| `ui.postSpeechPauseMs` | pausa após o Ares falar antes de voltar a ouvir |
| `ui.proactiveSuggestions` | liga as sugestões proativas no briefing |
| `memory.autoExtract` | extrair fatos úteis da conversa automaticamente |
| `memory.autoApprove` | `true` salva direto; `false` deixa o fato pendente para revisão |

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
- testar a voz;
- ajustar a **sensibilidade do microfone**, o **tempo de silêncio** para encerrar a fala e a **pausa após o Ares falar**.

O modo Conversa Contínua usa o microfone em ciclos:

1. prepara o microfone;
2. calibra o ruído ambiente por alguns frames;
3. espera fala sustentada (limiar derivado da sensibilidade configurada);
4. encerra a gravação após silêncio real (`ui.silenceMs`);
5. transcreve com Whisper;
6. envia ao agente;
7. espera o Ares terminar de falar;
8. faz uma pausa curta (`ui.postSpeechPauseMs`) para não escutar a própria voz;
9. volta a ouvir.

Essa calibração reduz falsos disparos, evita cortar frases curtas e impede que o Ares responda ao próprio áudio. Os estados aparecem na orbe e no indicador: ouvindo, pensando, falando e em pausa.

## Localização

O Ares pode usar a localização aproximada do computador para melhorar clima e contexto local.

Como funciona:

- o renderer pede permissão via `navigator.geolocation`;
- o Electron permite `geolocation`;
- as coordenadas são salvas apenas em `~/.config/ares/config.json`;
- `src/main/tools.ts` usa Nominatim/OpenStreetMap para transformar coordenadas em cidade/região;
- o clima usa Open-Meteo diretamente por latitude/longitude quando disponível;
- o prompt recebe apenas uma linha curta com a localização aproximada (sem enviar histórico extra ao LLM).

Você pode ativar/desativar e atualizar manualmente em Configurações > Integrações > Detectar agora.

Se a permissão for negada, o app continua funcionando com `integrations.weatherCity` e avisa de forma amigável.

### Clima

O clima (Open-Meteo) traz:

- temperatura atual e **sensação térmica**;
- **umidade**, **vento** e **probabilidade de chuva** atual e do dia;
- **previsão por período**: manhã, tarde e noite (temperatura e chance de chuva);
- **alerta simples** (chuva forte, tempestade, vento, calor ou frio extremo);
- **fonte e horário** da última atualização.

O widget de clima na tela Assistente mostra um ponto âmbar quando há alerta. Perguntas como “vai chover hoje?”, “preciso levar guarda-chuva?” ou “como está o tempo onde estou?” são respondidas usando a ferramenta `clima.consultar` com a sua localização.

## Briefing do Dia

O botão **☀ BRIEFING** na tela Assistente (ou o comando de voz “Ares, faça meu briefing”) abre um resumo do dia:

- clima e previsão por período;
- eventos de hoje;
- tarefas vencidas;
- próximas tarefas (7 dias);
- lembretes;
- principais notícias;
- sugestões proativas discretas (tarefa vencida, evento próximo, previsão de chuva, conflito de agenda).

As sugestões podem ser desligadas em Configurações > Proatividade (`ui.proactiveSuggestions`). Por voz, o Ares fala uma versão curta do briefing.

## Sistema / Diagnóstico

A aba **Sistema** (`Alt+5`) mostra o status local do Ares:

- 9 Router: online/indisponível, URL e modelo (faz um ping curto a `/models`);
- Groq: chave configurada ou não;
- Piper: pronto e vozes disponíveis;
- localização: estado e última atualização;
- aplicativo: nome, versão, plataforma e versões de Electron/Node/Chrome;
- dados locais: pasta `userData` e tamanho de cada arquivo (`config.json`, `tasks.json`, `memory.json`, `calendar.json`, `sessions.json`).

Use o botão ATUALIZAR para refazer o diagnóstico.

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

## Navegação e Scroll

O app usa um dock lateral fixo para evitar que a navegação dispute espaço vertical com o conteúdo. A área principal é a única região de scroll da janela, e listas internas usam scroll próprio apenas quando necessário.

Atalhos:

- `Alt+1`: Assistente.
- `Alt+2`: Tarefas.
- `Alt+3`: Calendário.
- `Alt+4`: Memória.
- `Alt+5`: Sistema (diagnóstico).

As telas foram estruturadas com `min-h-0`, `overflow-y-auto` e `overscroll-contain` para evitar travamento de rolagem dentro do Electron. O Kanban mantém rolagem horizontal própria para colunas e rolagem vertical por coluna para cartões.

## Kanban

Persistência:

```text
~/.config/ares/tasks.json
```

Recursos:

- colunas editáveis;
- cartões com título, descrição, cor, prioridade, prazo e lembrete;
- **etiquetas nomeadas** (texto livre, separadas por vírgula);
- **links/anexos locais** (http(s):// ou file://, abrem no app padrão do sistema);
- **tarefas recorrentes** (diária/semanal/mensal): ao concluir, a próxima ocorrência é criada automaticamente;
- subtarefas com progresso;
- busca por título, descrição ou etiqueta;
- filtros por cor, etiqueta, prazo e status;
- **visões rápidas**: Todas, Hoje, Vencidas, Próximos 7 dias;
- ordenação por prazo ou prioridade;
- drag and drop;
- notificação nativa Electron;
- aviso falado quando a voz está ativa.

Exemplos:

- "crie uma tarefa para comprar café";
- "adicione a subtarefa moer os grãos na tarefa comprar café";
- "mova comprar café para concluído";
- "defina um lembrete para comprar café hoje às 18h";
- "crie uma tarefa semanal de regar as plantas toda segunda";
- "marque a tarefa academia com a etiqueta saúde".

## Calendário

Persistência:

```text
~/.config/ares/calendar.json
```

Recursos:

- criar eventos com título, data/hora e descrição;
- **eventos recorrentes** (diário/semanal/mensal): ao disparar, o evento é reagendado para a próxima ocorrência;
- **lembrete configurável antes do evento** (na hora, 5/10/15/30 min, 1 h, 1 dia);
- **agenda por dia** (eventos agrupados por data) e **visões** Todos, Hoje, Semana;
- listar e remover eventos;
- mostrar eventos do dia na tela Assistente e no briefing;
- notificar quando o horário (ou o aviso antecipado) chega.

Exemplos:

- "crie um evento reunião amanhã às 9h";
- "o que tenho amanhã?";
- "marque reunião toda segunda às 9";
- "me avise 15 minutos antes";
- "liste minha agenda de hoje";
- "remova o evento reunião".

> A arquitetura de calendário já está preparada para uma futura integração externa (ex.: Google Calendar), mas nenhuma integração externa está ativa nesta etapa.

## Memória e Histórico

Persistência:

```text
~/.config/ares/memory.json
~/.config/ares/sessions.json
```

Memória de longo prazo:

- fatos e preferências do usuário, organizados por **categoria** (perfil, preferências, rotina, trabalho, projetos, restrições, interesses, outros);
- **tela editável**: trocar a categoria de cada fato, editar o texto (duplo clique) e remover;
- **auto-extração**: o Ares identifica fatos duradouros na conversa e os classifica (`memory.autoExtract`);
- **revisão antes de salvar**: com `memory.autoApprove` desligado, os fatos extraídos ficam em “Para revisar” e você Salva ou Descarta;
- **sem duplicar**: fatos parecidos atualizam o existente em vez de criar outro; um fato automático nunca sobrescreve um fato manual já confirmado;
- comandos como "Ares, lembre-se que prefiro respostas curtas";
- **resumo compacto por categoria** injetado no prompt do LLM, respeitando um limite de contexto.

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

Ações de mutação (campos principais entre chaves):

- `tarefa.criar` `{titulo, coluna?, descricao?, prioridade?, cor?, prazo?(ISO), lembrete?(ISO), etiquetas?([]), repetir?(none|daily|weekly|monthly), subtarefas?([])}`
- `tarefa.mover` `{titulo, paraColuna}`
- `tarefa.concluir` `{titulo}` · `tarefa.reabrir` `{titulo}` · `tarefa.remover` `{titulo}`
- `tarefa.editar` `{titulo, novoTitulo?, descricao?, prioridade?, cor?, prazo?, etiquetas?, repetir?}`
- `tarefa.subtarefa.adicionar` `{titulo, item}` · `tarefa.subtarefa.concluir` `{titulo, item}`
- `tarefa.lembrete.definir` `{titulo, quando(ISO)}`
- `coluna.criar` `{titulo}` · `coluna.renomear` `{titulo, novoTitulo}` · `coluna.remover` `{titulo}`
- `memoria.salvar` `{fato, categoria?}` · `memoria.remover` `{fato}`
- `evento.criar` `{titulo, quando(ISO), descricao?, lembreteMin?(min antes), repetir?}` · `evento.remover` `{titulo}`

Ferramentas de consulta:

- `clima.consultar` `{cidade?}`
- `web.buscar` `{consulta}`
- `noticias.listar` `{tema?}`
- `agenda.listar` `{dia?(ISO date)}`
- `tarefa.listar` `{}`
- `briefing.consultar` `{}`

As ferramentas de consulta são executadas pelo processo principal. O resultado volta ao LLM para gerar a resposta final em linguagem natural.

### Validação de ações

O processo principal valida cada ação antes de aplicar: o tipo precisa ser conhecido e os campos obrigatórios precisam estar presentes (ver `MUTATION_REQUIRED` em `src/shared/protocol.ts`). Ações inválidas ou incompletas são descartadas com segurança e geram uma nota curta (toast) em vez de quebrar o turno. Datas devem ser ISO local sem fuso (ex.: `2026-06-03T09:00`); a seção DATAS do prompt fornece as âncoras de “hoje”, “amanhã” e “semana que vem”.

## Fluxo de Dados do Agente

1. Renderer chama `window.ares.chat.ask(sessionId, text)`.
2. Main carrega config, sessão, memória, calendário e Kanban.
3. Main monta prompt com ferramentas, contexto local, localização e resumo.
4. 9 Router retorna `{ fala, acoes }`.
5. Main executa consultas e mutações.
6. Main persiste dados locais.
7. Renderer atualiza UI e fala a resposta.

## Comandos por Voz (exemplos)

- "faça meu briefing" / "como está meu dia?"
- "vai chover hoje?" / "preciso levar guarda-chuva?" / "como está o tempo onde estou?"
- "o que tenho amanhã?" / "marque reunião toda segunda às 9" / "me avise 15 minutos antes"
- "crie uma tarefa semanal de regar as plantas" / "mova comprar café para concluído"
- "lembre-se que prefiro respostas curtas" / "anote que trabalho com fotografia"
- "quais as notícias de hoje?" / "pesquise na web sobre ..."

## Segurança e Privacidade

- Não há login.
- Não há cadastro.
- Dados ficam no disco local em `~/.config/ares/`.
- Coordenadas só são salvas após permissão de geolocalização; ao LLM vai apenas um resumo curto da localização.
- A auto-extração de memória é local e respeita `memory.autoExtract`; com `memory.autoApprove` desligado, nada é salvo sem você revisar.
- Chave Groq e config real ficam fora do Git.
- `contextIsolation` ligado e `nodeIntegration` desativado no renderer.
- O renderer acessa Electron apenas por `window.ares` (IPC tipado no preload); chaves nunca são expostas ao renderer.

## Migração de Dados

Os arquivos locais antigos continuam funcionando. Campos novos são preenchidos com padrões na leitura:

- memória antiga (sem categoria/origem/status) é normalizada para `categoria: outros`, `origem: manual`, `status: active`;
- configs antigas ganham os novos campos de `ui.*` e `memory.*` via merge profundo com os padrões;
- tarefas e eventos sem etiquetas/recorrência/lembrete-antes seguem válidos (campos opcionais).

## Troubleshooting

- **“Não consegui falar com o cérebro (9 Router)”**: confira em Sistema se o 9 Router está online e a URL/modelo em Configurações > Cérebro.
- **Voz não sai**: veja em Sistema se o Piper está pronto; senão o Ares usa Web Speech do Chromium. No Linux o Piper é baixado em segundo plano no primeiro uso.
- **Microfone corta a fala ou dispara sozinho**: ajuste em Configurações > Conversa Contínua a sensibilidade do microfone e o tempo de silêncio.
- **STT não transcreve**: confira a chave Groq em Configurações > Transcrição (ou em Sistema).
- **Sem clima/notícias/localização**: precisa de internet; o app mostra um aviso amigável e segue funcionando com a cidade padrão.
- **Fatos demais ou de menos na memória**: ajuste `memory.autoExtract`/`memory.autoApprove` e use a fila “Para revisar”.

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
