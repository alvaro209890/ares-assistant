// Dispatcher do registro: aplica os "cross-cutting concerns" (atividade, trace,
// progresso, heartbeat) de forma uniforme e chama o `run` do command. Os commands
// ficam livres de boilerplate; novas ferramentas herdam observabilidade sem
// reescrever nada.

import type { Acao } from '../../shared/types'
import {
  activityDetail,
  activityOk,
  codeActivityMeta,
  createProgressActivity,
  emitActivity,
  uid
} from '../agent/activity'
import { startHeartbeat } from '../voiceCode'
import type {
  ActivityFn,
  DeltaFn,
  HiveStatusFn,
  TaskProgressFn,
  ToolResult
} from '../agent/types'
import { toolErr } from '../agent/types'
import type { TurnTrace } from '../agent/trace'
import type { AppConfig } from '../../shared/types'
import type { CommandRegistry, ToolContext } from './types'

export interface DispatchContext {
  cfg: AppConfig
  sessionId: string
  phase: number
  signal?: AbortSignal
  onDelta?: DeltaFn
  onActivity?: ActivityFn
  onHive?: HiveStatusFn
  onProgress?: TaskProgressFn
  trace?: TurnTrace
}

export async function dispatchCommand(
  registry: CommandRegistry,
  a: Acao,
  ctx: DispatchContext
): Promise<ToolResult> {
  const cmd = registry.get(a.tipo)
  // Mantém o trace coerente mesmo pra "ferramenta desconhecida".
  ctx.trace?.emit('tool:start', { tipo: a.tipo })
  if (!cmd) {
    const result = toolErr(a.tipo, 'ferramenta desconhecida')
    ctx.trace?.emit('tool:end', { tipo: a.tipo, ok: false, detail: result.erro })
    return result
  }

  const validationErr = cmd.validate?.(a)
  if (validationErr) {
    const result = toolErr(a.tipo, validationErr)
    ctx.trace?.emit('tool:end', { tipo: a.tipo, ok: false, detail: validationErr })
    return result
  }

  // Activity meta serve tanto pra timeline do chat quanto pro pipe de stdout/stderr.
  const activity = codeActivityMeta(a)
  const pipeProgress = createProgressActivity(ctx.onActivity, activity)
  emitActivity(ctx.onActivity, activity, { status: 'running' })

  // Canal HUD: só emite start/end quando o command opta por reportsProgress.
  const taskId = `tp-${uid('task')}`
  const progressLabel = cmd.progressLabel?.(a) || activity?.title || a.tipo
  if (cmd.reportsProgress) {
    ctx.onProgress?.({
      id: taskId,
      tool: a.tipo,
      status: 'start',
      label: progressLabel,
      ts: Date.now()
    })
  }
  const reportProgress = (label: string, percent?: number): void => {
    if (!cmd.reportsProgress) return
    ctx.onProgress?.({
      id: taskId,
      tool: a.tipo,
      status: 'update',
      label,
      percent,
      ts: Date.now()
    })
  }
  const endProgress = (ok: boolean): void => {
    if (!cmd.reportsProgress) return
    ctx.onProgress?.({
      id: taskId,
      tool: a.tipo,
      status: 'end',
      label: progressLabel,
      ok,
      ts: Date.now()
    })
  }

  const beating = async <T,>(work: Promise<T>): Promise<T> => {
    const stop = startHeartbeat(ctx.onDelta, ctx.phase)
    try {
      return await work
    } finally {
      stop()
    }
  }

  const toolCtx: ToolContext = {
    cfg: ctx.cfg,
    sessionId: ctx.sessionId,
    phase: ctx.phase,
    signal: ctx.signal,
    onDelta: ctx.onDelta,
    onActivity: ctx.onActivity,
    onHive: ctx.onHive,
    trace: ctx.trace,
    activity,
    reportProgress,
    pipeProgress,
    beating
  }

  let result: ToolResult
  try {
    result = await cmd.run(a, toolCtx)
  } catch (e) {
    result = toolErr(a.tipo, e instanceof Error ? e.message : String(e))
  }

  // Atividade final: erro / espera (requiresApproval) / sucesso.
  if (result.erro !== undefined) {
    emitActivity(ctx.onActivity, activity, { status: 'error', detail: result.erro, ok: false })
  } else {
    const o = result.resultado as Record<string, unknown> | undefined
    if (o && o.requiresApproval === true) {
      emitActivity(ctx.onActivity, activity, {
        status: 'waiting',
        detail: String(o.reason || 'aguardando autorização'),
        command: typeof o.command === 'string' ? o.command : activity?.command,
        ok: false
      })
    } else {
      emitActivity(ctx.onActivity, activity, {
        status: 'done',
        detail: activityDetail(result),
        ok: activityOk(result)
      })
    }
  }
  ctx.trace?.emit('tool:end', {
    tipo: a.tipo,
    ok: result.erro === undefined,
    detail: activityDetail(result)
  })
  endProgress(result.erro === undefined)
  return result
}
