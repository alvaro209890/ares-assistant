// Padrão Command para as ferramentas do agente. Antes era um switch de 38+ cases
// dentro de agent/router.ts; agora cada ferramenta vira um `ToolCommand` registrado
// num `CommandRegistry` central. O router só despacha; categorias são arquivos
// separados, fáceis de estender e testar.

import type { Acao, AppConfig } from '../../shared/types'
import type { ActivityMeta } from '../agent/activity'
import type {
  ActivityFn,
  DeltaFn,
  HiveStatusFn,
  ProgressFn,
  TaskProgressFn,
  ToolResult
} from '../agent/types'
import type { TurnTrace } from '../agent/trace'

// Categorias servem só para documentação/organização — não influenciam despacho.
export type ToolCategory =
  | 'conversation'
  | 'system'
  | 'brain'
  | 'code-read'
  | 'code-exec'
  | 'code-write'
  | 'code-quality'
  | 'hive'
  | 'briefing'

// Contexto entregue a cada comando. Para ferramentas curtas (`calcular`, `area.ler`),
// quase tudo aqui é opcional. Para tarefas longas (`codigo.testar`, `codigo.diagnostico`),
// `reportProgress` + `pipeProgress` + `beating` resolvem o feedback ao usuário.
export interface ToolContext {
  cfg: AppConfig
  sessionId: string
  phase: number
  signal?: AbortSignal
  onDelta?: DeltaFn
  onActivity?: ActivityFn
  onHive?: HiveStatusFn
  trace?: TurnTrace
  // Metadata da atividade já calculada pelo dispatcher; comandos usam-na para piping
  // de saídas (codeActivityMeta + createProgressActivity).
  activity: ActivityMeta | null
  // Reporta status de alto nível pra HUD (frontend). Inicial 'start' e final 'end'
  // são emitidos automaticamente pelo dispatcher quando `reportsProgress: true`.
  // Comandos longos chamam `reportProgress` no meio para reportar o passo atual.
  reportProgress: (label: string, percent?: number) => void
  // Pipe pronto pra stdout/stderr (anexa ao AgentActivityEvent).
  pipeProgress: ProgressFn
  // Wrapper de heartbeat para "Esperando o LLM..." durante awaits longos.
  beating: <T>(work: Promise<T>) => Promise<T>
}

export interface ToolCommand {
  tipo: string
  category?: ToolCategory
  // Quando true, dispatcher emite start/end no canal TaskProgressEvent e o comando
  // pode chamar `ctx.reportProgress(label, percent?)` para passos intermediários.
  reportsProgress?: boolean
  // Texto inicial pro HUD ("Rodando testes...", "Diagnosticando projeto..."). Se
  // omitido, dispatcher usa o título da atividade ou o `tipo` cru.
  progressLabel?: (a: Acao) => string
  // Validação prévia opcional: retorne string para falhar antes de executar.
  validate?: (a: Acao) => string | undefined
  run: (a: Acao, ctx: ToolContext) => Promise<ToolResult> | ToolResult
}

/**
 * Registro central das ferramentas. Cada categoria registra suas commands no boot
 * (via `createDefaultRegistry`); o router pede `dispatch(a, ctx)` e pronto.
 *
 * Por que classe e não Map cru: o dispatch é o ponto natural pra costurar
 * activity/trace/progress de forma uniforme — qualquer command novo herda essa
 * observabilidade sem reescrever o boilerplate.
 */
export class CommandRegistry {
  private map = new Map<string, ToolCommand>()

  register(cmd: ToolCommand): this {
    if (this.map.has(cmd.tipo)) {
      throw new Error(`CommandRegistry: ferramenta duplicada "${cmd.tipo}"`)
    }
    this.map.set(cmd.tipo, cmd)
    return this
  }

  registerAll(cmds: readonly ToolCommand[]): this {
    for (const c of cmds) this.register(c)
    return this
  }

  has(tipo: string): boolean {
    return this.map.has(tipo)
  }

  get(tipo: string): ToolCommand | undefined {
    return this.map.get(tipo)
  }

  list(): ToolCommand[] {
    return Array.from(this.map.values())
  }

  /** Tamanho atual do registro — útil em testes. */
  size(): number {
    return this.map.size
  }
}
