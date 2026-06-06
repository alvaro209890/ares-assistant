# Proatividade

Um JARVIS não só responde — ele **fala primeiro no momento certo**. O Ares tem duas
camadas de proatividade:

1. **Agendada** (`src/main/notify.ts`) — lembretes de tarefas (`reminderAt`),
   eventos (`whenISO` com lead `remindMinutes`) e lembretes/timers/despertadores
   disparam na hora exata: notificação nativa + fala (se a voz estiver ativa).
2. **Ambiente** (`src/main/proactive.ts`) — observa o contexto e avisa do que
   importa agora, sem precisar de horário marcado.

Ambas rodam no mesmo `tick()` a cada 30s e falam pelo canal `reminder:fired` (toast
+ TTS).

## Avisos de ambiente

Priorizados; no máximo **um por ciclo**, com cooldown por aviso, **silêncio das 22h
às 7h** (só o crítico passa) e **intervalo mínimo de 8 min** entre avisos (o crítico
fura).

| Aviso | Quando | Prioridade | Cooldown |
| --- | --- | --- | --- |
| Bateria crítica | ≤ 10% e descarregando | 100 (fura tudo) | 5 min |
| Bateria fraca | ≤ 20% e descarregando | 60 | 20 min |
| Bateria cheia | ≥ 97% e carregando | 30 | 60 min |
| Evento chegando | evento **sem lembrete** começando em ≤ 10 min | 70 | 6 h |
| Tarefas vencidas | há tarefas vencidas | 20 | 4 h |

Exemplos falados:

- "Senhor, a bateria está crítica, em 8%. Conecte o carregador."
- "A bateria está em 18%. Talvez seja bom conectar o carregador."
- "Senhor, em 7 minutos: Reunião."
- "Você tem 3 tarefas vencidas."

O heads-up de evento cobre eventos **sem** `remindMinutes` (os com lead já são
avisados pela camada agendada), evitando aviso duplicado.

## Bateria

Lida direto de `/sys/class/power_supply/BAT*` (`capacity` + `status`) — sem
dependências. Em desktop sem bateria, a leitura é `present:false` e nenhum aviso de
bateria é gerado.

## Configuração

`ui.proactiveAlerts` (ligado por padrão) — toggle em
Configurações > Proatividade > **"Avisos proativos (bateria, eventos)"**.
Separado de `ui.proactiveSuggestions`, que controla as sugestões discretas do
briefing.

## Testes

`tests/proactive.test.ts` (puro, sem tocar no sistema):

- `readBatteryFrom`/`readBattery`: leitura de capacidade/status e ausência;
- `buildNudges`: bateria crítica/fraca/cheia, heads-up de evento (e ignorar os com
  lead/fora da janela), tarefas vencidas;
- `pickProactiveNudge`: prioridade, cooldown, silêncio noturno e intervalo mínimo
  (com o crítico furando as restrições).
