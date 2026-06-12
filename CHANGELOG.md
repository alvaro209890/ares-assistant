# Changelog

## 0.36.1 - 2026-06-12

- **Groq restrita ao audio**: a chave Groq continua servindo exclusivamente para STT (fala -> texto). O cerebro permanece independente, sempre controlado pelo provedor/modelo escolhido no onboarding ou na aba Modelos.
- **Configuracao de transcricao simplificada**: a tela de Configuracoes mostra apenas a chave Groq. URL e modelo Whisper ficam internos para evitar quebra acidental por edicao manual.
- **STT mais resiliente**: `src/main/grog.ts` agora usa defaults internos quando config antiga vier vazia e tenta modelos Whisper de reserva da Groq quando o modelo configurado for recusado.

## 0.36.0 - 2026-06-11

Foco: refatoração arquitetural do núcleo do agente. `src/main/agent.ts` foi de monolito de ~1900 LOC para fachada de ~450 LOC, com responsabilidades extraídas em módulos focados sob `src/main/agent/`. Contratos tipados, observabilidade leve por turno e política de retry explícita no provedor.

- **Decomposição de `agent.ts`**: extraído em 7 módulos focados sob [src/main/agent/](src/main/agent):
  - [agent/types.ts](src/main/agent/types.ts) — `ToolResult` discriminado (`ToolOk<T> | ToolErr`), helpers `toolOk()` / `toolErr()`, tipos compartilhados (`DeltaFn`, `ActivityFn`, `ProgressFn`).
  - [agent/prompt.ts](src/main/agent/prompt.ts) — PERSONA, `toolDocs()`, `dateAnchors()`, `buildSystemPrompt()`, helpers de cérebro, ações `ia.raciocinio` / `ia.modelo`.
  - [agent/activity.ts](src/main/agent/activity.ts) — `codeActivityMeta()`, `emitActivity()`, `createProgressActivity()`, `announceLongTask()`.
  - [agent/hive.ts](src/main/agent/hive.ts) — Colmeia inteira: `gather*Evidence`, `buildTaskContext`, `inferPromisedHiveAction`, `hiveFollowupInstruction`, `proactiveCodeFollowup`.
  - [agent/router.ts](src/main/agent/router.ts) — despacho tipado de ferramentas (`runQuery(a, ctx)` retornando `ToolResult`).
  - [agent/stream.ts](src/main/agent/stream.ts) — `streamTurn()`, `finalFala()`, `validateActions()`, **`classifyProviderError()`**.
  - [agent/trace.ts](src/main/agent/trace.ts) — `TurnTrace` com cap de 200 eventos.
- **Contratos tipados**: cada ferramenta agora devolve `ToolResult<T>` discriminado em vez de `unknown` com convenção implícita. Helpers `toolOk(tipo, data)` / `toolErr(tipo, msg)` substituem a repetição de `{ tipo, resultado, erro }` em 38+ cases do router.
- **Observabilidade por turno (`TurnTrace`)**: cada `runTurn` cria um trace com eventos rotulados (`turn:start`, `phase`, `tool:start/end`, `hive:gather/report/inferred`, `mutation`, `fallback`). No-op por padrão; ativável com `ARES_TRACE=1` para inspeção em desenvolvimento.
- **`classifyProviderError`**: classificação de falhas de LLM em 8 categorias (`abort` / `timeout` / `transient` / `auth` / `rate` / `bad_request` / `parse` / `unknown`), cada uma com flag `retryable`. Usada por `streamTurn` (decisão de fallback) e disponível para o orquestrador.
- **Retry transitório no `ninerouter`**: política explícita — 1 tentativa + até 2 retries com backoff 300ms/900ms, exclusivamente em `408/425/429/5xx` ou erro de rede sem status. `401/403/404` lançam imediatamente. Aborto do usuário respeitado em qualquer ponto. Fallbacks de compat (`reasoning_effort`/`response_format`) agora só disparam em `400/422`, fechando o leak onde 401 disparava 6 chamadas.
- **`streamTurn` mais resiliente**: consulta `classifyProviderError`. Aborto não cai para `chatJSON`. Stream caído após emitir texto → finaliza com o parcial (evita duplicar fala). Stream caído sem emitir → tenta `chatJSON` uma vez.
- **Compatibilidade preservada**: `agent.ts` re-exporta toda a superfície pública conhecida (`stripRepeatedGreeting`, `compactSubagentContext`, `buildTaskContext`, `hiveFollowupInstruction`, `inferPromisedHiveAction`, `buildBriefing`, `briefingToSpeech`). Nada precisa mudar em `src/main/index.ts` nem nos consumidores externos.
- **Testes novos**: 17 testes (`tests/agent-stream.test.ts`, `tests/agent-trace.test.ts`, retry no `tests/ninerouter.test.ts`).
- **Documentação**: nova [docs/AGENT-ARQUITETURA.md](docs/AGENT-ARQUITETURA.md) com o mapa de módulos, contratos e instruções de tracing.
- 353 testes passando (eram 336).

## 0.35.0 - 2026-06-11

Foco: redesign profundo da Colmeia para programação real — separação Hefesto x coder autônomo, pacotes de evidência tipados, auditoria por escopo (não por chars), protocolo mais sólido.

- **Hefesto vira tech-lead, sem competir com o executor**: o construtor não escreve mais o projeto inteiro — entrega um BRIEFING tagueado (`[ESCOPO]`/`[ARQUIVOS]`/`[PASSOS]`/`[RISCOS]`/`[VALIDAR]`) que o Ares usa para aplicar passo-a-passo com `codigo.editar/criar` OU delegar ao coder autônomo (`codigo.projeto`). Os dois caminhos ficaram explícitos no prompt-system; nunca mais o LLM chama os dois para o mesmo objetivo.
- **EvidencePackage tipado (`src/main/subagents/evidence.ts`)**: pacotes de evidência substituem `evidence: string` truncada por chars. Cada seção rotulada tem `priority` e `minChars`; o renderer aloca orçamento por seção (essenciais primeiro), com truncamento que preserva fronteira de linha. Falhas de coleta viram `notes` separadas.
- **Hefesto recebe contexto útil de verdade**: agora coletamos workspace + estado git + **outlines dos arquivos relevantes ao objetivo** (ranking por tokens + arquivos modificados no git status), no lugar de uma lista crua de 120 arquivos.
- **Auditoria por arquivo, não por corte de chars**: Têmis recebe diagnóstico + `git status --short` + um bloco `outline + diff` POR arquivo alterado (até 8). Acabou o `diff.slice(0, 12000)` que cortava hunks no meio.
- **Têmis abre com `[VEREDITO]`**: template tagueado (APROVADO/REPROVADO + `[RESUMO]` + `[PROBLEMAS]` com arquivo:linha + gravidade). Novo `parseReportTags(report)` extrai veredito/arquivos/riscos de forma testável.
- **Contexto orientado a tarefa**: `buildTaskContext` (alias retrocompatível `compactSubagentContext`) inclui contexto direto + preferências de código + último arquivo editado + último comando OK + resumo + amostragem de mensagens recentes.
- **Protocolo da Colmeia mais conservador**: `inferPromisedHiveAction` agora exige três sinais conjuntos (verbo de delegação clara + nome do especialista + verbo de domínio compatível). Verbos genéricos como "vou ler o arquivo" não disparam mais falsos positivos.
- **Atena com pacote estruturado**: busca + busca focada em recência + Google News + página opcional viraram seções rotuladas com cota mínima por bloco — orçamento total de ~18k chars distribuído por prioridade.
- **Documentação refeita**: `docs/COLMEIA-SUBAGENTES.md` reflete os novos papéis, EvidencePackage, hand-off Hefesto↔coder autônomo e a guarda determinística.
- **Testes**: subagents.test.ts agora cobre `renderEvidencePackage`, `truncateSmart`, `pickRelevantFiles`, `parseGitStatusFiles`, `parseReportTags` e o protocolo conservador (`inferPromisedHiveAction`).

## 0.34.0 - 2026-06-10

Foco: estabilidade da voz atual, Colmeia mais confiavel, chat unico entre Assistente/Escritorio e limpeza local solicitada pelo usuario.

- **Voz Piper preservada**: `auto` e `piper` nao caem mais automaticamente para Web Speech. Se uma frase falha, o Ares registra o erro e libera o turno sem trocar para uma voz inferior.
- **Resposta final falada apos Atena**: corrigido o caso em que a Atena pesquisava, o Ares mostrava o resultado no chat, mas a resposta final nao entrava na fila de voz.
- **Chat compartilhado**: Assistente e Escritorio usam o mesmo painel de conversa, historico, selecao de chats e botao de nova conversa.
- **Colmeia com guarda deterministica**: se o Ares promete acionar Atena/Hefesto/Temis e o modelo esquece a acao JSON, o runtime executa a acao correta.
- **Atena mais atual e completa**: pesquisas passam a coletar busca normal, busca focada em recencia e noticias do Google News RSS; o relatorio exige datas, fontes, divergencias e incertezas.
- **Contexto compacto para subagentes**: subagentes recebem contexto direto, resumo e ultimas mensagens relevantes com limite fixo para melhorar qualidade sem desperdicar tokens.
- **Estabilidade Electron/IPC**: envio de eventos tolera renderer destruido; Linux ganhou fallback grafico para reduzir queda por GPU.
- **Dados locais limpos**: chats e memorias foram apagados; ficou apenas a memoria de perfil com o nome `Alvaro`, preservando APIs ja configuradas.
- **Melhoria nas Capacidades de Programação (Modo Programador)**: Refinamento extensivo das instruções do agente no prompt de sistema para exigir maior rigor técnico, excelência na construção (proibição de placeholders, códigos parciais e comentários `// TODO`), atenção à segurança sintática de strings JSON e uso de ferramentas de diagnóstico de forma sênior proativa após alterações.
- **Streaming de Atividades Otimizado (Timeline no Chat)**: Otimização do fluxo de atividades do chat. Em vez de poluir a timeline com múltiplos eventos separados de saída do terminal (`status === 'output'`), a store agrupa e atualiza dinamicamente a saída em tempo real sob o mesmo item de atividade usando o ID correspondente.
- 314 testes passando (2 skipped).

## 0.31.0 - 2026-06-10

Foco: agente de programação com mais ferramentas (inspiradas nas tools Glob/Outline/Grep/MultiEdit de agentes como Claude Code/openclaude), voz que acompanha o trabalho e conversa contínua que segue viva durante tarefas longas.

- **4 ferramentas novas de programação** (validadas no repo real do Ares):
  - `codigo.listar {padrao}` — lista arquivos por glob ("src/main/*.ts") sem precisar ler nada.
  - `codigo.esboco {arquivo}` — o "mapa" do arquivo: funções, classes, tipos, interfaces e arrow functions com a linha onde começam (TS/JS/Python/Go). O agente vai direto ao trecho certo em vez de ler arquivos inteiros.
  - `codigo.referencias {simbolo}` — onde um símbolo é usado no projeto, com contagem por arquivo e amostra — base segura para renomear/refatorar.
  - `codigo.substituir {de, para, filtro?, confirmado?}` — substituição em todo o projeto: sem `confirmado` devolve só a PRÉVIA (arquivos + contagens) para o usuário aprovar por voz; com `confirmado` aplica (exige "Permitir aplicar patches", respeita bloqueios de caminho sensível e limite de 40 arquivos).
- **Voz acompanha a programação ("heartbeat")**: se um comando/build/teste passa de ~15 s, o Ares fala uma atualização curta ("Ainda trabalhando nisso, senhor.") e repete a cada ~30 s com frases variadas — nunca mais silêncio sem saber se travou. O aviso "iniciando a tarefa" também ganhou variações e agora usa a FASE correta do streaming (corrige reset indevido da tela no loop multi-rodadas).
- **Conversa contínua durante o trabalho**: no modo contínuo, o microfone segue ouvindo ENQUANTO o Ares programa ou fala:
  - "para / cancela / pode parar" (curto, mesmo sem a palavra de ativação) **aborta a execução na hora**;
  - "Ares, depois rode os testes" entra na **fila** e roda assim que a tarefa atual terminar;
  - fala alheia/ruído é ignorada (limiar mais alto + exigência de wake word para comandos).
  - A interpretação é pura e testada (`src/renderer/lib/voiceControl.ts`), que também passou a abrigar a palavra de ativação usada pelo modo contínuo.
- 263 testes (eram 248).

## 0.30.0 - 2026-06-10

Foco: fala muito mais fluida e humana, IA mais inteligente (encadeia ferramentas) e abertura de QUALQUER app por voz no Windows. Validado neste PC com o Piper e o Menu Iniciar reais.

- **Fala emendada, sem "vão" entre frases**: o Piper anexa ~300 ms de silêncio ao fim de cada locução (medido no WAV real deste PC); agora esse rabo é aparado (`tightenWavSilence`, mantendo um respiro de 130 ms), e a síntese adianta **2 frases** durante a reprodução (antes 1) — frases curtas não abrem mais buraco na fala.
- **Voz começa mais cedo**: no streaming, a primeira oração é cortada na vírgula (modo *eager*, só para o primeiro trecho do turno) — a fala inicia ~1 frase antes, sem prejudicar a prosódia do resto.
- **Entonação de pergunta**: frases terminadas em "?" ganham ritmo levemente mais pausado e mais variação melódica (noise_w) — confirmações como "Confirma que aplico?" soam como pergunta de verdade.
- **Pronúncia pt-BR ainda melhor**: datas por extenso (`2026-06-10` e `10/06/2026` → "dez de junho de dois mil e vinte e seis"), unidades de dados/tempo ("16 GB" → "dezesseis gigabytes", "120 ms" → "milissegundos") e mais siglas (PDF, USB, SSD, IP, IA, LLM, Wi-Fi, GIF...).
- **IA mais inteligente — encadeamento de ferramentas (loop agêntico)**: o Ares agora pode usar os resultados de uma rodada de ferramentas para chamar NOVAS ferramentas no mesmo turno (até 3 rodadas): buscar → ler → editar → testar, sem o usuário pedir de novo. Antes, ações de consulta da 2ª fase eram simplesmente ignoradas.
- **Persona mais humana**: fraseado variado (sem repetir a mesma fórmula), responde primeiro o que foi perguntado, resolve "ele/isso/aquele arquivo" pelo histórico (janela de contexto ampliada de 12 para 16 mensagens) e escreve a fala "para ser ouvida".
- **Abrir qualquer app por voz (Windows)**: novo índice do Menu Iniciar (`src/main/apps.ts`) com casamento tolerante a acentos, palavras parciais e erros de transcrição ("abra o whatsapp", "abre o qgis", "abra o obs"). Validado com os 283 atalhos reais deste PC (Word, Excel, Chrome, Edge, OBS, VLC, WhatsApp, QGIS, AutoCAD, CapCut...). Também: "configurações" abre o painel via `ms-settings:` e mais apelidos (bloco de notas, paint, gerenciador de tarefas, edge, word, excel...).
- **Programação por voz**: mais extensões ditadas (".txt", ".sql", ".toml", ".sh", ".svg", ".vue") e termos ("use effect", "git commit/push/pull/diff", "interface", "generic").
- 248 testes (eram 206), incluindo casos novos de trim de WAV, datas, tom de pergunta, eager split, matching de apps e encadeamento/limite de rodadas do agente.

## 0.29.0 - 2026-06-09

- **Memoria estilo Hermes Agent oficial**: a memoria agora segue a logica do repositorio `NousResearch/hermes-agent`: fatos curtos, duradouros, com alvo (`perfil do usuario` ou `notas do agente`), limite de tamanho, evidencia, confianca e revisao. Fatos contraditorios ou fracos entram como pendentes, em vez de sobrescrever memoria boa.
- **Memoria mais segura**: antes de salvar ou injetar memoria no prompt, o Ares remove tokens/segredos comuns, bloqueia padroes de prompt injection/exfiltracao e envolve o contexto em `<memory-context>` com aviso de sistema. Isso reduz o risco de uma memoria virar instrucao maliciosa.
- **Busca de conversas antigas**: nova ferramenta `memoria.buscar` procura em sessoes salvas quando o usuario pede para lembrar algo que ja foi discutido, sem transformar progresso temporario em memoria permanente.
- **Edicao de codigo mais precisa**: nova ferramenta `codigo.editar` edita arquivos existentes com replace, insert before/after e line range. Ela tenta correspondencia exata, depois correspondencia flexivel por linhas/espacos, rejeita matches ambiguos e bloqueia caminhos sensiveis como `.env`, `.ssh` e `.git`.
- **Chat lateral acompanha o trabalho real**: o renderer agora mostra uma linha do tempo por resposta com leitura, busca, escrita, comandos, git, diagnostico, testes, lint, formatacao e trechos de `stdout`/`stderr` em tempo real. Isso deixa claro o que o Ares esta lendo, editando e executando no PC.
- **Tela de Memoria mais informativa**: cada fato mostra alvo, confianca, possivel conflito e evidencia quando existir, inclusive nos itens pendentes.

## 0.28.2 - 2026-06-09

- **Voz de análise mais clara e formal**: respostas faladas agora removem markdown, listas numeradas, bullets, links e marcações como `**texto**` antes de chegar ao Piper/Web Speech. Isso evita áudio embolado ao analisar pastas com resposta estruturada.
- **Menos repetição no mesmo chat**: se a conversa já começou, o Ares não deve iniciar novas respostas com "olá", "bom dia", "boa tarde", "boa noite" ou o nome do usuário. O prompt foi reforçado e o processo principal remove saudação repetida da fala final.
- **Piper mais inteligível**: a voz padrão ficou um pouco mais calma, com pausa maior entre frases e parâmetros de ruído mais conservadores para priorizar clareza em vez de expressividade exagerada.
- **Teste de voz atualizado**: a frase de teste agora usa tom formal e direto, sem "olá senhor" por padrão.

## 0.28.1 - 2026-06-09

- **Fallback robusto para a fala final da análise por voz**: quando o Ares analisa uma pasta/projeto, a resposta completa continua indo para a tela, mas agora o processo principal também devolve um `falaVoz` com o resumo seguro para TTS.
- O renderer passa a tocar esse `falaVoz` se a fase 2 não tiver entrado na fila de áudio, cobrindo a corrida em que o último evento IPC `kind: "speak"` podia se perder logo antes do `chat:ask` resolver.
- Adicionados testes para o retorno `falaVoz` no agente e para a regra de fallback do renderer.

## 0.28.0 - 2026-06-09

- **Stream de voz para tarefas de programação, corrigido e moderno**: antes, ao pedir uma análise por voz (ex.: "analise o diretório"), o Ares falava "vou analisar" e depois **ficava mudo na resposta** — porque a fala da 2ª fase passava por uma limpeza que podia esvaziá-la, e o texto exibido também ficava cortado em 2 frases. Agora:
  - A **resposta completa é transmitida na tela** (token a token, com listas/código formatados), num canal só de exibição.
  - A **voz continua naturalmente** com um resumo conciso, limpo e **garantidamente não-vazio**, num canal separado — sem ler código, caminhos ou stack trace em voz alta.
  - `sanitizeVoiceCodeFala` nunca mais devolve vazio quando há conteúdo (cai para o texto limpo se a filtragem de stack/código zerar tudo).
- Implementação: novo "kind" no stream (`both`/`display`/`speak`) ponta a ponta (agent → IPC → preload → renderer). 2 testes novos (206 no total), incluindo um teste de integração do fluxo de duas fases em voz+código.

## 0.27.0 - 2026-06-09

- **Novas skills de programação e teste** (modo programador / por voz):
  - **`codigo.testar`** — roda os testes do projeto detectando automaticamente o runner (script `test` do package.json, ou vitest/jest/pytest/go) e responde de forma falável quantos **passaram/falharam** (ex.: "Todos os 204 testes passaram", "2 testes falharam de 189"). Gatilhos de voz: "roda os testes", "os testes passam?".
  - **`codigo.lint`** — roda o linter (script `lint`, ou eslint/ruff) e conta os **problemas**. "passa o lint?", "tem erro de estilo?".
  - **`codigo.formatar`** — aplica o formatador (script `format`, ou prettier/ruff/gofmt). Altera arquivos, então só roda quando pedido explicitamente.
- A detecção do runner e o parsing do resultado são puros e testáveis (`src/main/devtools.ts`); a execução é assíncrona, com timeout e cancelável por Esc, como as demais ferramentas de código. 15 testes novos (204 no total).

## 0.26.0 - 2026-06-09

- **Troca de modelo de IA na tela principal**: uma barra sobre a orbe permite trocar provedor (OpenRouter, DeepSeek, ChatGPT, Groq, Local), modelo e nível de raciocínio sem entrar nas configurações.
- **Nova aba "Modelos de IA"**: tela dedicada para escolher e **conectar** o cérebro — login OAuth do OpenRouter ou chave própria, seleção de modelo, ajuste de raciocínio e um botão **"Testar todos os níveis"** que faz uma chamada real em baixo/médio/alto e mostra a latência de cada um.
- **Nível de raciocínio que funciona de verdade**: baixo/médio/alto viram `reasoning_effort` low/medium/high na chamada da API (DeepSeek V4 Flash/Pro e GPT-5.5). Se o provedor não aceitar o campo, o Ares repete a chamada sem ele (sem quebrar). Groq, que não raciocina, não recebe o campo.
- **Ajuste de raciocínio e modelo por voz**: "diminua o seu nível de raciocínio para baixo", "raciocínio no máximo", "aumente o esforço", "use o DeepSeek Pro", "troca pro ChatGPT" — o Ares aplica e confirma falando. Os seletores na tela refletem a mudança na hora.
- **Conexão padrão via OAuth (OpenRouter), não mais 9 Router**: o cérebro padrão passou a ser o OpenRouter por login (o mesmo fluxo dos instaladores) — uma conta dá acesso a GPT-5.5 e DeepSeek V4. DeepSeek e ChatGPT continuam disponíveis com chave própria; o 9 Router local virou opção "avançada/auto-hospedada".
- **ChatGPT restrito ao GPT-5.5**: o provedor ChatGPT oferece somente o GPT-5.5.

## 0.25.0 - 2026-06-09

- **Seletores modernos e bonitos**: todos os menus suspensos (provedor de IA, modelo, motor/voz, categorias de memória, filtros do Kanban, prazos, estados, recorrência etc.) deixaram de usar o `<select>` nativo — que abria com um painel **branco e fora do tema** no Linux/Electron. Agora usam um componente próprio no tema HUD escuro (ciano), com animação, marca de seleção, rolagem, navegação por teclado e renderização em "portal" (não é mais cortado por painéis nem cai no widget branco do sistema).
- **Registro do sistema (logs)**: o Ares passou a ter um log estruturado em `ares.log` (na pasta de dados) e um painel **"Registro do sistema"** na aba Sistema/Diagnóstico, mostrando as últimas linhas coloridas por nível. Falhas que antes sumiam em silêncio (download/síntese do Piper, chave do STT, config corrompida) agora ficam visíveis — fica muito mais fácil entender "por que a voz não funcionou".

## 0.24.0 - 2026-06-09

Foco: deixar a voz **muito melhor e mais fluida** no Linux e no Windows, sem novas dependências.

- **Piper neural agora é o padrão também no Windows**: antes o Windows usava a voz robótica do SAPI primeiro e só caía no Piper por falha — agora a voz neural pt-BR (estilo JARVIS) é a primeira tentativa nos dois sistemas, com a Web Speech como reserva (o macOS, sem binário do Piper, segue na Web Speech).
- **Números e símbolos falados por extenso (pt-BR)**: moeda (`R$ 1.250,90` → "mil duzentos e cinquenta reais e noventa centavos"), porcentagem (`50%` → "cinquenta por cento"), hora (`14:30` → "quatorze e trinta"), versão (`v0.24` → "versão zero ponto vinte e quatro"), ordinais (`1º` → "primeiro") e símbolos isolados (`&`, `+`, `=`, `@`, `25 °C`). A fala deixa de soletrar dígitos de forma estranha.
- **Fala menos apressada**: as vírgulas voltaram a ser pausas naturais (antes eram removidas, atropelando as frases) e o silêncio entre frases ficou um pouco maior (uma respiração curta).
- **Mais expressiva**: além do ritmo, a textura da voz varia com o conteúdo — respostas de erro saem mais secas e diretas; confirmações de sucesso, mais calorosas.
- **Resposta quase instantânea e contínua**: o Ares mantém o motor de voz "quente" (modelo já carregado) entre as falas e adianta a síntese da próxima frase enquanto a atual toca, eliminando os silêncios entre frases. Se algo falhar, cai automaticamente para o modo anterior, sem travar.

## 0.20.1 - 2026-06-08

- **Clima com cidade + estado**: a busca aceitava só o nome puro da cidade, então "Querência, MT" (formato salvo pelo onboarding) dava "Não encontrei a cidade". Agora separa cidade e UF/estado, expande a sigla (MT → Mato Grosso) e usa a região para desambiguar cidades homônimas (ex.: Querência-MT × Querência-RS). Cobertura por testes unitários.
- **Voz não saía (Web Speech)**: a 1ª fala era engolida quando as vozes do sistema ainda não tinham carregado (comum no Electron/Windows). Agora espera as vozes carregarem, chama `resume()` (workaround do Chromium) e ignora erros `canceled`/`interrupted` de barge-in.
- **Fallback sempre soa**: se o Piper estiver indisponível (ex.: ainda baixando no Windows), a fala cai para a Web Speech em vez de ficar muda.
- **Falhas de voz visíveis**: erros de TTS deixam de ser silenciosos e aparecem no status (`Voz: …`), facilitando diagnóstico.

## 0.20.0 - 2026-06-08

- Voz neural (Piper) agora roda também no **Windows**, não só no Linux: voz masculina pt-BR grave e humana, estilo JARVIS, no lugar da voz robótica do SAPI. O binário do Piper é baixado em background no primeiro uso (`piper_windows_amd64`) e fica em `%APPDATA%\ares\piper`.
- Cadência mais natural: pausa entre frases (`--sentence_silence`) e fala um pouco mais calma/deliberada.
- Fallback Web Speech melhorado: prioriza vozes Natural/Neural/Online e masculinas; penaliza as vozes "desktop" (as mais robóticas) — enquanto o Piper ainda baixa.
- **Mensagem digitada no chat agora também é respondida por voz** quando o TTS está ligado (antes só falava o que vinha por microfone).
- Clima mais robusto: `fetch` com timeout e 1 retry e fallback automático da localização precisa para a cidade configurada — corrige o "OFFLINE" persistente no Windows após o boot. O erro real aparece no status em vez de sumir em silêncio.
- **Atualizar por cima preserva os dados**: o instalador Windows deixou de apagar `config.json` e o `ensureConfig` não reseta mais a configuração ao trocar de versão. Nome, chaves, cidade, localização, tarefas, memória e sessões permanecem. Campos novos entram via merge com os padrões.

## 0.19.1 - 2026-06-08

- Melhorou o modo programador por voz: interpreta termos ditados como "barra", "ponto ts", "traço", `npm run` e `git status`.
- Respostas de ferramentas `codigo.*` em modo voz agora sao geradas completas primeiro, sanitizadas e so entao enviadas ao TTS.
- Evita leitura em voz alta de codigo, diffs, JSON, `stdout` e `stderr`, mantendo a fala curta com arquivo, acao, validacao e proximo passo.
- Adicionou testes unitarios para interpretacao de voz e filtro de fala em edicao de codigo.

## 0.19.0 - 2026-06-08

- Removeu a delegacao externa do fluxo de programacao.
- Tornou leitura, escrita, patches, scaffold, terminal, diagnostico e coder autonomo o caminho nativo para edicao de codigo.
- Removeu telas, configuracoes, tipos, IPCs, testes e documentacao da integracao legada.
- Ajustou o terminal de programacao para usar PowerShell no Windows e Bash nos demais sistemas.
- Ativou `allowPatchApply` por padrao em novas configuracoes para permitir edicao nativa apos o onboarding.
- Atualizou a documentacao para o fluxo nativo e para o instalador Windows com reset de configuracao.

## 0.18.0 - 2026-06-08

- Primeiro uso passou a exigir chave Groq, estado, cidade e provedor/modelo.
- Modelos DeepSeek foram restringidos a `deepseek-v4-flash` e `deepseek-v4-pro`.
- Voz no Windows recebeu ajustes de naturalidade, tom, velocidade e selecao de voz.
- Instalador Windows passou a resetar `config.json` em upgrades para forcar novo onboarding.
- Workflow de instaladores gerou artefatos para Windows e Linux.

## 0.17.x e anteriores

- Base Electron, React e TypeScript.
- Tarefas, agenda, listas, notas, memoria, lembretes, briefing, clima, noticias e busca web.
- Controle local de sistema, atalhos, bandeja, overlay e backup de dados.
- Modo programador com workspace, busca, leitura, comandos, patches, scaffold, indice e diagnostico.
