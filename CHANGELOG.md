# Changelog

Todas as mudanças relevantes do Ares. O formato segue de perto
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e o projeto usa
versionamento semântico.

## [0.18.0] — 2026-06-08

Foco: **primeira execução obrigatória**, voz mais natural no Windows e DeepSeek V4.

### Adicionado

- **Setup obrigatório no primeiro uso** — o onboarding não pode mais ser pulado:
  exige chave Groq `gsk_...`, estado, cidade e um provedor de IA válido antes de
  liberar o app.
- **DeepSeek V4** — o preset DeepSeek agora oferece somente os modelos oficiais
  atuais `deepseek-v4-flash` e `deepseek-v4-pro`, com seletor fechado na UI.
- **Voz Windows menos robótica** — Web Speech prioriza vozes pt-BR
  Natural/Neural/Microsoft quando disponíveis, com velocidade e tom padrão mais
  naturais (`rate=0.92`, `pitch=1.04`).
- **Instalador Windows reseta configurações antigas** — o NSIS apaga
  `%APPDATA%\ares\config.json` e o marcador de reset durante instalação/atualização.
  Ao abrir, o Ares recria a config e força o setup obrigatório.

### Corrigido

- **Local manual no prompt** — cidade/UF selecionadas manualmente passam a entrar
  no contexto do agente mesmo sem coordenadas de geolocalização.

## [0.17.0] — 2026-06-08

Foco: **instalação multiplataforma** e localização com consentimento claro.

### Adicionado

- **Instaladores Linux e Windows** — `electron-builder.yml` agora configura Linux
  (`.deb` + AppImage) e Windows (NSIS `.exe`). Novos scripts: `dist:linux`,
  `dist:win` e `dist:all`, mantendo `dist:deb`.
- **Workflow Build Installers** — `.github/workflows/build-installers.yml` gera
  os artefatos em runners nativos do GitHub (Linux e Windows) em push no `main`,
  release publicada ou execução manual.
- **Localização no 1º uso** — o onboarding pede autorização explicitamente antes
  de chamar `navigator.geolocation`; a pessoa pode aceitar ou seguir com a cidade
  padrão.
- **Configurações > Localização** — seção própria para ativar/desativar a
  localização aproximada, detectar novamente e ajustar a cidade de fallback do
  clima.

### Corrigido

- **Defaults Windows/Linux** — workspace padrão e pasta de capturas usam a pasta
  existente do sistema (`Documents`/`Pictures` no Windows, `Documentos`/`Imagens`
  no Linux pt-BR quando existirem), em vez de caminhos fixos de Linux.
- **Caminhos de código no Windows** — resultados de workspace, busca, leitura,
  índice e escrita agora expõem caminhos relativos com `/`, inclusive em Windows,
  evitando payloads inconsistentes para UI, testes e Hermes.
- **Sem prompt automático escondido** — o app não tenta detectar localização em
  segundo plano só porque `location.enabled` está ativo sem coordenadas.

## [0.16.1] — 2026-06-08

### Corrigido

- **Chave Groq compartilhada com o STT** — ao escolher **Groq** como provedor do
  cérebro, a mesma chave `gsk_` passa a abastecer também a transcrição de voz
  (`updateConfig` em `src/main/config.ts`), desde que o STT ainda não tenha chave.
  Num PC novo, o microfone funciona sem colar a chave duas vezes.

## [0.16.0] — 2026-06-08

Foco: **portabilidade do cérebro** — o Ares deixa de depender do 9Router local e
passa a escolher um provedor de IA na nuvem no 1º uso, com login ou chave própria.
Instalar em outro PC não precisa de Hermes (a ponte sempre foi opcional).

### Adicionado

- **Aba "Provedor de IA (Cérebro)"** — `src/renderer/components/ProviderConfig.tsx`,
  reutilizada nas Configurações e no onboarding. Seletor de presets que troca
  `baseUrl` + modelo + chave de uma vez. Presets em `src/shared/providers.ts`:
  **DeepSeek, Groq (grátis), OpenRouter, OpenAI** e **Local (9 Router)**.
- **Login OAuth do OpenRouter (PKCE)** — `src/main/oauth.ts`: o botão *Entrar com
  OpenRouter* abre o navegador, sobe um callback efêmero em `127.0.0.1`, troca o
  code pela API key (S256) e grava no app — sem digitar chave. IPC `provider:oauth`.
- **Passo de provedor no onboarding** — `Onboarding.tsx` ganhou uma etapa para
  escolher o cérebro (login ou chave) e **testar a conexão** antes de concluir.
- **Atalho "pegar chave →"** abre a página de chaves do provedor no navegador.

### Observação

- O cliente LLM (`ninerouter.ts`) já era compatível com OpenAI, então todos os
  provedores funcionam sem mudança no caminho de chat. **OAuth com conta da OpenAI
  não existe** (login do ChatGPT ≠ acesso à API); o OpenRouter é o caminho legítimo
  de "login → chave".
- `tests/providers.test.ts`: detecção de provedor por host, presets e regras de
  OAuth/chave. Total: 104 testes.

## [0.15.0] — 2026-06-06

Foco: **autonomia em programação** — o Ares deixa de fazer um passo por vez e passa
a executar uma tarefa de código inteira sozinho.

### Adicionado

- **Coder autônomo (`codigo.projeto {objetivo, path?, passos?}`)** —
  `src/main/coder.ts`: um laço de agente que **planeja → escreve arquivos → roda
  checagens seguras → vê o resultado → itera** (até 8 passos), com o mesmo cérebro
  (9Router). Peças puras/testáveis: `parseCoderStep` (parse robusto) e
  `applyCoderStep` (escreve/roda).
- **Mesmas barreiras de segurança** — escrita só com `allowPatchApply` e dentro de
  `allowedRoots`; roda **apenas comandos da camada segura** (allowlist/seguros);
  instalar dependências / comandos que pedem autorização são pulados; destrutivos
  bloqueados; caminhos para fora da raiz recusados.
- **Roteamento** — o prompt usa `codigo.scaffold` para modelos simples e
  `codigo.projeto` para algo com lógica/vários arquivos.

### Testado de ponta a ponta

- O coder autônomo **construiu sozinho um jogo da velha jogável** (HTML/CSS/JS, com
  placar de vitórias, empates e botões de reiniciar/zerar) na Área de Trabalho, em
  **um único passo**, e a página foi **servida com HTTP 200**.
- `tests/coder.test.ts`: `parseCoderStep` (JSON válido/cercado/lixo) e
  `applyCoderStep` (escreve, recusa caminho fora, roda só o seguro, respeita a
  permissão). Total: 99 testes.

## [0.14.0] — 2026-06-06

Foco: **programação muito melhor** — o Ares passa a CRIAR projetos e a se comportar
como um engenheiro proativo, não só ler código.

### Adicionado

- **`codigo.scaffold {nome, tipo_projeto?, path?}`** — cria um projeto novo a
  partir de template (`src/main/scaffold.ts`): `site` (HTML/CSS/JS responsivo),
  `pagina` (HTML único) e `node` (ESM + teste `node --test`). Recusa pasta não
  vazia (a menos que `force`).
- **`codigo.criar {arquivo, conteudo, ...}`** — escreve/cria um arquivo no
  workspace.
- **`codigo.diagnostico {path?}`** — roda as checagens disponíveis e permitidas
  (typecheck/lint/test via `planDiagnosis`) e resume a saúde do projeto.
- **Proatividade em código** (prompt) — o Ares valida após mudanças
  (`codigo.diagnostico`/`codigo.comando`), relata passou/falhou, aponta riscos e
  sugere o próximo passo; ao criar projeto, já diz como abrir/rodar.
- Escritas reais protegidas por `allowPatchApply` e por `allowedRoots`.

### Testado de ponta a ponta

- Um **site foi criado na Área de Trabalho pelo próprio Ares** (`scaffoldProject`)
  e **servido com sucesso** (HTTP 200, título correto, CSS acessível); o terminal
  do Ares (`runCodeTerminal`) operou na pasta.
- `tests/scaffold.test.ts` (templates) e novos casos em `tests/code.test.ts`
  (scaffold/criar/`planDiagnosis`/diagnóstico). Total: 93 testes.

## [0.13.0] — 2026-06-06

Foco: **velocidade** do loop do agente e **mais proatividade**.

### Desempenho

- **Ferramentas de consulta em paralelo** — `runQuery` agora roda via `Promise.all`
  (clima, notícias, web, código são independentes), em vez de sequencial; a ordem
  dos resultados é preservada.
- **Resumo de contexto não-bloqueante** — `summarizeIfNeeded` deixou de ser
  aguardado no fim do turno: a resposta e a liberação para o próximo comando não
  esperam mais essa otimização de bastidor.

### Adicionado (proatividade)

- **Carregador estagnado** — avisa quando a fonte está conectada mas a bateria não
  carrega ("Not charging") e está abaixo de 90% (cabo solto / fonte fraca).
- **Heads-up de clima de manhã** — entre 6h e 10h, se houver alerta ou ≥60% de
  chance de chuva, o Ares sugere o guarda-chuva. O clima é buscado em segundo plano
  (cache de até 30 min, reusando localização/cidade padrão).

### Testes

- `tests/proactive.test.ts`: bateria estagnada e clima de manhã (com/sem alerta,
  dentro/fora da janela). Total: 82 testes.

## [0.12.0] — 2026-06-06

Foco: **proatividade** — o Ares fala primeiro no momento certo, como um JARVIS,
sem precisar ser chamado.

### Adicionado

- **Camada proativa de ambiente** (`src/main/proactive.ts`) integrada ao `tick()`
  do notify (a cada 30s):
  - **Bateria** — lida de `/sys/class/power_supply/BAT*`: aviso crítico (≤10%
    descarregando, fura tudo), fraco (≤20%) e cheio (≥97% carregando).
  - **Heads-up de evento** — eventos **sem** `remindMinutes` começando em ≤10 min
    ("Senhor, em 7 minutos: Reunião") — sem duplicar o aviso agendado.
  - **Tarefas vencidas** — lembrete gentil quando há vencidas.
- **Priorização anti-tagarelice** — um aviso por ciclo, cooldown por aviso,
  silêncio das 22h às 7h (só o crítico passa) e intervalo mínimo de 8 min (o
  crítico fura).
- **`ui.proactiveAlerts`** (ligado) com toggle em Configurações > Proatividade,
  separado de `ui.proactiveSuggestions` (sugestões do briefing).

### Testes

- `tests/proactive.test.ts`: leitura de bateria (capacidade/status/ausência),
  `buildNudges` (todos os gatilhos, ignorando eventos com lead/fora da janela) e
  `pickProactiveNudge` (prioridade, cooldown, silêncio, intervalo mínimo). Total:
  79 testes.

## [0.11.0] — 2026-06-06

Foco: **confiança na conversa** — o maior ganho de usabilidade por voz é não fazer
a coisa errada por causa de uma transcrição ruim.

### Adicionado

- **Confirmação de ações destrutivas** — apagar/limpar/remover (tarefa, coluna,
  evento, lembrete, memória, limpar lista) só executam após o "sim". O LLM
  pergunta na fala e um **portão no servidor** (`decideConfirmation` em
  `src/main/confirm.ts`) garante a não-execução mesmo se o modelo falhar. Se o
  usuário já confirma no mesmo pedido ("sim, pode apagar"), executa na hora.
  Pendência por sessão (TTL 5 min).
- **Desambiguação** (prompt) — quando o pedido casa com vários itens do contexto,
  o Ares pergunta "qual deles?" em vez de chutar.
- **Correção** (prompt) — "não, eu disse X" → reconhece, usa `desfazer` se a última
  ação foi errada e refaz com o valor certo.
- **`ui.confirmDestructive`** (ligado por padrão) com toggle em
  Configurações > Proatividade. Desligado, apaga direto (o desfazer continua).

### Testes

- `tests/confirm.test.ts`: classificação destrutiva, `describeConfirm`,
  afirmativo/negativo (sem confundir comando novo com "sim") e todos os ramos de
  `decideConfirmation` + store por sessão. Total: 65 testes.

## [0.10.0] — 2026-06-06

Foco: completar o controle do computador (**mídia** e **brilho**) e adicionar
**desfazer por voz** — reduzindo o atrito de erros de transcrição.

### Adicionado

- **`sistema.midia {acao}`** — play/pause/próxima/anterior/parar via `playerctl`
  ou MPRIS por `dbus-send` (usa o primeiro player ativo; degrada com elegância
  quando não há player).
- **`sistema.brilho {acao, nivel?}`** — clarear/escurecer/definir o brilho via
  `xrandr` (brilho de software no X11), com piso de 10% para não apagar a tela e
  passos de 10% no up/down.
- **`desfazer {}`** — reverte a última alteração de dados (tarefa, lista, nota,
  lembrete, evento ou memória). Antes de cada turno que muda dados, o Ares tira um
  snapshot dos arquivos JSON (`src/main/history.ts`, pilha das últimas 15) e
  "desfaz" restaura o último — undo universal, independente da ação. Não inclui
  conversas nem config.
- **`normMediaAction`/`normBrightnessAction`** no agente para entender a fala
  natural ("pausa", "próxima", "clareia", "escurece").

### Testes

- `tests/control.test.ts`: `mediaBackend`/`buildMedia` (playerctl + MPRIS) e
  `buildBrightness` (fração, clamp, up/down).
- `tests/history.test.ts`: restauração, remoção de arquivo ausente no snapshot,
  pilha LIFO e snapshot/restore isolados. Total: 52 testes.

## [0.9.0] — 2026-06-06

Foco: **controle do computador por voz** (estilo JARVIS) — o Ares deixa de só
responder e passa a **agir** no desktop, com ações seguras e instantâneas.

### Adicionado

- **`sistema.abrir {alvo}`** — abre app (apelidos: firefox, chrome, vscode,
  calculadora, arquivos, terminal…), site (domínio sem esquema vira `https://`) ou
  arquivo/pasta. Bloqueia esquemas perigosos; lança apps de forma destacada.
- **`sistema.volume {acao, nivel?}`** — `set`/`up`/`down`/`mute`/`unmute`/`toggle`,
  com detecção de backend `wpctl` → `pactl` → `amixer` e leitura do volume para
  confirmar a fala. Entende linguagem natural ("aumenta", "volume em 30", "mudo").
- **`sistema.bloquear {}`** — bloqueia a tela (`loginctl` → screensavers).
- **`sistema.captura {}`** — captura a tela (`gnome-screenshot` → `grim` →
  `spectacle` → `scrot`) e salva em `integrations.control.screenshotDir`.
- **`area.escrever {texto}`** — copia um texto para a área de transferência
  (complementa `area.ler`).
- **Configuração** — `integrations.control.{enabled, screenshotDir}`, com toggle em
  Configurações > Controle do Computador e estado na tela Sistema.
- **Módulo `src/main/control.ts`** sem dependência de Electron (executores via
  `spawn`, sem shell) — lógica de construção de comando é pura e testável.

### Testes

- `tests/control.test.ts`: `resolveOpenTarget` (URL/domínio/apelido/ausente/esquema
  bloqueado/binário), `audioBackend` (precedência) e `buildVolume` (comandos por
  backend + clamp). Total: 42 testes.

## [0.8.0] — 2026-06-06

Foco: **fechar a ponte com o Hermes de ponta a ponta neste PC**, com um servidor
local movido ao **mesmo cérebro do Ares** (9Router `cx/gpt-5.5`).

### Adicionado

- **Servidor de ponte local (`bridge/server.mjs`, `npm run bridge`)** — sem
  dependências (só `node:http` + `fetch`, Node ≥ 18). Expõe as rotas que o Ares
  chama:
  - `GET /health` — status (serviço, modelo, 9Router);
  - `POST /message` — comando geral respondido pelo 9Router; avisa quando o pedido
    exige WhatsApp/Trello/Obsidian de verdade (precisa do Hermes Desktop completo);
  - `POST /code` — "Hermes Code" com resposta **estruturada** (`summary`,
    `patches`, `tests`, `risks`, `commands`, `needsConfirmation`), no contrato que o
    cliente do Ares já preserva em `structured`.
- **Configurável por ambiente** — `ARES_BRIDGE_PORT`, `ARES_BRIDGE_HOST`,
  `NINEROUTER_BASE_URL`, `NINEROUTER_MODEL`, `NINEROUTER_API_KEY`,
  `ARES_BRIDGE_TOKEN`, `ARES_BRIDGE_TIMEOUT_MS`.
- **Sempre ligado (systemd --user)** — unit `bridge/ares-bridge.service`; sobe no
  login e persiste com `linger`. Guard de `EADDRINUSE` com mensagem clara.
- **Aviso de conflito de porta** — documentado em todo lugar: a `:18789` é
  disputada com o Hermes Desktop; rode só um de cada vez (ou mude
  `ARES_BRIDGE_PORT`).

### Testes

- `tests/bridge.test.ts`: `/health`, `/message` e `/code` (estruturado + fallback
  para `summary` + 400 em tarefa vazia) contra um 9Router falso e hermético. Total:
  30 testes.

### Notas

- O `npm run dev`/build exige Node ≥ 20.19; o **bridge** roda em Node ≥ 18 (por isso
  o `systemd` usa `/usr/bin/node`).

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
