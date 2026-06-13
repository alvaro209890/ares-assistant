# Voz — escuta (STT) e fala (TTS)

Mapa do pipeline de voz do Ares: como ele OUVE o usuário, como FALA (Piper neural com fila por frases) e como os dois lados convivem durante tarefas longas de programação. Inclui um checklist de diagnóstico para "ele não está me escutando".

## Visão geral

```
 Microfone ──► audio.ts (níveis, gravação até silêncio) ──► STT (transcrição)
                                                              │
                                                              ▼
 store.tsx (modos de escuta, turno) ──► main/agent.ts (LLM + ferramentas)
                                                              │
              deltas de fala (onDelta, por fase/canal)        ▼
 tts.ts (fila de frases, Piper) ◄── splitSentences ◄── streaming da fala
```

## Escuta (renderer)

### STT Groq (`src/main/grog.ts`)

- A Groq e usada apenas para transcricao de audio (`fala -> texto`). Ela nao define o cerebro do Ares; o LLM continua vindo de `config.nineRouter`, escolhido no onboarding/Modelos.
- A tela de Configuracoes mostra somente `grog.apiKey`. `baseUrl` e `sttModel` ficam como parametros internos para evitar configuracao acidental.
- Se uma config antiga vier sem URL/modelo, o processo usa defaults internos. Se o modelo configurado for recusado pela API, tenta automaticamente os modelos Whisper internos de reserva antes de reportar erro.

### `src/renderer/lib/audio.ts`

- `ensureMic()` — abre o microfone com `echoCancellation` (a própria voz do Ares some do mic, viabilizando o barge-in). **Revalida o estado real do stream** (`stream.active`, `track.readyState === 'live'`, contexto não fechado): após suspend/resume do Windows ou troca de fone/headset o stream morre em silêncio e, sem essa revalidação, todas as leituras de nível viram zero — o Ares ficava "surdo" sem nenhum erro. Stream morto é derrubado e readquirido.
- `recordUntilSilence()` — grava até detectar silêncio. Calibra o ruído ambiente (520 ms) com **cache de 45 s** (`AMBIENT_TTL_MS`): no modo contínuo, recalibrar a cada iteração abria um "buraco surdo" entre escutas. O limiar efetivo (`effectiveThreshold`, pura/testável) infla com o ambiente mas tem **teto** (`AMBIENT_THRESHOLD_CAP = 0.16`) — calibrar durante um pico de ruído elevava o limiar acima da voz normal do usuário.
- `watchForSpeech()` — monitora o mic sem gravar (gatilho do barge-in). Usa `setTimeout`, não `requestAnimationFrame` (rAF congela com a janela oculta).
- `stopRecording()` — nunca fica pendurado: `onerror` e um watchdog de 1,5 s entregam os chunks coletados mesmo se `onstop` não chegar.

### Modos de escuta (`src/renderer/lib/store.tsx`)

| Modo | Gatilho | Comportamento |
|---|---|---|
| Push-to-talk | segurar o botão | **Corta a fala em curso** (`clearSpeechQueue`), grava, transcreve, roda o turno. |
| Escuta única | botão de mic da orbe | Idem, com `recordUntilSilence`. |
| Conversa contínua | toggle | Loop: ouve → transcreve → turno → pausa curta (`postSpeechPauseMs`) → ouve. |
| Palavra de ativação | config `wakeWord` | Só age com "Ares ..." no início (tolerante a erros de transcrição via distância de edição). Dizer só "Ares" arma uma janela de 9 s ("Pois não?"). |
| Escuta durante trabalho | automático (contínuo + ocupado) | `listenWhileBusy`: "para/cancela" aborta na hora; outro pedido entra na fila e roda ao terminar (`interpretBusySpeech`, pura). |
| Barge-in | falar por cima do Ares | `waitForSpeechWithBargeIn` corre o watcher CONTRA a fila de fala; limiar vem de `bargeInThreshold(sensibilidade)` (pura). Interrompeu → `clearSpeechQueue()` e o mic abre. |

## Fala (renderer + main)

### Fila de frases (`src/renderer/lib/tts.ts`)

- O streaming do LLM é fatiado em frases por `splitSentences` (com fast-path para anúncios de status, corte eager na vírgula para a primeira frase do turno, e proteção de números/extensões).
- `enqueueSentence` → `drainQueue`: uma frase por vez, com **prefetch** das 2 próximas (síntese em paralelo com a reprodução) e **respiro entre frases** (160 ms após pontuação final, 70 ms em cortes suaves).
- Cada frase tem um **token de cancelamento** (`SentenceRun`): se o teto rígido (90 s) abandonar uma frase travada, ela nunca mais toca — sem isso a versão "zumbi" tocava por cima da frase seguinte.
- **Dois níveis de cancelamento**:
  - `clearSpeechQueue()` — corte duro (novo turno, barge-in, push-to-talk): derruba o áudio atual e zera tudo, inclusive cooldown do Piper.
  - `dropPendingSentences()` — corte suave legado: ainda existe para usos pontuais da fila, mas o stream principal de programação não descarta texto visível ao trocar de fase.
- **Resiliência do Piper sob carga**: budgets folgados (tentativa 6 s, total 14 s) porque a síntese fica legitimamente lenta com build/testes comendo CPU. Falha transitória ativa cooldown de 5 s — a próxima frase **espera e tenta de novo** em vez de ser pulada; após 3 falhas seguidas (Piper fora do ar de verdade), passa a pular sem atrasar. No Linux/Windows, `auto` mantém Piper como voz neural estrita: não rebaixa para Web Speech quando o Piper falha; em vez disso registra erro, chama `onEnd` e libera a fila.

### Síntese neural (`src/main/piper.ts`, `piperEngine.ts`, `speech.ts`)

- Piper (pt_BR-faber-medium) com pool de processos "quentes" (modelo ONNX carregado em memória).
- `prepareText` normaliza números/moeda/hora/versões por extenso, soletra siglas técnicas, aplica dicionário de pronúncia para termos estrangeiros e ajusta pontuação para prosódia.
- Tom dinâmico (`detectTone`): erro = mais direto; sucesso = mais calmo; pergunta = mais melódica (length_scale e noise por tom).
- O silêncio residual do WAV é aparado (`tightenWavSilence`) — a pausa audível entre frases é a da fila, não a do vocoder.
- Web Speech é motor explícito (`tts.engine=web`) ou caminho de plataformas sem Piper, como macOS. Não é fallback automático da voz neural no Linux/Windows.

## Voz durante tarefas de programação

- **Regra de texto único**: no modo programador por voz, tudo que entra na fila de fala entra também no chat pelo canal `both`, na mesma ordem. Se não está visível no transcript principal, não é falado. Logs, stdout/stderr, diffs e trechos de código ficam nos cartões de atividade/terminal.
- **Fases**: cada rodada de ferramentas ainda abre uma fase nova de streaming, mas a fase nova continua o mesmo transcript em vez de apagar a tela ou descartar fala pendente.
- **Anúncio pré-execução** (`voiceToolAnnouncement`): frase curta exibida e falada em paralelo com as ferramentas ("Executando os testes e checando os tipos do projeto."); combina até duas frentes da rodada e inclui alvo real quando houver (arquivo, busca, workspace ou objetivo do subagente).
- **Heartbeat** (`startHeartbeat`): tarefas com mais de 15 s geram atualização exibida e falada a cada 30 s. O rótulo é dinâmico: quando a ferramenta muda de "Rodando testes..." para "Executando suite de testes..." ou "Têmis elaborando relatório...", a próxima fala acompanha esse passo real.
- **Resumo imediato** (`codeVoiceProgressSummary`): assim que as ferramentas terminam, o resultado entra no mesmo transcript visível/falado. A conclusão do modelo é sanitizada para ser curta e falável, sem ler código, diff, JSON, stdout ou stderr.
- **Subagentes com precisão**: Atena, Hefesto, Têmis e Prometeu nunca falam diretamente; o Ares narra os blocos tagueados reais do relatório (`[RESUMO]`, `[ESCOPO]`, `[VEREDITO]`, `[PROBLEMAS]`, `[CAUSA RAIZ]`, `[VALIDAR]`) e ignora o restante para não despejar relatório técnico em voz.
- **Anti-repetição**: `isDuplicateSpeech` detecta paráfrases (sobreposição de tokens) entre o resumo imediato e a conclusão do modelo; o prompt de voz instrui o modelo a acrescentar significado/próximo passo em vez de repetir o resultado.

## Diagnóstico: "ele não está me escutando"

1. **Stream morto** — após suspend/resume ou troca de dispositivo. Corrigido por revalidação no `ensureMic`; se persistir, conferir permissão de microfone do sistema.
2. **Limiar inflado** — calibração durante ruído. Coberto pelo teto de `effectiveThreshold`; aumentar a sensibilidade do mic nas Configurações reduz o piso.
3. **Wake word exigida** — no contínuo com `wakeWordEnabled`, fala sem "Ares" no início é ignorada de propósito (status mostra "Aguardando 'Ares'…").
4. **Ocupado sem barge-in** — com `bargeIn` desligado, o mic só reabre ao fim da fala/tarefa; `listenWhileBusy` usa limiar mais alto de propósito (filtra o som ambiente da tarefa).
5. **Transcrição vazia** — fala muito curta (<180 ms sustentados) é tratada como ruído; o status indica "Não captei fala útil".

## Arquivos principais

- `src/renderer/lib/audio.ts` — microfone, níveis, gravação até silêncio, watcher de barge-in.
- `src/renderer/lib/voiceControl.ts` — lógica pura: wake word, intenção durante trabalho, limiar de barge-in.
- `src/renderer/lib/tts.ts` — fila de frases, Piper/Web Speech, cancelamentos, prefetch, splitSentences.
- `src/renderer/lib/store.tsx` — modos de escuta, turno, fases do streaming, barge-in.
- `src/main/speech.ts` — pré-processamento de texto e prosódia (puro, testável).
- `src/main/piper.ts` / `src/main/piperEngine.ts` — binário/vozes do Piper e pool quente.
- `src/main/voiceCode.ts` — voz no modo programador: anúncios, heartbeat, resumos, anti-repetição.

## Testes

`tests/tts.test.ts`, `tests/speech.test.ts`, `tests/voice-code.test.ts`, `tests/voice-control.test.ts`, `tests/piper-engine.test.ts`, `tests/subagents.test.ts` e `tests/agent.test.ts` cobrem fila, normalização, anúncios, heartbeat dinâmico, limiares, pool do Piper, parsing de relatórios e o contrato de transcript único em voz+programação. Gate: `npm run verify`.
