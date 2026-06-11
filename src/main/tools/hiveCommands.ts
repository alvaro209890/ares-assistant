// Colmeia (Atena / Hefesto / Têmis). Cada subagente é demorado (busca evidências
// + chamada ao LLM); reportsProgress fornece "Reunindo evidências..." → "Atena
// pensando..." na HUD. Os relatórios viram resumo no envelope ToolResult.

import { loadMemory } from '../data'
import {
  AUDITOR,
  ENGINEER,
  RESEARCHER,
  executeSubagentTask,
  relevantMemories,
  type SubagentProfile,
  type SubagentTask
} from '../subagents'
import { buildTaskContext, gatherSubagentEvidence } from '../agent/hive'
import { toolErr, toolOk } from '../agent/types'
import type { ToolCommand } from './types'

function makeHiveCommand(tipo: string, profile: SubagentProfile, label: string): ToolCommand {
  return {
    tipo,
    category: 'hive',
    reportsProgress: true,
    progressLabel: (a) => `${label}: ${String(a.objetivo || a.tarefa || a.consulta || '').slice(0, 60) || 'preparando'}`,
    async run(a, ctx) {
      const goal = String(a.objetivo || a.tarefa || a.consulta || a.texto || '').trim()
      if (!goal) return toolErr(a.tipo, 'Diga o objetivo da tarefa para o subagente.')
      const { cfg, sessionId, signal, beating, pipeProgress, onHive, trace, reportProgress } = ctx
      const gatherDetail =
        profile.id === 'researcher'
          ? 'Reunindo fontes na web...'
          : profile.id === 'engineer'
            ? 'Mapeando o projeto...'
            : 'Rodando o diagnóstico do projeto...'

      const r = await beating(
        (async () => {
          onHive?.({ id: profile.id, label: profile.label, phase: 'thinking', detail: gatherDetail, updatedAt: Date.now() })
          trace?.emit('hive:gather', { agent: profile.id })
          reportProgress(gatherDetail)
          const task: SubagentTask = {
            goal,
            context: buildTaskContext(sessionId, a.contexto ? String(a.contexto) : undefined),
            evidence: await gatherSubagentEvidence(profile, a, cfg, goal, signal, pipeProgress),
            memories: relevantMemories(goal, loadMemory())
          }
          reportProgress(`${profile.label} elaborando relatório...`)
          const result = await executeSubagentTask(profile, task, cfg, onHive, signal)
          trace?.emit('hive:report', { agent: profile.id, ok: result.ok, durationMs: result.durationMs })
          return result
        })()
      )
      return toolOk(a.tipo, {
        agente: r.label,
        ok: r.ok,
        duracaoMs: r.durationMs,
        summary: `${r.label}: relatório ${r.ok ? 'entregue' : 'com falha'} em ${Math.round(r.durationMs / 1000)}s`,
        relatorio: r.report
      })
    }
  }
}

export const hiveCommands: ToolCommand[] = [
  makeHiveCommand('subagente.pesquisar', RESEARCHER, 'Atena investigando'),
  makeHiveCommand('subagente.construir', ENGINEER, 'Hefesto projetando'),
  makeHiveCommand('subagente.auditar', AUDITOR, 'Têmis auditando')
]
