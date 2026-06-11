# Arquitetura do agente (`src/main/agent/`)

A partir da v0.36, `src/main/agent.ts` deixou de ser um monolito (~1900 LOC) e passou a ser **fachada + orquestrador**. As responsabilidades pesadas vivem em módulos focados sob `src/main/agent/`, cada um com superfície pequena e testável.

```
src/main/
├── agent.ts            (fachada + runTurn + extractFacts; <450 LOC)
└── agent/
    ├── types.ts        # ToolResult discriminado, contratos do agente
    ├── prompt.ts       # PERSONA, toolDocs, dateAnchors, buildSystemPrompt, helpers de cérebro
    ├── activity.ts     # ActivityMeta, codeActivityMeta, emit/progresso, announceLongTask
    ├── hive.ts         # Colmeia: gather*, buildTaskContext, inferPromisedHiveAction, followups
    ├── router.ts       # runQuery (despacho tipado das 40+ ferramentas)
    ├── stream.ts       # streamTurn, finalFala, validateActions, classifyProviderError
    └── trace.ts        # TurnTrace (telemetria leve por turno)
```

## Princípios

1. **Cada módulo tem uma responsabilidade.** Quando uma ferramenta nova entra, mexe-se em router (despacho) + activity (metadata) + opcionalmente prompt (docs). Não é mais preciso ler 1900 linhas para entender ou alterar uma única ferramenta.
2. **Contratos tipados em vez de `unknown`.** Resultados de ferramenta são `ToolResult` discriminado (`ToolOk<T> | ToolErr`); helpers `toolOk(tipo, dado)` e `toolErr(tipo, msg)` substituem a convenção implícita `{ tipo, resultado, erro }`.
3. **Observabilidade pragmática.** `TurnTrace` (em `trace.ts`) acumula eventos por turno (`turn:start`, `phase`, `tool:start/end`, `hive:gather/report/inferred`, `mutation`, `fallback`, `error`) sem custar performance — só é gravado em log quando `ARES_TRACE=1`.
4. **Resiliência separada por classe de falha.** `classifyProviderError` separa `abort` / `timeout` / `transient` / `auth` / `rate` / `bad_request` / `parse` / `unknown`. Só erros classificados como `retryable` ativam a política de retry do `ninerouter`.

## Módulos

### `agent/types.ts` — contratos do agente

```ts
export type ToolResult<T = unknown> = ToolOk<T> | ToolErr
export const toolOk = <T>(tipo: string, resultado: T): ToolOk<T> => ({ tipo, resultado })
export const toolErr = (tipo: string, erro: string): ToolErr => ({ tipo, erro })
```

Também concentra `DeltaFn`, `ActivityFn`, `ProgressFn`, `DeltaKind`, `DeltaTextTransform` para reuso entre módulos sem dependência circular.

### `agent/prompt.ts`

- `PERSONA`, `VOICE_HINT`, `TEXT_HINT`, `CODE_VOICE_HINT`.
- `toolDocs()` — documentação das ferramentas para o LLM.
- `dateAnchors(now)` — âncoras de "hoje/amanhã/semana que vem".
- `brainSummary(cfg)`, `providerLabel(url)`, `modelLabel(cfg)`.
- `applyReasoningAction(cfg, a)` / `applyModelAction(cfg, a)` — ações de voz que mexem na config (`ia.raciocinio` / `ia.modelo`).
- `stripRepeatedGreeting(text)`, `finalFala(text, suppressGreeting)`, `sessionStyleHint(...)`.
- `buildSystemPrompt({...})` — monta a mensagem `system` do turno inteiro.

### `agent/activity.ts`

- `codeActivityMeta(a)` — metadata da atividade a partir da ação (título, kind, target, command).
- `emitActivity(onActivity, meta, patch)` — emissão padronizada (acrescenta id/ts/phase).
- `createProgressActivity(...)` — throttling de chunks de stdout/stderr para a UI.
- `activityDetail(result)`, `activityOk(result)` — detalhe/ok extraídos do resultado.
- `announceLongTask(...)` — fala "iniciando a tarefa, senhor" antes de bloquear em build/install/test.
- `uid(prefix)` — gerador de id estável.

### `agent/hive.ts`

- `gatherResearcherEvidence(a, goal)` — Atena.
- `gatherEngineerEvidence(cfg, root, goal, signal, progress)` — Hefesto.
- `gatherAuditorEvidence(cfg, root, signal, progress)` — Têmis.
- `gatherSubagentEvidence(profile, a, cfg, goal, ...)` — despachante.
- `buildTaskContext(sessionId, actionContext?)` — contexto orientado a tarefa (com `compactSubagentContext` como alias retrocompatível).
- `inferPromisedHiveAction(fala, userText, acoes)` — guarda determinística do protocolo.
- `hiveFollowupInstruction(results, voice)` — instrução pós-relatório.
- `proactiveCodeFollowup(cfg, results)` — sugestão proativa (briefing do Hefesto → aplicar/coder; criação → validar).

### `agent/router.ts`

```ts
export interface RouterContext {
  cfg: AppConfig
  sessionId: string
  phase: number
  signal?: AbortSignal
  onDelta?: DeltaFn
  onActivity?: ActivityFn
  onHive?: HiveStatusFn
  trace?: TurnTrace
}
export async function runQuery(a: Acao, ctx: RouterContext): Promise<ToolResult>
```

O `switch` continua aqui (38+ ferramentas) mas:
- Helpers `argRoot(a)` / `argFile(a)` / `argLimit(a)` eliminam repetição.
- Cada case devolve via `toolOk(...)` / `toolErr(...)`.
- O `trace` (opcional) recebe `tool:start` / `tool:end` para cada despacho.

### `agent/stream.ts`

```ts
export type ProviderErrorKind = 'abort' | 'timeout' | 'transient' | 'auth' | 'rate' | 'bad_request' | 'parse' | 'unknown'
export function classifyProviderError(e: unknown): { kind, retryable, status?, message }
export async function streamTurn(cfg, messages, phase, onDelta?, kind?, transform?, signal?)
export function finalFala(text, suppressGreeting): string
export function validateActions(acoes): { valid, notes }
```

`streamTurn` agora consulta `classifyProviderError`:
- `abort` → respeita imediatamente (não cai para chatJSON).
- Já emitiu texto e o stream caiu → finaliza com o parcial (evita duplicar fala).
- Stream falhou sem emitir nada → tenta `chatJSON` uma vez.

### `agent/trace.ts`

```ts
export interface TurnTrace {
  id: string
  sessionId: string
  events: TraceEvent[]
  emit(kind, data?): void
  preview(): TraceSummary  // últimos ≤50 eventos
  end(summary?): TraceSummary
}
export function createTrace(sessionId): TurnTrace
export function nullTrace(): TurnTrace  // no-op completo
```

- Cap de **200 eventos** por turno.
- Log físico só com `ARES_TRACE=1` (via `logger.debug`).
- Útil para testes: o teste pode inspecionar `trace.events` e fazer asserts em decisões reais do agente.

## Resiliência do `ninerouter`

O `chatJSON` ganhou política explícita de retry:

```
maxAttempts = 3  (1 inicial + 2 retries com 300ms / 900ms)
TRANSIENT_STATUSES = { 408, 425, 429, 500, 502, 503, 504 }
```

Política:

| Caso | Comportamento |
|---|---|
| 2xx | Retorna `content` |
| 400/422 | Fallback de compat: tenta sem `reasoning_effort`, depois sem `response_format` |
| 401/403/404 | Lança imediatamente (auth/notfound não é transitório) |
| 429/5xx (408/425/429/500-504) | Retry com backoff (300ms, 900ms) |
| Erro de rede sem status | Retry com backoff |
| `AbortSignal` abortado | Lança `Error('abort')` imediatamente, sem novas tentativas |

O `streamChat` (SSE) continua com timeout interno (60s sem chunk). O `streamTurn` chama `classifyProviderError` para decidir entre **finalizar parcial** ou **cair pra chatJSON**.

## Como rastrear um turno em debug

```bash
ARES_TRACE=1 npm run dev
```

Cada `runTurn` emite no `logger.debug` linhas como:

```
agent.trace [t-l9k…-1] turn:start {"sessionId":"sess-…"}
agent.trace [t-l9k…-1] phase {"n":1,"kind":"initial"}
agent.trace [t-l9k…-1] tool:start {"tipo":"codigo.workspace"}
agent.trace [t-l9k…-1] tool:end {"tipo":"codigo.workspace","ok":true,"detail":"ares-assistant"}
agent.trace [t-l9k…-1] hive:gather {"agent":"engineer"}
agent.trace [t-l9k…-1] hive:report {"agent":"engineer","ok":true,"durationMs":4321}
agent.trace [t-l9k…-1] mutation {"count":1,"outcome":"applied"}
agent.trace [t-l9k…-1] end (5800ms, 12 ev) {"voice":false,"phases":2,"rounds":1,"mutations":1}
```

O `summary` final responde "que decisão o manager tomou neste turno" sem precisar instrumentar caso-a-caso.

## Cobertura de testes

- `tests/agent-stream.test.ts` — `classifyProviderError` (8 testes cobrindo todos os `kind`).
- `tests/agent-trace.test.ts` — `TurnTrace` (ordem, preview, cap, nullTrace).
- `tests/ninerouter.test.ts` — política de retry transitório (sucesso após 503, sem retry em 401, esgotamento em 5xx persistente, aborto respeitado).
- `tests/agent.test.ts` — `runTurn` end-to-end (continua intacto após a extração).
- `tests/subagents.test.ts` — Colmeia (continua intacto).
