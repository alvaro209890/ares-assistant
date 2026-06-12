// Código: execução de comandos. comando livre, terminal (com fluxo de aprovação),
// confirmar/cancelar pendente. Todos longos → reportsProgress.

import { classifyCommand, isLongRunningCommand, runCodeCommand, runCodeTerminal } from '../code'
import { setLastTerminalCommand } from '../data'
import { clearPendingCode, getPendingCode, setPendingCode } from '../pending'
import { announceLongTask } from '../agent/activity'
import { toolErr, toolOk } from '../agent/types'
import { argRoot } from './util'
import type { ToolCommand } from './types'
import { startSentinel, stopSentinels } from '../sentinelManager'

export const codeExecCommands: ToolCommand[] = [
  {
    tipo: 'codigo.comando',
    category: 'code-exec',
    reportsProgress: true,
    progressLabel: (a) => `Rodando: ${String(a.comando || a.command || '').slice(0, 60)}`,
    async run(a, { cfg, signal, beating, pipeProgress, reportProgress }) {
      const command = String(a.comando || a.command || '')
      reportProgress(`Executando "${command.slice(0, 60)}"...`)
      return toolOk(
        a.tipo,
        await beating(
          runCodeCommand(cfg, {
            root: argRoot(a),
            command,
            signal,
            onProgress: pipeProgress
          })
        )
      )
    }
  },
  {
    tipo: 'codigo.terminal',
    category: 'code-exec',
    reportsProgress: true,
    progressLabel: (a) => `Terminal: ${String(a.comando || a.command || '').slice(0, 60)}`,
    async run(a, ctx) {
      const { cfg, sessionId, signal, beating, pipeProgress, onDelta, phase, reportProgress, activity } = ctx
      const root = argRoot(a)
      const command = String(a.comando || a.command || '')
      const approved =
        a.confirmado === true || a.autorizado === true || a.confirm === true || a.approved === true
      announceLongTask(onDelta, isLongRunningCommand, command, approved || classifyCommand(cfg, command).tier === 'allowed', phase)
      reportProgress(`Executando terminal "${command.slice(0, 60)}"...`)
      const result = await beating(
        runCodeTerminal(cfg, { root, command, approved, sessionId, signal, onProgress: pipeProgress })
      )
      if (result.requiresApproval) {
        setPendingCode(sessionId, { kind: 'terminal', command: result.command, root, reason: result.reason })
      } else if (result.ran) {
        clearPendingCode(sessionId)
        if (result.ok) setLastTerminalCommand(result.command, result.root)
      }
      // O dispatcher emite waiting/done conforme requiresApproval — só passamos o
      // resultado adiante. `activity` é só para auxiliar caso o command queira injetar
      // mais detalhe; aqui basta o resultado padrão.
      void activity
      return toolOk(a.tipo, result)
    }
  },
  {
    tipo: 'codigo.confirmar',
    category: 'code-exec',
    reportsProgress: true,
    progressLabel: () => 'Executando comando autorizado...',
    async run(a, ctx) {
      const { cfg, sessionId, signal, beating, pipeProgress, onDelta, phase, activity, reportProgress } = ctx
      const pend = getPendingCode(sessionId)
      if (!pend) return toolErr(a.tipo, 'Não há nenhum comando pendente de autorização.')

      if (pend.kind === 'observar') {
        clearPendingCode(sessionId)
        reportProgress(`Iniciando sentinela para "${pend.command.slice(0, 60)}"...`)
        const result = await startSentinel(sessionId, pend.command, pend.root || argRoot(a))
        return toolOk(a.tipo, result)
      }

      if (activity && !activity.command) activity.command = pend.command
      announceLongTask(onDelta, isLongRunningCommand, pend.command, true, phase)
      reportProgress(`Executando "${pend.command.slice(0, 60)}"...`)
      const result = await beating(
        runCodeTerminal(cfg, { root: pend.root, command: pend.command, approved: true, sessionId, signal, onProgress: pipeProgress })
      )
      if (result.ran) {
        clearPendingCode(sessionId)
        if (result.ok) setLastTerminalCommand(result.command, result.root)
      }
      return toolOk(a.tipo, result)
    }
  },
  {
    tipo: 'codigo.cancelar',
    category: 'code-exec',
    run(a, { sessionId }) {
      const had = !!getPendingCode(sessionId)
      clearPendingCode(sessionId)
      return toolOk(a.tipo, { cancelado: had, mensagem: had ? 'comando pendente descartado' : 'nada pendente' })
    }
  },
  {
    tipo: 'codigo.observar',
    category: 'code-exec',
    reportsProgress: true,
    progressLabel: (a) => `Observando: ${String(a.comando || a.command || '').slice(0, 60)}`,
    async run(a, { cfg, sessionId, reportProgress }) {
      const command = String(a.comando || a.command || '')
      const root = argRoot(a)
      const approved =
        a.confirmado === true || a.autorizado === true || a.confirm === true || a.approved === true

      const cls = classifyCommand(cfg, command)
      if (cls.tier === 'blocked') {
        throw new Error(`Comando bloqueado por segurança: ${cls.reason}`)
      }

      const autoApprove = cfg.integrations.code.terminalAutoApprove === true
      if (cls.tier === 'confirm' && !approved && !autoApprove) {
        setPendingCode(sessionId, { kind: 'observar', command, root, reason: cls.reason })
        return toolOk(a.tipo, { requiresApproval: true, command, reason: cls.reason })
      }

      reportProgress(`Iniciando observação de "${command.slice(0, 60)}"...`)
      const result = await startSentinel(sessionId, command, root)
      return toolOk(a.tipo, result)
    }
  },
  {
    tipo: 'codigo.observar.parar',
    category: 'code-exec',
    run(a, { sessionId }) {
      const target = a.qual ? String(a.qual) : undefined
      const stoppedCount = stopSentinels(sessionId, target)
      return toolOk(a.tipo, { ok: true, stoppedCount })
    }
  }
]
