# Changelog

Todas as mudanças relevantes do Ares. O formato segue de perto
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e o projeto usa
versionamento semântico.

## [0.7.0] — 2026-06-06

Foco: dar ao Ares um **terminal de verdade** integrado ao modo programador, com
**autorização por voz** e uma persona técnica de engenheiro sênior.

### Adicionado

- **Terminal completo (`codigo.terminal`)** — executa comandos via shell real
  (`bash -lc`), com pipes, `&&`, `||` e redirecionamento. Não substitui a
  allowlist: complementa-a para "qualquer outro comando", sempre sob controle de
  segurança.
- **Classificação em três camadas (`classifyCommand`)**:
  - `allowed`: comandos da allowlist ou prefixos seguros (`terminalSafe`) rodam
    direto;
  - `confirm`: qualquer outro comando exige autorização explícita do usuário;
  - `blocked`: padrões catastróficos ou de elevação de privilégio (`sudo`/`su`,
    `rm -rf` de raiz/HOME, `mkfs`, `dd` em disco, `shutdown`/`reboot`, fork bomb,
    `curl … | sh`) nunca rodam, nem com autorização.
- **Fluxo de autorização por voz** — `codigo.terminal` sem `confirmado` devolve
  `requiresApproval` e guarda o comando como pendência da sessão
  (`src/main/pending.ts`, com expiração de 10 min). O Ares anuncia o comando e
  pede o "sim"; `codigo.confirmar` executa a pendência e `codigo.cancelar` a
  descarta.
- **Persona de programação** — em código, o Ares age como engenheiro sênior:
  técnico e claro, resume em vez de despejar logs/código, cita arquivo:linha e
  **pede autorização** antes de alterar o sistema, instalar dependências ou mexer
  no Git.
- **Configuração do terminal** — `terminalEnabled`, `terminalAutoApprove` e
  `terminalSafe` em `integrations.code`, com controles nas Configurações e estado
  na tela Sistema.

### Testes

- `tests/code.test.ts`: classificação allowed/confirm/blocked, autorização e
  execução pós-aprovação, bloqueio de comandos catastróficos mesmo aprovados,
  desligamento do terminal e store de pendências por sessão (25 testes no total).

## [0.6.0] — 2026-06-06

Foco: fechar o ciclo de programação com **patch preview**, comandos controlados,
índice persistente e resposta estruturada do Hermes Code.

### Adicionado

- **Contrato estruturado do Hermes Code** — respostas com `summary`, `patches`,
  `tests`, `risks`, `commands` ou `diff` são preservadas em `structured`, além da
  fala resumida.
- **Preview e aplicação segura de patches**:
  - `codigo.patch.preview` valida paths, conta adições/remoções e roda
    `git apply --check` quando recebe diff.
  - `codigo.patch.aplicar` aplica diff/text patch apenas quando
    `integrations.code.allowPatchApply` está ligado.
- **Comandos de desenvolvimento controlados** — `codigo.comando` executa só
  comandos presentes em `integrations.code.allowedCommands`, sem shell e com
  timeout.
- **Ferramentas Git locais** — `codigo.git` consulta `status`, `diff`, `diffStat`
  e `log` sem alterar o repositório.
- **Índice persistente de projeto** — `codigo.indexar` salva índice em
  `~/.config/ares/code-indexes/` com arquivos, linguagens, exports, scripts e Git.
- **Configuração avançada de programação** — allowlist de comandos, timeout,
  limite do índice e permissão explícita para aplicar patches.

### Testes

- `tests/code.test.ts`: comandos permitidos/bloqueados, Git, índice persistente e
  preview/aplicação de patch textual.
- `tests/hermes.test.ts`: preservação de resposta estruturada do Hermes Code.

## [0.5.0] — 2026-06-06

Foco: deixar o Ares muito mais forte para **programação**, com contexto local de
código e integração dedicada com o Hermes Code.

### Adicionado

- **Modo Programador no agente** — o prompt agora instrui o Ares a procurar,
  ler e citar arquivos/linhas antes de responder perguntas de código, reduzindo
  chute sobre implementações.
- **Ferramentas locais read-only de código**:
  - `codigo.workspace {path?}` resume stack, scripts, git, linguagens e árvore.
  - `codigo.buscar {path?, consulta, filtro?}` busca texto/símbolos em arquivos.
  - `codigo.ler {path?, arquivo, inicio?, linhas?}` lê trechos com números de linha.
- **Hermes Code** — nova ação `codigo.hermes` envia tarefa, modo, workspace e
  snippets ao Hermes pela rota configurável `integrations.hermes.codePath`
  (`/code` por padrão), com fallback automático para `/message` se a rota dedicada
  não existir.
- **Configurações de programação** — workspace padrão, raízes permitidas, limite de
  arquivo, resultados de busca e tamanho de contexto para Hermes.
- **Diagnóstico de programação** — tela Sistema mostra workspace, raízes, limites e
  rota Hermes Code.

### Segurança

- As ferramentas locais de código são somente leitura e bloqueiam caminhos fora de
  `integrations.code.allowedRoots`.
- Edição, refatoração, correção e análise profunda são delegadas ao Hermes Code com
  contexto limitado por `maxContextChars`.

### Documentação e Testes

- Novo guia [`docs/PROGRAMACAO.md`](docs/PROGRAMACAO.md).
- README, ROADMAP, `docs/PONTE_HERMES.md` e `config.example.json` atualizados.
- `tests/code.test.ts` cobre resumo de workspace, busca, leitura, bloqueio de path e
  delegação ao Hermes Code. A suíte total agora tem 13 testes.

## [0.4.0] — 2026-06-05

Foco: fechar a **ponte com o Hermes** para o Ares atuar como controle de voz/
desktop sem reimplementar o Hermes.

### Adicionado

- **Cliente Hermes configurável** — a ponte agora aceita rota de comando, rota de
  status, token opcional, cabeçalho de autenticação, timeout e caminho da resposta
  (`responsePath`). Continua compatível com o contrato simples `POST /message`.
- **Roteamento de intenção no agente** — o prompt orienta o Ares a delegar ao
  Hermes pedidos de WhatsApp, Trello, Obsidian, office de agentes e automações já
  existentes no Hermes, mantendo ações locais dentro do Ares.
- **Contexto de sessão para o Hermes** — chamadas `hermes.executar` enviam
  `sessionId`, `source: "ares"` e `client: "ares-desktop"` para o Hermes manter
  contexto do office.
- **Status do Hermes no diagnóstico** — a tela Sistema mostra se a ponte está
  ativada, online, endpoint, rotas e timeout.
- **Teste manual da ponte** — Configurações > Ponte com o Hermes ganhou o botão
  **TESTAR PONTE**.
- **Suíte unitária da ponte** — Vitest cobre montagem de URL, extração de resposta,
  POST com token/sessão, rotas configuráveis, ping e ponte desativada.

### Documentação

- Novo guia [`docs/PONTE_HERMES.md`](docs/PONTE_HERMES.md) com contrato HTTP,
  configuração, payload, formatos de resposta, diagnóstico e troubleshooting.
- README, ROADMAP, `config.example.json` e scripts de verificação atualizados.

### Técnico

- `src/main/hermes.ts` (novo): `hermesExecute()`, `pingHermes()`,
  `extractHermesReply()` e montagem segura de URL.
- `src/main/agent.ts`: ferramenta `hermes.executar` documentada no prompt e
  executada com config completa + sessão.
- `src/main/diagnostics.ts`, `src/renderer/screens/System.tsx` e
  `src/renderer/components/SettingsPanel.tsx`: status e teste da ponte.
- `package.json`: versão `0.4.0`, scripts `typecheck`, `test:unit`, `test` e
  `verify`.

## [0.3.0] — 2026-06-05

Foco: deixar o Ares **mais "JARVIS"** — consciente do próprio computador e do que
você acabou de copiar.

### Adicionado

- **Telemetria do sistema no HUD (estilo JARVIS)** — uso de **CPU**, **memória**
  (% e GB) e **tempo ligado** ao vivo no rodapé do palco do assistente
  (atualização a cada 3 s) e um painel **"Recursos do Sistema · ao vivo"** com
  barras de progresso na tela Sistema (CPU, memória, uptime, núcleos, carga,
  host). Valores ficam âmbar quando o uso está alto.
- **Ferramenta de voz `sistema.status`** — pergunte "Ares, como está o sistema?"
  ou "quanta memória está livre?" e ele responde a partir da telemetria real.
- **Consciência da área de transferência (`area.ler`)** — o Ares lê o texto que
  você copiou para **resumir, traduzir ou explicar**: "Ares, resuma o que eu
  copiei", "traduza o que está na área de transferência". Tudo local.

### Técnico

- `src/main/system.ts` (novo): `getSystemMetrics()` (amostragem de CPU via `os`,
  memória, uptime, carga) e `readClipboard()` (Electron `clipboard`).
- IPC `metrics:get` e `clipboard:read`; preload `system.metrics()` /
  `system.readClipboard()`.
- `src/shared/protocol.ts`: `sistema.status` e `area.ler` em `QUERY_TOOLS`.
- `src/main/agent.ts`: roteamento das duas novas ferramentas.
- `src/shared/types.ts`: tipo `SystemMetrics`.
- `src/renderer/lib/store.tsx`: polling de telemetria (3 s) exposto como `metrics`.
- HUD em `screens/Assistant.tsx` e painel em `screens/System.tsx`.

## [0.2.0] — 2026-06-05

Foco: deixar o Ares **mais inteligente, mais natural na voz e mais rápido de
navegar**, com documentação completa.

### Adicionado

- **Busca global (paleta de comandos, `Ctrl+K`)** — uma barra de busca única que
  varre tarefas, agenda, lembretes, notas, itens de listas, memória e conversas;
  navega direto para a tela certa, abre uma conversa antiga, dispara o briefing
  ou as configurações e, com qualquer texto, encaminha a pergunta ao Ares
  ("Perguntar ao Ares: …"). Navegação por teclado (↑/↓/↵/esc) e botão **Buscar**
  na barra lateral. Novo componente `src/renderer/components/CommandPalette.tsx`.
- **Barge-in (interromper a fala)** — na conversa contínua, basta começar a falar
  por cima para o Ares parar de falar na hora e voltar a ouvir. A tecla **Esc**
  interrompe a fala a qualquer momento (barge-in manual). Configurável em
  Configurações > Conversa Contínua (`ui.bargeIn`, ligado por padrão).
- **Conversão de unidades local (`converter.unidade`)** — comprimento, massa,
  volume, área, velocidade, tempo, dados e temperatura, tudo offline e sem chave
  ("quantos quilômetros são 10 milhas?", "30 graus Celsius em Fahrenheit").
- **Leitura/resumo de página web (`pagina.ler`)** — o Ares abre uma URL, extrai o
  texto legível e responde/resume a partir do conteúdo real da página.

### Melhorado

- **Microfone com cancelamento de eco** (`echoCancellation`, `noiseSuppression`,
  `autoGainControl`) — capta melhor e torna o barge-in confiável (a própria voz
  do Ares some do microfone).
- **Prompt mais consciente** — o agente recebe o período do dia (madrugada/manhã/
  tarde/noite) e instruções para saudar de forma coerente.

### Técnico

- `src/main/tools.ts`: `convertUnit()` e `readPage()`.
- `src/shared/protocol.ts`: `converter.unidade` e `pagina.ler` em `QUERY_TOOLS`.
- `src/main/agent.ts`: roteamento das novas ferramentas + período do dia no prompt.
- `src/renderer/lib/audio.ts`: `watchForSpeech()` (detector de barge-in) e
  restrições de áudio do `getUserMedia`.
- `src/renderer/lib/store.tsx`: `waitForSpeechWithBargeIn()`, `stopSpeaking()`,
  estado/ações da paleta (`paletteOpen`/`openPalette`) e atalho Esc.
- Config: novo campo `ui.bargeIn`.

## [0.1.0]

- Primeira versão pública do Ares: HUD futurista, orbe 3D, voz neural local
  (Piper) com fallback Web Speech, STT Groq/Whisper, streaming de fala por
  sentença, wake word "Ares", orbe flutuante, Kanban, calendário, lembretes/
  timers/despertador, listas e notas, memória inteligente por categoria,
  briefing do dia, diagnóstico de sistema, onboarding, acessibilidade, backup,
  atalho global, bandeja e groundwork da ponte com o Hermes.
