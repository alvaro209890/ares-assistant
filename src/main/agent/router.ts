// Roteador de ferramentas: aceita uma Acao tipada e devolve um ToolResult
// discriminado ({ tipo, resultado } | { tipo, erro }).
//
// Mantém o despacho num lugar só, mas com helpers tipados (toolOk/toolErr,
// argRoot/argFile/...) para que cada case fique curto e a leitura
// transversal não obrigue a remontar `String(a.path || a.raiz || ...)` 40 vezes.
//
// Não conhece a Colmeia em si — quem coleta evidência é hive.ts; o roteador
// só monta a tarefa e chama executeSubagentTask.

import type { Acao, AppConfig, CodeEditMode } from '../../shared/types'
import { buildBriefing } from '../briefing'
import { boardSummary } from '../tasks'
import { loadBoard } from '../tasks'
import {
  applyCodePatch,
  buildCodeIndex,
  classifyCommand,
  diagnoseProject,
  editCodeFile,
  findCodeReferences,
  isLongRunningCommand,
  listCodeFiles,
  outlineCodeFile,
  previewCodePatch,
  readCodeFile,
  replaceInProject,
  runCodeCommand,
  runCodeGit,
  runCodeTerminal,
  runTests,
  runLint,
  runFormat,
  runTypecheck,
  checkDependencies,
  scanTodos,
  scaffoldProject,
  searchCode,
  summarizeCodeWorkspace,
  writeCodeFile
} from '../code'
import { runCoderTask } from '../coder'
import { clearPendingCode, getPendingCode, setPendingCode } from '../pending'
import {
  loadEvents,
  loadMemory,
  searchSessions,
  setLastEditedFile,
  setLastTerminalCommand,
  userDataDir
} from '../data'
import { getSystemMetrics, readClipboard, writeClipboard } from '../system'
import {
  runBrightness,
  runLock,
  runMedia,
  runOpen,
  runScreenshot,
  runVolume,
  type BrightnessAction,
  type MediaAction,
  type VolumeAction
} from '../control'
import { undoLast } from '../history'
import {
  AUDITOR,
  ENGINEER,
  RESEARCHER,
  executeSubagentTask,
  relevantMemories,
  type SubagentProfile,
  type SubagentTask
} from '../subagents'
import { calcExpression, convertCurrency, convertUnit, getNews, getWeather, getWeatherAt, readPage, webSearch } from '../tools'
import { startHeartbeat } from '../voiceCode'
import {
  activityDetail,
  activityOk,
  announceLongTask,
  codeActivityMeta,
  createProgressActivity,
  emitActivity
} from './activity'
import { buildTaskContext, gatherSubagentEvidence } from './hive'
import { applyModelAction, applyReasoningAction } from './prompt'
import type { ActivityFn, DeltaFn, HiveWorkerStatus, ToolResult } from './types'
import { toolErr, toolOk } from './types'
import type { TurnTrace } from './trace'

type HiveStatusFn = (status: HiveWorkerStatus) => void

// --- helpers de leitura de Acao --------------------------------------------
const norm = (s: unknown): string => String(s ?? '').toLowerCase().trim()
const argRoot = (a: Acao): string => String(a.path || a.raiz || a.workspace || '')
const argFile = (a: Acao): string => String(a.arquivo || a.file || '')
const argLimit = (a: Acao): number | undefined => Number(a.limite || a.max || 0) || undefined

function normVolumeAction(raw: unknown): VolumeAction {
  const s = norm(raw)
  if (/(des ?mut|religa|tira.*mudo|unmute|liga.*som)/.test(s)) return 'unmute'
  if (/(mut|mudo|silenci|sem som)/.test(s)) return 'mute'
  if (/(toggle|alterna)/.test(s)) return 'toggle'
  if (/(up|aument|sub|mais|\+|alto)/.test(s)) return 'up'
  if (/(down|dimin|baix|menos|-)/.test(s)) return 'down'
  return 'set'
}
function normMediaAction(raw: unknown): MediaAction {
  const s = norm(raw)
  if (/(prox|próx|pul|next|avan|frente|adiant)/.test(s)) return 'next'
  if (/(anter|volt|previous|prev|retroce)/.test(s)) return 'previous'
  if (/(stop|parar|^pare|interromp)/.test(s)) return 'stop'
  if (/(continu|retoma|despaus|resume|^play|^toca|^tocar)/.test(s)) return 'play'
  if (/(paus)/.test(s)) return 'pause'
  return 'playpause'
}
function normBrightnessAction(raw: unknown): BrightnessAction {
  const s = norm(raw)
  if (/(up|aument|sub|mais|clar|ilumin)/.test(s)) return 'up'
  if (/(down|dimin|baix|menos|escur)/.test(s)) return 'down'
  return 'set'
}

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

/**
 * Despacha uma ação para a ferramenta correspondente. Sempre devolve um
 * ToolResult — falhas viram `erro` no envelope, nunca propagam como exception.
 * Por design, atividades (start/output/done/error) são emitidas aqui dentro,
 * para que cada case não precise repetir `emit`.
 */
export async function runQuery(a: Acao, ctx: RouterContext): Promise<ToolResult> {
  const { cfg, sessionId, signal, onActivity, onDelta, onHive, trace, phase } = ctx
  const integrations = cfg.integrations
  const activity = codeActivityMeta(a)
  const progress = createProgressActivity(onActivity, activity)
  const beating = async <T,>(work: Promise<T>): Promise<T> => {
    const stop = startHeartbeat(onDelta, phase)
    try {
      return await work
    } finally {
      stop()
    }
  }
  const done = (result: ToolResult): ToolResult => {
    if (result.erro !== undefined) {
      emitActivity(onActivity, activity, { status: 'error', detail: result.erro, ok: false })
    } else {
      const o = result.resultado as Record<string, unknown> | undefined
      if (o && o.requiresApproval === true) {
        emitActivity(onActivity, activity, {
          status: 'waiting',
          detail: String(o.reason || 'aguardando autorização'),
          command: typeof o.command === 'string' ? o.command : activity?.command,
          ok: false
        })
      } else {
        emitActivity(onActivity, activity, { status: 'done', detail: activityDetail(result), ok: activityOk(result) })
      }
    }
    trace?.emit('tool:end', { tipo: a.tipo, ok: result.erro === undefined, detail: activityDetail(result) })
    return result
  }
  emitActivity(onActivity, activity, { status: 'running' })
  trace?.emit('tool:start', { tipo: a.tipo })
  try {
    switch (a.tipo) {
      // ---- conversação / web / agenda ------------------------------------------------
      case 'clima.consultar': {
        const city = String(a.cidade || '').trim()
        const resultado = city
          ? await getWeather(city)
          : integrations.location.enabled && typeof integrations.location.latitude === 'number'
            ? await getWeatherAt(integrations.location)
            : await getWeather(integrations.weatherCity)
        return toolOk(a.tipo, resultado)
      }
      case 'web.buscar':
        return toolOk(a.tipo, await webSearch(String(a.consulta || a.query || '')))
      case 'noticias.listar':
        return toolOk(a.tipo, await getNews(String(a.tema || integrations.newsTopic || '')))
      case 'agenda.listar': {
        const dia = a.dia ? String(a.dia).slice(0, 10) : null
        const evs = loadEvents().filter((e) => (dia ? e.whenISO.slice(0, 10) === dia : true))
        return toolOk(a.tipo, evs.map((e) => ({ titulo: e.title, quando: e.whenISO, descricao: e.description })))
      }
      case 'tarefa.listar':
        return toolOk(a.tipo, boardSummary(loadBoard()))
      case 'calcular':
        return toolOk(a.tipo, calcExpression(String(a.expressao || a.conta || '')))
      case 'converter.moeda':
        return toolOk(a.tipo, await convertCurrency(String(a.de || ''), String(a.para || ''), Number(a.valor)))
      case 'converter.unidade':
        return toolOk(a.tipo, convertUnit(String(a.de || ''), String(a.para || ''), Number(a.valor)))
      case 'pagina.ler':
        return toolOk(a.tipo, await readPage(String(a.url || a.endereco || a.link || '')))

      // ---- sistema / controle --------------------------------------------------------
      case 'sistema.status':
        return toolOk(a.tipo, getSystemMetrics())
      case 'area.ler': {
        const c = readClipboard()
        return c.vazio ? toolErr(a.tipo, 'A área de transferência está vazia.') : toolOk(a.tipo, c)
      }
      case 'area.escrever':
        return toolOk(a.tipo, writeClipboard(String(a.texto || a.text || a.conteudo || a.content || '')))
      case 'sistema.abrir':
        return toolOk(a.tipo, runOpen(cfg, String(a.alvo || a.target || a.app || a.aplicativo || a.url || a.programa || '')))
      case 'sistema.volume': {
        const level = Number(a.nivel ?? a.level ?? a.valor ?? a.percentual)
        const action = normVolumeAction(a.acao ?? a.action ?? a.direcao)
        if (action === 'set' && !Number.isFinite(level)) {
          return toolErr(a.tipo, 'Diga o nível (0 a 100) ou se é para aumentar, diminuir ou mutar.')
        }
        return toolOk(a.tipo, runVolume(cfg, { action, level }))
      }
      case 'sistema.bloquear':
        return toolOk(a.tipo, runLock(cfg))
      case 'sistema.captura':
        return toolOk(a.tipo, runScreenshot(cfg))
      case 'sistema.midia':
        return toolOk(a.tipo, runMedia(cfg, normMediaAction(a.acao ?? a.action ?? a.comando)))
      case 'sistema.brilho': {
        const level = Number(a.nivel ?? a.level ?? a.valor ?? a.percentual)
        const action = normBrightnessAction(a.acao ?? a.action ?? a.direcao)
        if (action === 'set' && !Number.isFinite(level)) {
          return toolErr(a.tipo, 'Diga o nível do brilho (0 a 100) ou se é para clarear ou escurecer.')
        }
        return toolOk(a.tipo, runBrightness(cfg, { action, level }))
      }

      // ---- cérebro / configuração ----------------------------------------------------
      case 'ia.raciocinio': {
        const r = applyReasoningAction(cfg, a)
        return r.erro ? toolErr(a.tipo, r.erro) : toolOk(a.tipo, r.resultado)
      }
      case 'ia.modelo': {
        const r = applyModelAction(cfg, a)
        return r.erro ? toolErr(a.tipo, r.erro) : toolOk(a.tipo, r.resultado)
      }
      case 'desfazer': {
        const r = undoLast(userDataDir())
        return r.ok ? toolOk(a.tipo, { ok: true, desfeito: r.label || 'a última alteração' }) : toolErr(a.tipo, 'Não há nada para desfazer.')
      }
      case 'memoria.buscar':
        return toolOk(a.tipo, searchSessions(String(a.consulta || a.query || a.texto || ''), Number(a.limite || a.limit || 5)))

      // ---- código: leitura / navegação ------------------------------------------------
      case 'codigo.workspace':
        return done(toolOk(a.tipo, summarizeCodeWorkspace(cfg, argRoot(a))))
      case 'codigo.buscar':
        return done(toolOk(a.tipo, searchCode(cfg, {
          root: argRoot(a),
          query: String(a.consulta || a.query || a.simbolo || ''),
          filter: a.filtro ? String(a.filtro) : a.glob ? String(a.glob) : undefined,
          maxResults: argLimit(a)
        })))
      case 'codigo.ler':
        return done(toolOk(a.tipo, readCodeFile(cfg, {
          root: argRoot(a),
          file: argFile(a),
          startLine: Number(a.inicio || a.start || 0) || undefined,
          lines: Number(a.linhas || a.lines || 0) || undefined
        })))
      case 'codigo.listar':
        return done(toolOk(a.tipo, listCodeFiles(cfg, {
          root: argRoot(a),
          pattern: String(a.padrao || a.pattern || a.filtro || a.glob || ''),
          maxResults: argLimit(a)
        })))
      case 'codigo.esboco':
        return done(toolOk(a.tipo, outlineCodeFile(cfg, { root: argRoot(a), file: argFile(a) })))
      case 'codigo.referencias':
        return done(toolOk(a.tipo, findCodeReferences(cfg, {
          root: argRoot(a),
          symbol: String(a.simbolo || a.symbol || a.nome || a.consulta || ''),
          maxResults: argLimit(a)
        })))
      case 'codigo.git':
        return done(toolOk(a.tipo, await runCodeGit(cfg, {
          root: argRoot(a),
          operation: String(a.operacao || a.operation || 'status'),
          file: a.arquivo || a.file ? String(a.arquivo || a.file) : undefined,
          signal,
          onProgress: progress
        })))
      case 'codigo.indexar':
        return done(toolOk(a.tipo, buildCodeIndex(cfg, {
          root: argRoot(a),
          refresh: a.refresh === true || a.atualizar === true
        })))

      // ---- código: execução de comandos ----------------------------------------------
      case 'codigo.comando':
        return done(toolOk(a.tipo, await beating(runCodeCommand(cfg, {
          root: argRoot(a),
          command: String(a.comando || a.command || ''),
          signal,
          onProgress: progress
        }))))
      case 'codigo.terminal': {
        const root = argRoot(a)
        const command = String(a.comando || a.command || '')
        const approved = a.confirmado === true || a.autorizado === true || a.confirm === true || a.approved === true
        announceLongTask(onDelta, isLongRunningCommand, command, approved || classifyCommand(cfg, command).tier === 'allowed', phase)
        const result = await beating(runCodeTerminal(cfg, { root, command, approved, signal, onProgress: progress }))
        if (result.requiresApproval) {
          setPendingCode(sessionId, { kind: 'terminal', command: result.command, root, reason: result.reason })
        } else if (result.ran) {
          clearPendingCode(sessionId)
          if (result.ok) setLastTerminalCommand(result.command, result.root)
        }
        return done(toolOk(a.tipo, result))
      }
      case 'codigo.confirmar': {
        const pend = getPendingCode(sessionId)
        if (!pend) return done(toolErr(a.tipo, 'Não há nenhum comando pendente de autorização.'))
        if (activity && !activity.command) activity.command = pend.command
        announceLongTask(onDelta, isLongRunningCommand, pend.command, true, phase)
        const result = await beating(runCodeTerminal(cfg, { root: pend.root, command: pend.command, approved: true, signal, onProgress: progress }))
        if (result.ran) {
          clearPendingCode(sessionId)
          if (result.ok) setLastTerminalCommand(result.command, result.root)
        }
        return done(toolOk(a.tipo, result))
      }
      case 'codigo.cancelar': {
        const had = !!getPendingCode(sessionId)
        clearPendingCode(sessionId)
        return done(toolOk(a.tipo, { cancelado: had, mensagem: had ? 'comando pendente descartado' : 'nada pendente' }))
      }

      // ---- código: escrita / scaffold ------------------------------------------------
      case 'codigo.scaffold': {
        const resultado = scaffoldProject(cfg, {
          tipo: String(a.tipo_projeto || a.template || a.modelo || a.kind || 'site'),
          nome: String(a.nome || a.name || a.projeto || ''),
          path: String(a.path || a.raiz || a.destino || a.onde || ''),
          force: a.force === true || a.forcar === true
        })
        if (resultado.created[0]) setLastEditedFile(resultado.created[0], resultado.root)
        return done(toolOk(a.tipo, resultado))
      }
      case 'codigo.criar': {
        const resultado = writeCodeFile(cfg, {
          root: argRoot(a),
          file: argFile(a),
          content: String(a.conteudo ?? a.content ?? a.texto ?? ''),
          overwrite: a.sobrescrever === true || a.overwrite === true
        })
        setLastEditedFile(resultado.file, argRoot(a) || undefined)
        return done(toolOk(a.tipo, resultado))
      }
      case 'codigo.editar': {
        const mode = String(a.modo || a.mode || '') as CodeEditMode
        const resultado = editCodeFile(cfg, {
          root: argRoot(a),
          file: argFile(a),
          mode,
          oldText: a.antigo || a.oldText || a.find ? String(a.antigo || a.oldText || a.find) : undefined,
          newText: String(a.novo ?? a.newText ?? a.replace ?? ''),
          anchor: a.ancora || a.anchor ? String(a.ancora || a.anchor) : undefined,
          startLine: Number(a.inicio || a.startLine || a.start || 0) || undefined,
          endLine: Number(a.fim || a.endLine || a.end || 0) || undefined,
          replaceAll: a.todos === true || a.replaceAll === true || a.all === true,
          expectedMatches: Number.isFinite(Number(a.esperado ?? a.expectedMatches))
            ? Number(a.esperado ?? a.expectedMatches)
            : undefined
        })
        setLastEditedFile(resultado.file, argRoot(a) || undefined)
        return done(toolOk(a.tipo, resultado))
      }
      case 'codigo.substituir': {
        const apply = a.confirmado === true || a.aplicar === true || a.apply === true
        const resultado = replaceInProject(cfg, {
          root: argRoot(a),
          find: String(a.de ?? a.find ?? a.antigo ?? ''),
          replace: String(a.para ?? a.replace ?? a.novo ?? ''),
          filter: a.filtro || a.filter ? String(a.filtro || a.filter) : undefined,
          apply
        })
        if (resultado.applied && resultado.files[0]) setLastEditedFile(resultado.files[0].file, resultado.root)
        return done(toolOk(a.tipo, resultado))
      }
      case 'codigo.patch.preview':
        return done(toolOk(a.tipo, previewCodePatch(cfg, { root: argRoot(a), diff: a.diff, patches: a.patches })))
      case 'codigo.patch.aplicar': {
        const resultado = applyCodePatch(cfg, { root: argRoot(a), diff: a.diff, patches: a.patches })
        if (resultado.applied && resultado.files[0]) setLastEditedFile(resultado.files[0], resultado.root)
        return done(toolOk(a.tipo, resultado))
      }

      // ---- código: qualidade / diagnóstico -------------------------------------------
      case 'codigo.diagnostico':
        return done(toolOk(a.tipo, await beating(diagnoseProject(cfg, { root: argRoot(a), signal, onProgress: progress }))))
      case 'codigo.testar':
        return done(toolOk(a.tipo, await beating(runTests(cfg, { root: argRoot(a), signal, onProgress: progress }))))
      case 'codigo.lint':
        return done(toolOk(a.tipo, await beating(runLint(cfg, { root: argRoot(a), signal, onProgress: progress }))))
      case 'codigo.formatar':
        return done(toolOk(a.tipo, await beating(runFormat(cfg, { root: argRoot(a), signal, onProgress: progress }))))
      case 'codigo.typecheck':
        return done(toolOk(a.tipo, await beating(runTypecheck(cfg, { root: argRoot(a), signal, onProgress: progress }))))
      case 'codigo.deps':
        return done(toolOk(a.tipo, await beating(checkDependencies(cfg, { root: argRoot(a), signal, onProgress: progress }))))
      case 'codigo.todo':
        return done(toolOk(a.tipo, scanTodos(cfg, {
          root: argRoot(a),
          filter: a.filtro || a.filter ? String(a.filtro || a.filter) : undefined,
          maxResults: argLimit(a)
        })))
      case 'codigo.projeto':
        return done(toolOk(a.tipo, await beating(runCoderTask(cfg, {
          objetivo: String(a.objetivo || a.tarefa || a.descricao || a.texto || ''),
          root: String(a.path || a.raiz || a.destino || a.onde || a.nome || ''),
          passos: Number(a.passos || a.steps || 0) || undefined,
          signal
        }))))

      // ---- Colmeia (subagentes) ------------------------------------------------------
      case 'subagente.pesquisar':
      case 'subagente.construir':
      case 'subagente.auditar': {
        const profile: SubagentProfile =
          a.tipo === 'subagente.pesquisar' ? RESEARCHER : a.tipo === 'subagente.construir' ? ENGINEER : AUDITOR
        const goal = String(a.objetivo || a.tarefa || a.consulta || a.texto || '').trim()
        if (!goal) return done(toolErr(a.tipo, 'Diga o objetivo da tarefa para o subagente.'))
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
            const task: SubagentTask = {
              goal,
              context: buildTaskContext(sessionId, a.contexto ? String(a.contexto) : undefined),
              evidence: await gatherSubagentEvidence(profile, a, cfg, goal, signal, progress),
              memories: relevantMemories(goal, loadMemory())
            }
            const result = await executeSubagentTask(profile, task, cfg, onHive, signal)
            trace?.emit('hive:report', { agent: profile.id, ok: result.ok, durationMs: result.durationMs })
            return result
          })()
        )
        return done(toolOk(a.tipo, {
          agente: r.label,
          ok: r.ok,
          duracaoMs: r.durationMs,
          summary: `${r.label}: relatório ${r.ok ? 'entregue' : 'com falha'} em ${Math.round(r.durationMs / 1000)}s`,
          relatorio: r.report
        }))
      }

      // ---- briefing diário -----------------------------------------------------------
      case 'briefing.consultar': {
        const b = await buildBriefing(cfg)
        return toolOk(a.tipo, {
          data: b.dateLabel,
          clima: b.weather
            ? { local: b.weather.city, temp: b.weather.current.temp, desc: b.weather.current.desc, alerta: b.weather.alert }
            : b.weatherError || 'indisponível',
          eventosHoje: b.todayEvents.map((e) => ({ titulo: e.title, quando: e.whenISO })),
          tarefasVencidas: b.overdueTasks.map((t) => t.title),
          proximasTarefas: b.upcomingTasks.map((t) => t.title),
          lembretes: b.reminders.map((r) => r.title),
          noticias: b.news.map((n) => n.title),
          sugestoes: b.suggestions
        })
      }
    }
  } catch (e) {
    return done(toolErr(a.tipo, e instanceof Error ? e.message : String(e)))
  }
  return toolErr(a.tipo, 'ferramenta desconhecida')
}
