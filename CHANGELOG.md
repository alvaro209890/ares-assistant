# Changelog

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
