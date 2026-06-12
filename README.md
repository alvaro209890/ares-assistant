# Ares

Ares e um assistente desktop em Electron, React e TypeScript, feito para uso local em Linux e Windows. Ele combina conversa por voz, tarefas, agenda, lembretes, memoria, clima, noticias, controle basico do computador e um modo programador nativo para ler, editar, testar e diagnosticar projetos no proprio PC.

## Destaques

- **Primeira execucao obrigatoria**: o onboarding pede chave Groq, estado, cidade e provedor/modelo antes de liberar o uso normal.
- **Troca de modelo de IA na hora**: uma barra na tela principal (sobre a orbe) e uma aba dedicada **"Modelos de IA"** deixam escolher provedor (OpenRouter por login, DeepSeek, ChatGPT, Groq, Local), modelo (DeepSeek V4 Flash/Pro, GPT-5.5) e o **nivel de raciocinio** (baixo/medio/alto). A conexao padrao e o **login OAuth do OpenRouter** (o mesmo dos instaladores) — nao usa mais o 9 Router por padrao. DeepSeek e ChatGPT continuam com chave propria; ChatGPT oferece somente o GPT-5.5.
- **Groq apenas para audio**: a chave Groq e usada somente no STT (fala -> texto). O cerebro continua sendo o provedor/modelo escolhido no onboarding ou na aba Modelos. Em Configuracoes, a transcricao mostra apenas a chave; URL e modelo Whisper ficam internos.
- **Nivel de raciocinio que funciona e por voz**: baixo/medio/alto viram `reasoning_effort` low/medium/high na chamada (com fallback se o provedor recusar). Ajustavel por voz: "diminua o seu nivel de raciocinio para baixo", "raciocinio no maximo", e tambem "use o DeepSeek Pro" / "troca pro ChatGPT". A aba Modelos tem **"Testar todos os niveis"**, que mede a latencia de cada nivel no modelo conectado.
- **Voz neural (Linux e Windows)**: usa o Piper local — voz masculina pt-BR grave e humana, estilo JARVIS. O binario e baixado em background no primeiro uso; ate ficar pronto (e no macOS) usa a Web Speech do Chromium como fallback, priorizando vozes Natural/Neural/Online.
- **Responde por voz tambem ao texto**: mensagens digitadas no chat sao faladas quando o TTS esta ligado, nao so os comandos de microfone.
- **Voz de analise mais precisa**: respostas faladas limpam markdown, listas, bullets e links antes do TTS, usam resumo falavel para analise de pastas/projetos e evitam repetir saudacao dentro do mesmo chat.
- **Memoria estilo Hermes Agent**: fatos duradouros agora têm alvo, limite de contexto, evidencia, confianca e revisao. O Ares deduplica fatos parecidos, coloca contradicoes em pendente, bloqueia memoria suspeita e busca conversas antigas com `memoria.buscar`.
- **Modelos DeepSeek**: somente `deepseek-v4-flash` e `deepseek-v4-pro` ficam disponiveis.
- **Modo Programador nativo**: busca codigo, le arquivos com linhas, edita trechos existentes com match exato/flexivel, cria arquivos, aplica patches, gera scaffold, roda diagnostico e usa terminal local com autorizacao.
- **Skills de teste e qualidade**: `codigo.testar` detecta o runner do projeto (script `test`, vitest/jest/pytest/go) e responde por voz quantos testes passaram/falharam; `codigo.lint` (eslint/ruff) conta os problemas; `codigo.formatar` (prettier/ruff/gofmt) formata o codigo. Deteccao e parsing puros em `src/main/devtools.ts`; execucao assincrona, com timeout e cancelavel por Esc.
- **Chat lateral acompanha o PC**: enquanto o Ares trabalha, a conversa mostra leitura de arquivos, buscas, edicoes, comandos, git, diagnostico, testes, lint, formatacao e saidas recentes em tempo real.
- **Edicao por voz no codigo**: entende caminhos ditados como "src barra main ponto ts" e termos tecnicos ("funcao seta" -> arrow function, "tente e capture" -> try catch); evita ler codigo, diffs ou logs em voz alta. Resultados grandes sao truncados para voz e comandos lentos retornam resumo curto.
- **Voz mais viva (JARVIS)**: siglas tecnicas pronunciadas certo (API, JSON, TS, JS), fala mais continua e ritmo que muda com o conteudo (erro direto e rapido, sucesso calmo e elegante).
- **Engenheiro proativo**: apos editar/aplicar patch sugere validar com o teste/build do projeto, reporta a saude do projeto, avisa "iniciando a tarefa, senhor" em comandos longos, lembra do ultimo arquivo/comando e respeita as preferencias de codigo do usuario.
- **Interface HUD refinada**: selects da memoria usam seta SVG, foco com glow cyan e hover claro; o seletor de provedor mostra icones por IA e chave de API com toggle de visibilidade.
- **Atualizar por cima preserva os dados**: instalar uma versao nova sobre a antiga (Windows) mantem config, chaves, cidade, localizacao, tarefas, memoria e sessoes.
- **Sessões de Trabalho Retomáveis**: O Ares arquiva automaticamente o histórico de ferramentas e comandos em um Diário de Trabalho por projeto. Diga "Ares, retoma o projeto" para ouvir um resumo de onde o trabalho parou e continuar exatamente de onde estava.
- **Destaques da v0.33.0 (Colmeia: Manager + subagentes especialistas)**:
  - **Arquitetura Manager/Worker**: o Ares agora orquestra uma equipe de subagentes com nome proprio (mesma mitologia do Ares) — **Atena**, a investigadora (pesquisa web/documentacao e devolve so fatos com fonte), **Hefesto**, o construtor (projeta a implementacao: arquivos, codigo pronto e ordem de aplicacao) e **Têmis**, a auditora (roda o diagnostico do projeto e emite parecer rigoroso com veredito). O Ares anuncia as delegacoes pelo nome ("Vou pedir para a Atena investigar"), encadeia os relatorios (Atena -> contexto do Hefesto -> aplicar -> Têmis valida) e oferece a auditoria apos aplicar um plano. Todos usam o MESMO provedor/modelo do Ares (`ninerouter`), variando apenas o system prompt e a temperatura por especialidade (`src/main/subagents/`). Os subagentes nunca falam: devolvem relatorio tecnico e o Ares sintetiza por voz/texto.
  - **Novas ferramentas**: `subagente.pesquisar {objetivo, consulta?, url?}`, `subagente.construir {objetivo, path?}` e `subagente.auditar {objetivo, path?}` — o Ares delega sozinho em tarefas grandes ("pesquise a fundo", "projete a mudanca", "audite o projeto") e responde direto nas simples. Hefesto agora recebe tambem `git status`, `diff --stat` e saude do workspace; Têmis recebe diagnostico real mais `git diff`, entao os dois agentes de codigo trabalham com contexto de mudanca de verdade, nao so com a arvore do projeto. Detalhes em `docs/COLMEIA-SUBAGENTES.md`.
  - **Aba "Escritorio" (Alt+9)**: layout em duas colunas — painel da equipe a esquerda e chat unificado (texto + microfone) a direita. Cada especialista tem avatar com cor propria (Atena violeta, Hefesto ambar, Têmis esmeralda), trilho de conexao com fluxo animado ate o Ares e um **balao de fala** que mostra em tempo real o que esta fazendo ("Reunindo fontes na web...", "Mapeando o projeto...", "Rodando o diagnostico...", primeira frase do relatorio ao entregar) — com frases de prontidao quando ocioso. Status via canal IPC `agent:hive-update`.
  - **Memoria semantica leve**: ao delegar, o Ares recupera os fatos de memoria de longo prazo mais parecidos com o objetivo (similaridade de tokens, sem dependencia nativa) e injeta no contexto do subagente.
  - **Monitor proativo de saude do sistema**: CPU alta sustentada (~1,5 min), memoria acima de 92% e falhas novas no registro geram aviso falado ("Senhor, notei uma falha recente no registro. Devo pedir ao Critico para analisar?"), com cooldown e respeito ao horario de silencio.
- **Destaques da v0.32.0 (Programador + correções de fala + escritório vivo)**:
  - **Novas skills de programador**: `codigo.typecheck` (erros de tipo por voz), `codigo.deps` (dependencias desatualizadas + vulnerabilidades) e `codigo.todo` (pendencias TODO/FIXME com arquivo e linha).
  - **Fala que conclui**: corrigido o travamento em tarefas de programacao em que o Ares anunciava a ferramenta e nunca falava a conclusao; a resposta final do modelo agora e SEMPRE falada (sem repetir o resumo imediato), com fallback garantido quando o modelo nao devolve fala.
  - **Fila de fala a prova de travas**: teto rigido por frase (90s) pula sinteses penduradas em vez de congelar o turno; o monitor de barge-in nao usa mais requestAnimationFrame (que congela com a janela minimizada) e corre contra o fim da fala — o Ares nunca mais fica "ocupado" para sempre.
  - **Escritorio do Ares mais vivo**: janela com ceu que acompanha a hora (estrelas piscando, lua, estrela cadente, skyline de dia), headset com LED que segue o estado, rim light, sombra no chao, reflexo dos monitores na mesa, vinheta + scanlines + varredura de vidro; cliques na caneca (cafe), no relogio (data por extenso) e nos monitores (CPU/RAM), carinho com hover na cabeca e aceno ocasional "para a camera".
- **Destaques da v0.31.0/v0.30.0 (Voz e Apps)**:
  - **Conversa contínua e interrupção**: O microfone continua ativo no modo contínuo durante tarefas longas ou fala. Pode abortar a tarefa na hora dizendo "para", "cancela", "aborta" (sem palavra de ativação se a frase for curta), ou enfileirar novos comandos (ex: "Ares, depois rode os testes") usando a palavra de ativação.
  - **Batimento cardíaco (Heartbeat)**: Avisos falados breves e dinâmicos a cada 30 segundos evitam silêncio em execuções de terminal ou builds longos (>15s).
  - **Busca difusa de aplicativos (Windows)**: "abrir [aplicativo]" mapeia todos os atalhos do Menu Iniciar (.lnk / .url), permitindo iniciar qualquer programa local por voz (tolerante a acentos e pequenas falhas de transcrição).
- **Dados locais**: tarefas, memoria, agenda, listas, notas e lembretes ficam no `userData` do Electron.

## Instalar

### Windows

O instalador e gerado pelo workflow **Build Installers** no GitHub Actions e tambem pode ser baixado dos artefatos da execucao. O arquivo local baixado fica em:

```text
dist/windows-installer/ARES-<versao>-Setup-x64.exe
```

Ao instalar em um PC que ja tinha Ares, o instalador **atualiza no mesmo diretorio e preserva todos os dados** em `%APPDATA%\ares` (config, chaves, cidade, localizacao, tarefas, memoria, sessoes e a voz neural ja baixada). Campos novos de configuracao entram automaticamente pelo merge com os padroes — nao e preciso refazer o onboarding.

### Linux

Use os artefatos `.deb` ou `.AppImage` gerados no mesmo workflow, ou gere localmente:

```bash
npm run dist:linux
```

Ao instalar o `.deb` por cima da versao anterior, o pacote atualiza o aplicativo e preserva os dados em `~/.config/ares` (config, chaves, cidade, tarefas, memoria, sessoes e voz baixada). O `.AppImage` e portatil; basta substituir o arquivo antigo pelo novo.

## Desenvolvimento

Requisitos:

- Node.js 20.19+ ou 22.12+
- npm
- Git

Comandos principais:

```bash
npm install
npm run dev
npm run typecheck
npm run test:unit
npm run verify
npm run dist:win
npm run dist:linux
```

## Configuracao

A configuracao real fica no diretorio `userData` do Electron:

- Windows: `%APPDATA%/ares/config.json`
- Linux: `~/.config/ares/config.json`

Campos importantes:

| Campo | Uso |
| --- | --- |
| `grog.apiKey` | chave Groq obrigatoria para transcricao de voz; a UI mostra apenas este campo |
| `grog.baseUrl` / `grog.sttModel` | parametros internos do STT Groq; defaults sao usados se ficarem vazios |
| `nineRouter.baseUrl` | endpoint OpenAI-compatible do cerebro (padrao: OpenRouter) |
| `nineRouter.model` | modelo de texto selecionado |
| `nineRouter.reasoning` | nivel de raciocinio `baixo`/`medio`/`alto` (vira `reasoning_effort` low/medium/high) |
| `tts.engine` | `auto` (Piper neural primeiro no Linux e no Windows, Web Speech como fallback; macOS usa Web Speech), `piper` ou `web` |
| `tts.piperVoice` | voz neural do Piper (padrao `pt_BR-faber-medium`) |
| `tts.webVoiceURI` | voz do sistema usada no fallback Web Speech |
| `tts.rate` | velocidade da fala; o padrao novo e mais conservador para priorizar clareza |
| `integrations.location.city` | cidade definida no onboarding |
| `integrations.location.region` | UF definida no onboarding |
| `integrations.code.workspaceRoot` | workspace padrao do modo programador |
| `integrations.code.allowedRoots` | raizes em que o Ares pode ler/escrever codigo |
| `integrations.code.allowPatchApply` | permite escrita, scaffold e aplicacao de patches |
| `integrations.code.terminalEnabled` | habilita terminal local com travas |
| `integrations.code.terminalAutoApprove` | roda comandos fora da allowlist sem pedir confirmacao, recomendado deixar `false` |

Veja `config.example.json` para um template completo.

## Modo Programador

O Ares nao depende de servico externo para editar codigo. As ferramentas nativas sao:

- `codigo.workspace`: resume stack, scripts, linguagens, arquivos ignorados e estado Git.
- `codigo.listar`: lista arquivos por padrão de busca (glob) no workspace.
- `codigo.esboco`: extrai esboço/outline de classes, funções, interfaces, tipos e arrow functions com suas linhas de início (JS/TS/Python/Go).
- `codigo.buscar`: busca texto ou simbolos em arquivos permitidos.
- `codigo.ler`: le trechos com numeros de linha.
- `codigo.editar`: altera trechos existentes com replace, insert before/after ou intervalo de linhas, usando match exato/flexivel.
- `codigo.criar`: cria ou sobrescreve arquivos quando permitido.
- `codigo.substituir`: faz substituição global de texto (find and replace) com visualização prévia das mudanças antes de aplicar.
- `codigo.referencias`: encontra todas as ocorrências de um símbolo no projeto.
- `codigo.patch.preview`: valida e resume patches antes de aplicar.
- `codigo.patch.aplicar`: aplica diff Git ou operacoes textuais.
- `codigo.scaffold`: cria projetos simples a partir de templates locais.
- `codigo.projeto`: planeja e executa tarefas maiores com escrita e validacao.
- `codigo.comando`: roda comandos de desenvolvimento permitidos sem shell.
- `codigo.terminal`: usa shell real com classificacao `allowed`, `confirm` ou `blocked`.
- `codigo.diagnostico`: roda typecheck, lint, teste e build quando houver scripts permitidos.
- `codigo.git`: consulta status, diff e log sem alterar o repositorio.
- `codigo.testar` / `codigo.lint` / `codigo.formatar`: qualidade do projeto com resposta falavel.
- `codigo.typecheck`: checa os tipos (script `typecheck`, `tsc --noEmit`, mypy ou `go vet`) e fala quantos erros de tipo existem.
- `codigo.deps`: saude das dependencias — `npm outdated` + `npm audit` — e resume por voz quantas estao desatualizadas e se ha vulnerabilidades (e a gravidade).
- `codigo.todo`: varre o projeto atras de pendencias marcadas em comentarios (TODO, FIXME, HACK, BUG) e fala o total, as urgentes e onde esta a primeira.

No Windows, o terminal nativo usa PowerShell. No Linux e macOS, usa Bash. Comandos destrutivos ou de elevacao continuam bloqueados mesmo com confirmacao.

### Proatividade de engenheiro (estilo JARVIS)

- **Validacao automatica**: ao concluir um `codigo.criar`, `codigo.scaffold` ou `codigo.patch.aplicar` com sucesso, o Ares detecta o script de validacao do `package.json` (preferindo `test`, depois `build`/`typecheck`/`verify`) e oferece roda-lo numa frase curta. Veja `proactiveValidationCommand` em `src/main/code.ts`.
- **Saude do projeto**: `codigo.workspace` agora traz um campo `health` com avaliacao estrutural rapida (alteracoes sem commit, ausencia de teste/lockfile), sem rodar comandos; `codigo.diagnostico` reporta a saude apos rodar typecheck/lint/test (`tudo verde` ou `atencao: ... falharam`). Funcoes `structuralHealth` e `assessDiagnosisHealth`.
- **Tarefas longas**: antes de bloquear em um comando demorado (instalar/build/test), o Ares fala "Iniciando a tarefa, senhor. Um momento." para nao deixar o usuario no vacuo. A deteccao e `isLongRunningCommand`; o aviso so ocorre quando o comando vai de fato rodar (autorizado ou seguro).
- **Memoria de sessao curta**: o ultimo arquivo editado e o ultimo comando de terminal bem-sucedido sao persistidos (`session-context.json`) e injetados no prompt, para o Ares retomar o trabalho sem pedir o caminho de novo. Veja `setLastEditedFile`/`setLastTerminalCommand`/`sessionContextSummary` em `src/main/data.ts`.
- **Memoria longa estilo Hermes**: preferencias e fatos duradouros sao sanitizados, deduplicados, separados entre perfil do usuario e notas do agente, e injetados no prompt dentro de `<memory-context>`. Conversas antigas podem ser recuperadas por `memoria.buscar`. Veja `docs/MEMORIA.md` e `src/main/memory.ts`.
- **Pilulas de contexto (estilo de codigo)**: preferencias de codificacao guardadas na memoria (ex.: "sempre use aspas simples", "prefira funcoes nomeadas") sao filtradas e injetadas na secao de Programacao do prompt, para o Ares respeitar o estilo do usuario ao escrever/editar. Veja `src/main/preferences.ts` e `codingPreferencesSummary`.

### Execucao nao-bloqueante e cancelamento

Toda execucao de comando do modo programador (`codigo.comando`, `codigo.terminal`, `codigo.git`, `codigo.diagnostico` e o coder autonomo) agora roda de forma **assincrona** via `src/main/exec.ts` (`spawnAsync`), e nao mais com `spawnSync`. Isso resolve o congelamento do processo principal do Electron durante builds/instalacoes longas: o event loop fica livre, a voz e a proatividade continuam vivas e as ferramentas de consulta em paralelo nao sao mais bloqueadas por um terminal.

O `spawnAsync` aplica timeout (mata o processo com SIGTERM e, se preciso, SIGKILL), limita a captura por fluxo, suporta `onChunk` (saida em tempo real, base para uma futura UI de terminal ao vivo) e aceita um `AbortSignal`. Cada turno cria um `AbortController` registrado por sessao em `src/main/running.ts`; **pressionar `Esc` interrompe** nao so a fala como qualquer comando/build/coder em andamento (IPC `code:cancel` -> `cancelSession`). Comandos interrompidos voltam com `ok: false` e a mensagem "Comando interrompido pelo usuario.".

### Sentinela de Execucao (Execucao Vigiada)

A **Sentinela de Execucao** (`codigo.observar`) roda processos de longa duracao em segundo plano (como servidores de desenvolvimento, executores de testes ou compilacoes continuas), vigia a saida em tempo real e reage a erros proativamente. Quando um erro acontece, o ARES extrai a causa raiz, a anuncia por voz e oferece despachar o depurador **Prometeu** com o log ja coletado. Se o usuario disser "sim" ou "depura", o subagente `subagente.depurar` e acionado diretamente. O ARES tambem detecta quando o erro e corrigido e o processo se recupera. O controle e visualizacao sao feitos via chips na barra lateral e um modal com terminal ao vivo cyberpunk. Veja `docs/SENTINELA.md`.

### Seguranca do terminal: analise por trecho

O `classifyCommand` foi endurecido contra evasao. Antes, a classificacao casava o **comando inteiro** contra os prefixos seguros — entao `git status && rm -rf algo` casava o prefixo `git status` e era tratado como `allowed` (auto-executado, sem confirmacao). Agora:

- O comando e **quebrado nos operadores de shell** (`;`, `&&`, `||`, `|`, `&`, nova linha), respeitando aspas (`splitShellSegments`). O tier `allowed` (auto-executavel) so vale quando **TODOS** os trechos batem em prefixo seguro/allowlist — qualquer comando perigoso encadeado derruba para `confirm` (exige o "sim").
- **Substituicao de comando** (`$(...)`, crases, `<(...)`, `>(...)`) nunca e `allowed`: vai para `confirm`, para o usuario ver o texto literal e decidir (fecha `echo $(comando-perigoso)`).
- A **denylist** (sudo/su, `rm -rf` de raiz/HOME, mkfs, dd em disco, shutdown, fork bomb, `curl|sh`, etc.) roda no comando inteiro **e em cada trecho** (defesa em profundidade), e tolera fechadores de shell — `rm -rf /` continua bloqueado mesmo dentro de `$( )`.
- **Caracteres de controle** (byte nulo, escape ANSI) sao recusados.

Comandos `blocked` (catastroficos/elevacao) nunca rodam, nem com confirmacao. Pipelines somente-leitura compostos so de trechos seguros (ex.: `ls | cat`, `ls && pwd`) continuam `allowed`. No Windows o terminal usa PowerShell; no Linux/macOS, Bash.

### Voz no Modo Programador

Quando a entrada vem do microfone, o agente adiciona uma interpretacao auxiliar para termos comuns de desenvolvimento: "barra" vira `/`, "ponto ts" vira `.ts`, "traço" vira `-`, "underline" vira `_`, "npm rum" vira `npm run` e "git estado" vira `git status`. O dicionario tambem cobre termos tecnicos ditados: "funcao seta" vira `arrow function`, "assincrono com await" vira `async await`, "tente e capture" vira `try catch` e "funcao de retorno" vira `callback`. A resposta final de ferramentas `codigo.*` nao e transmitida em streaming bruto; ela e gerada, filtrada e so entao falada para evitar que o Ares leia codigo, JSON, diffs ou logs longos. A fala deve ficar em ate duas frases com o arquivo principal, o que mudou, se a validacao passou e qual autorizacao falta.

### Interação por voz em segundo plano e Heartbeat

Durante tarefas longas de programação ou execução de terminal, o microfone contínuo permanece ativo para receber comandos:
- **Parada e Cancelamento**: Dizer `"para"`, `"cancela"` ou `"pode parar"` interrompe instantaneamente a execução do processo e o áudio da resposta (sem precisar de wake word).
- **Fila de Execução**: Comandos precedidos pela wake word (ex: "Ares, depois rode os testes") são colocados em fila para execução sequencial posterior.
- **Heartbeat**: Atualizações rápidas a cada 30 segundos ajudam a saber se a tarefa ainda está rodando.

Ao reportar erros de terminal, o Ares fala apenas a **causa raiz** (a primeira linha que descreve o problema), ignorando o stack trace e os code frames. Veja `rootCauseError` em `src/main/voiceCode.ts`.

O modo de voz tambem limita explicitamente resultados de ferramentas de codigo antes de enviar ao LLM. Conteudos como `content`, `stdout`, `stderr`, diffs e listas grandes recebem o marcador `[...resultado truncado para voz...]`. A sintese Piper tem retry com orcamento total de 14s (folgado de proposito: durante build/testes a CPU esta ocupada e a sintese demora mais); falha transitoria ativa um cooldown curto em que a proxima frase ESPERA e tenta de novo em vez de ser pulada — o Ares mantem a voz neural configurada e nao rebaixa para Web Speech. Ao iniciar um novo turno, apertar push-to-talk ou detectar barge-in, a fala anterior e cancelada junto com a fila pendente; na troca de fase do streaming o cancelamento e suave (a frase em curso termina, so as pendentes sao descartadas). O pipeline completo de escuta e fala esta documentado em `docs/VOZ.md`.

O TTS tem watchdogs para evitar silencio preso: o processo Piper e encerrado em timeout, a reproducao do WAV tem limite de duracao e o Web Speech tenta de novo quando nao dispara `onstart`. A partir da v0.24 o modo `auto` usa o **Piper neural como primeira tentativa tanto no Linux quanto no Windows** (a voz neural e muito mais natural que as vozes SAPI do sistema); o Web Speech entra como reserva, e o macOS, sem binario do Piper, continua usando Web Speech. Se o streaming nao enviar deltas de fala, o Ares ainda enfileira a resposta final (`result.fala`) para nao ficar mudo.

### Voz muito melhor (v0.24)

Tres frentes elevam bastante a qualidade e a fluidez, mantendo Linux e Windows e sem novas dependencias:

- **Prosodia pt-BR (`src/main/speech.ts`, puro/testado)**: numeros e construcoes comuns agora sao falados por extenso — moeda (`R$ 1.250,90` -> "mil duzentos e cinquenta reais e noventa centavos"), porcentagem (`50%` -> "cinquenta por cento"), hora (`14:30` -> "quatorze e trinta"), versao (`v0.24` -> "versao zero ponto vinte e quatro"), ordinais (`1o` -> "primeiro") e simbolos isolados (`&`, `+`, `=`, `@`, `25 °C`). As **virgulas voltaram a ser preservadas** como pausa natural (antes eram apagadas, deixando a fala apressada) e o silencio entre frases subiu para `0.15` (uma respiracao curta).
- **Expressividade**: alem do ritmo (`length_scale`) variar com o tom, agora `noise_scale`/`noise_w` tambem variam por tom (`computeNoise`) — erro mais seco/nitido, sucesso mais caloroso — dentro de faixas seguras.
- **Latencia/fluidez (`src/main/piperEngine.ts`)**: um **pool de processos Piper "quentes"** mantem o modelo carregado em memoria entre as falas, eliminando o custo de recarregar o ONNX a cada frase. Como `length_scale`/`noise_*` sao flags globais do processo no Piper, o pool e indexado por esses parametros (na pratica ate ~3 processos: erro/neutro/sucesso). Protocolo: `--json-input` com `output_file`, fim detectado pelo caminho que o Piper ecoa no stdout; ha timeout por locucao, eviction por ociosidade (90s) e **fallback automatico** para o modo um-processo-por-frase. No renderer, a **proxima frase ja e sintetizada enquanto a atual toca** (pipelining via `_prefetchedWav`), deixando a fala quase continua.

A normalizacao pesada (numeros/simbolos/pausas) roda no processo principal em `prepareText`, que precisa do texto cru; por isso `normalizeSpeechText` no renderer agora so limpa markdown/ruido e **preserva virgulas e numeros**, em vez de mutila-los antes de chegarem la. Siglas tecnicas em CAIXA ALTA seguem pronunciadas corretamente (`API` -> "a pe i", `JSON` -> "jeison", `TS`/`JS` soletrados). Tudo em modulo puro e testado, independente do Electron.

As ferramentas de codigo tambem usam orcamento de tempo em varreduras de pasta. Quando uma pasta e grande demais, `codigo.workspace` e `codigo.buscar` devolvem resultado parcial com aviso, em vez de segurar o processo principal e atrasar a voz.

## Interface

- **Memoria**: os selects de categoria e filtro usam bordas cyan mais visiveis, hover claro, foco com glow suave e seta SVG customizada. As pilulas de categoria continuam inline e editaveis.
- **Timeline no chat**: cada resposta pode exibir o que o Ares esta fazendo no computador, com etapas de leitura, busca, escrita e comandos.
- **Provedor de IA**: o cadastro mostra icones por provedor (`DeepSeek`, `Groq`, `OpenRouter`, `OpenAI`, `Local`) e borda colorida sutil conforme o provedor selecionado.
- **Chave de API**: o campo tem icone de chave e botao para mostrar/ocultar a senha sem trocar de tela.
- **Voz em programacao**: Piper responde rapido (processo quente + frase seguinte ja sintetizada em paralelo), cai para Web Speech no timeout, preserva virgulas como pausa natural e cancela fala antiga quando entra uma nova resposta ou interrupcao.
- **Escala compacta**: novas instalacoes abrem com texto em 92% e janela menor. Em instalacoes existentes, ajuste em **Configuracoes > Acessibilidade > Tamanho do texto**.
- **Perfil de voz mais humano**: use `tts.rate` perto de `1.08` e `tts.pitch` perto de `0.78` para uma voz mais grave, fluida e menos robotica.

## Arquitetura

- `src/main/agent.ts`: prompt do agente, roteamento de acoes e execucao das ferramentas.
- `src/main/memory.ts`: sanitizacao, redacao, limites, deduplicacao e contexto cercado da memoria.
- `src/main/code.ts`: motor nativo de programacao, edicao precisa, patches, terminal, scaffold e diagnostico.
- `src/main/exec.ts`: execucao de processos assincrona (spawnAsync) com timeout, streaming e AbortSignal.
- `src/main/running.ts`: registro de execucoes canceláveis por sessao (cancelamento via Esc / IPC).
- `src/main/coder.ts`: executor autonomo para tarefas de codigo em varias etapas.
- `src/main/voiceCode.ts`: interpretacao e sanitizacao de respostas de programacao por voz (inclui causa raiz de erros).
- `src/main/piper.ts`: voz neural Piper multiplataforma (download do binario + sintese em Linux e Windows; engine quente com fallback um-processo-por-frase).
- `src/main/piperEngine.ts`: pool de processos Piper "quentes" (modelo carregado em memoria entre falas) indexado por parametros de prosodia.
- `src/main/speech.ts`: pre-processamento de fala puro e testavel (normalizacao pt-BR de numeros/simbolos, pausas, tom dinamico, length_scale e expressividade).
- `src/main/logger.ts`: log estruturado (anel em memoria + `ares.log` em userData, com rotacao); base do painel "Registro do sistema".
- `src/main/preferences.ts`: extracao das preferencias de codificacao do usuario (pilulas de contexto).
- `src/main/config.ts`: defaults e merge nao-destrutivo da configuracao (preserva dados em upgrades).
- `src/renderer`: interface React.
- `src/renderer/components/Select.tsx`: seletor moderno do tema HUD (dropdown em portal, teclado, ARIA) que substitui o `<select>` nativo em toda a UI.
- `src/preload`: API IPC tipada exposta ao renderer.
- `build/installer.nsh`: customizacoes NSIS (upgrade no mesmo diretorio, preservando os dados do usuario).
- `.github/workflows/build-installers.yml`: gera instaladores Linux e Windows.

O cerebro (`runTurn` em `agent.ts`) e coberto por `tests/agent.test.ts`, que mocka o `electron` (userData -> tmp) e a camada do LLM (`ninerouter`) para testar a orquestracao de ponta a ponta sem rede: aplicacao de mutacoes, memoryFallback, validacao de acoes, fluxo de duas fases (consulta -> resposta) e o portao de confirmacao destrutiva (segura -> confirma -> executa).

## Verificacao

Antes de publicar:

```bash
npm run verify
```

Para checar manualmente as melhorias desta versao:

```bash
npm run typecheck
npm run test:unit
npm run build
```

Na interface, abra a aba **Memoria**, altere o filtro e edite uma pilula de categoria para confirmar que `onChange` continua funcionando. Em **Configuracoes**, troque o provedor/modelo, use o botao de olho na chave de API e rode **TESTAR CONEXAO**.

Para voz, ative TTS e modo continuo, peca uma resposta curta, uma media e depois interrompa falando por cima. Para simular o fallback, deixe o Piper indisponivel ou lento; o Ares deve cancelar a tentativa, cair para Web Speech e continuar a conversa. No modo programador, rode uma analise em pasta grande e confirme que a resposta falada fica curta, com aviso de resultado truncado quando necessario, e que o chat lateral mostra leitura, comandos e saidas em andamento. Na memoria, salve uma preferencia, tente salvar um fato contraditorio e confirme que ele fica pendente.

O workflow de instaladores roda em push para `main` e publica artefatos para Windows e Linux.
