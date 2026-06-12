import { createHash } from 'crypto'
import { readJSON, writeJSON, uid } from './data'
import { parseReportTags } from './subagents/executor'
import type { WorkspaceWorklog, Acao, AppConfig } from '../shared/types'
import type { ToolResult } from './agent/types'

export function buildResumeSummary(worklog: WorkspaceWorklog, gitStatus: string, tasksRelated: string[]): string {
  if (worklog.entries.length === 0) return 'Não há histórico recente de trabalho neste projeto.'

  const last = worklog.entries[0]
  const objective = last.description.split('(')[0].trim()
  
  let stepsText = ''
  // Se o sumário contiver passos ou escopo do Hefesto
  if (last.resultSummary.includes('[ESCOPO]')) {
    const scopeMatch = last.resultSummary.match(/\[ESCOPO\](.*?)(?=\n\[|$)/s)
    const scope = scopeMatch ? scopeMatch[1].trim() : ''
    
    // Simplificando: vamos focar no escopo e arquivos
    stepsText = scope ? `Estávamos focados em: ${scope.slice(0, 80)}. ` : ''
  }

  let gitText = ''
  if (gitStatus && gitStatus.trim().length > 0) {
    const lines = gitStatus.split('\n').filter(l => l.trim())
    gitText = `O Git acusa ${lines.length} arquivo(s) com alterações pendentes. `
  } else {
    gitText = 'O Git está limpo. '
  }

  let tasksText = ''
  if (tasksRelated.length > 0) {
    tasksText = `Há ${tasksRelated.length} tarefa(s) no Kanban associadas a isso. `
  }

  return `Último registro: ${objective}. ${stepsText}${gitText}${tasksText}Como prefere continuar agora?`
}

const WORKLOG_MAX_ENTRIES = 10
const WORKLOG_MAX_CHARS = 4000

function hashRoot(root: string): string {
  return createHash('md5').update(root).digest('hex').slice(0, 12)
}

export function getWorklog(root: string): WorkspaceWorklog {
  const normRoot = root.trim()
  if (!normRoot) return { workspaceRoot: '', updatedAt: 0, entries: [] }
  const file = `worklog-${hashRoot(normRoot)}.json`
  const log = readJSON<WorkspaceWorklog>(file, { workspaceRoot: normRoot, updatedAt: Date.now(), entries: [] })
  
  // Migração suave do session-context antigo na primeira vez
  if (log.entries.length === 0) {
    const old = readJSON<any>('session-context.json', {})
    if (old.lastEditedRoot === normRoot || old.lastTerminalRoot === normRoot || (old.lastEditedFile && !old.lastEditedRoot)) {
      const summary = []
      if (old.lastEditedFile) summary.push(`Último arquivo editado: ${old.lastEditedFile}`)
      if (old.lastTerminalCommand) summary.push(`Último comando: ${old.lastTerminalCommand}`)
      if (summary.length) {
        log.entries.push({
          id: uid('wl'),
          timestamp: old.updatedAt || Date.now(),
          tool: 'migração',
          description: 'Sessão anterior migrada',
          resultSummary: summary.join('\n')
        })
        saveWorklog(log)
      }
    }
  }
  
  // Assegura ordenação
  log.entries.sort((a, b) => b.timestamp - a.timestamp)
  return log
}

export function compactWorklog(worklog: WorkspaceWorklog): WorkspaceWorklog {
  let entries = [...worklog.entries].sort((a, b) => b.timestamp - a.timestamp)
  if (entries.length > WORKLOG_MAX_ENTRIES) {
    entries = entries.slice(0, WORKLOG_MAX_ENTRIES)
  }
  
  let totalChars = entries.reduce((acc, e) => acc + (e.description?.length || 0) + (e.resultSummary?.length || 0), 0)
  while (totalChars > WORKLOG_MAX_CHARS && entries.length > 1) {
    const popped = entries.pop()!
    totalChars -= ((popped.description?.length || 0) + (popped.resultSummary?.length || 0))
  }
  
  return { ...worklog, entries }
}

export function saveWorklog(worklog: WorkspaceWorklog): void {
  if (!worklog.workspaceRoot) return
  const compacted = compactWorklog(worklog)
  const file = `worklog-${hashRoot(compacted.workspaceRoot)}.json`
  writeJSON(file, compacted)
}

export function worklogPatchFromResult(tipo: string, a: Acao, result: ToolResult, cfg: AppConfig): void {
  try {
    const root = String(a.path || a.root || cfg.integrations.code.workspaceRoot).trim()
    if (!root) return
    
    // Apenas ações relevantes para o progresso do projeto
    if (![
      'codigo.comando', 'codigo.terminal', 'codigo.criar', 'codigo.editar', 
      'codigo.testar', 'codigo.diagnostico', 'codigo.substituir',
      'subagente.construir', 'subagente.auditar', 'subagente.depurar'
    ].includes(tipo)) {
      return
    }
    
    let description = a.objetivo ? String(a.objetivo) : `${tipo}`
    if (a.comando || a.command) description += ` (${a.comando || a.command})`
    if (a.arquivo || a.file) description += ` [${a.arquivo || a.file}]`
    
    let resultSummary = ''
    let filesTouched: string[] | undefined
    
    if (result.erro) {
      resultSummary = `ERRO: ${result.erro}`
    } else {
      const o = result.resultado as any
      if (tipo.startsWith('subagente.')) {
        const report = o?.report || o?.relatorio
        if (typeof report === 'string') {
          const tags = parseReportTags(report)
          const parts = []
          if (tags.scope) parts.push(`[ESCOPO] ${tags.scope}`)
          if (tags.files?.length) {
            filesTouched = tags.files
            parts.push(`[ARQUIVOS] ${tags.files.join(', ')}`)
          }
          if (tags.verdict) parts.push(`[VEREDITO] ${tags.verdict}`)
          if (tags.validateCmd) parts.push(`[VALIDAR] ${tags.validateCmd}`)
          if (tags.rootCause) parts.push(`[CAUSA] ${tags.rootCause}`)
          resultSummary = parts.length ? parts.join('\n') : 'Relatório entregue.'
        }
      } else if (['codigo.testar', 'codigo.diagnostico', 'codigo.lint', 'codigo.typecheck'].includes(tipo)) {
        resultSummary = o?.summary || (o?.ok ? 'Passou sem erros' : 'Falhou com problemas detectados')
      } else if (['codigo.criar', 'codigo.editar', 'codigo.substituir'].includes(tipo)) {
        filesTouched = o?.file ? [o.file] : (o?.files || [])
        resultSummary = o?.changed || o?.created || o?.overwritten || (o?.matchCount && o.matchCount > 0) ? 'Alterações aplicadas.' : 'Sem mudanças efetivas.'
      } else if (['codigo.terminal', 'codigo.comando'].includes(tipo)) {
        if (o?.requiresApproval) {
          resultSummary = 'Aguardando autorização do usuário.'
        } else {
          resultSummary = o?.ok ? 'Comando executado com sucesso.' : `Falhou (código ${o?.code || '?'}). Saída:\n${(o?.stderr || o?.stdout || '').slice(-250)}`
        }
      } else {
        resultSummary = o?.ok ? 'Concluído com sucesso' : 'Finalizado'
      }
    }
    
    const log = getWorklog(root)
    log.entries.unshift({
      id: uid('wl'),
      timestamp: Date.now(),
      tool: tipo,
      description: description.slice(0, 250),
      resultSummary: resultSummary.slice(0, 1500),
      filesTouched
    })
    log.updatedAt = Date.now()
    saveWorklog(log)
  } catch (e) {
    console.error('Falha ao registrar worklog:', e)
  }
}

export function worklogSummary(root: string, maxChars = 800): string {
  const log = getWorklog(root)
  if (!log || log.entries.length === 0) return ''
  
  const now = Date.now()
  if (now - log.updatedAt > 7 * 24 * 60 * 60 * 1000) {
    return '' // Obsoleto para o prompt automático após 7 dias de inatividade
  }
  
  let out = ''
  for (const e of log.entries) {
    const time = new Date(e.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    const block = `- [${time}] ${e.tool}: ${e.description}\n  Resultado: ${e.resultSummary.replace(/\n/g, ' ')}\n`
    if (out.length + block.length > maxChars && out.length > 0) break
    out += block
  }
  return out.trim()
}
