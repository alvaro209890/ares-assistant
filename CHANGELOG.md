# Changelog

Todas as mudanças relevantes do Ares. O formato segue de perto
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e o projeto usa
versionamento semântico.

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
