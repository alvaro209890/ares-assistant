# Changelog

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
