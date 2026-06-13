// Orquestrador do agente: `runTurn` aceita a fala do usuário, monta o system
// prompt, chama o LLM em streaming, encadeia rodadas de ferramentas, sintetiza
// a resposta final e persiste o que mudou.
//
// Os pedaços pesados foram extraídos para módulos focados:
//   - agent/prompt.ts    → system prompt, persona, datas, ações ia.*
//   - agent/activity.ts  → atividade/heartbeat/progresso
//   - agent/hive.ts      → Colmeia (gather + protocolo + followup)
//   - agent/router.ts    → tool dispatch tipado (runQuery)
//   - agent/stream.ts    → streamTurn + classifyProviderError
//   - agent/trace.ts     → telemetria leve por turno
//
// O que mora aqui é exatamente o que envolve o FLUXO de um turno completo,
// incluindo proteção contra ações destrutivas e persistência de mensagens.
// Tudo que o restante do código (e os testes) consomem do "agent" continua
// exportado por este módulo via fachada — sem mudanças de API.

import type {
  Acao,
  AgentTurnResult,
  AppConfig,
  Board,
  CalendarEvent,
  ChatMessage,
  MemoryCategory,
  MemoryFact
} from '../shared/types'
import { MEMORY_CATEGORIES } from '../shared/types'
import { readConfig } from './config'
import { parseEnvelope, QUERY_TOOLS } from '../shared/protocol'
import { chatJSON } from './ninerouter'
import { applyBoardAction } from './board'
import { loadBoard, saveBoard, boardSummary } from './tasks'
import {
  loadMemory,
  addFact,
  removeFact,
  memorySummary,
  loadEvents,
  addEvent,
  removeEvent,
  getSession,
  appendMessages,
  setSessionSummary,
  listCreate,
  listAddItem,
  listToggleItem,
  listRemoveItem,
  listClear,
  loadLists,
  addNote,
  loadNotes,
  addReminder,
  removeReminderByText,
  loadReminders,
  userDataDir,
  codingPreferencesSummary,
  getAntiFactsForExtractor
} from './data'
import { worklogSummary } from './worklog'
import { controlPromptContext } from './control'
import { codePromptContext } from './code'
import { pushUndo } from './history'
import { clearPendingConfirm, decideConfirmation, getPendingConfirm, setPendingConfirm, isAffirmative } from './confirm'
import { buildBriefing, briefingToSpeech } from './briefing'
import { registerRun } from './running'
import { getPendingSentinelDebug, clearPendingSentinelDebug } from './sentinel'
import {
  codeVoiceProgressSummary,
  groundCodeSpeech,
  hasCodeAction,
  hasCodeIntent,
  hasCodePromise,
  isDuplicateSpeech,
  sanitizeVoiceCodeFala,
  toolResultsPrompt,
  voiceAwareUserContent,
  voiceToolAnnouncement
} from './voiceCode'

import {
  brainSummary,
  buildSystemPrompt,
  finalFala as _finalFala,
  stripRepeatedGreeting
} from './agent/prompt'
import {
  buildTaskContext,
  compactSubagentContext,
  hiveFollowupInstruction,
  inferPromisedHiveAction,
  proactiveCodeFollowup
} from './agent/hive'
import { runQuery } from './agent/router'
import { isToolErr, type ToolResult } from './agent/types'
import { dedupeActions, streamTurn, validateActions, classifyProviderError } from './agent/stream'
import { createTrace, nullTrace } from './agent/trace'
import { uid } from './agent/activity'
import type {
  ActivityFn,
  DeltaFn,
  DeltaTextTransform,
  HiveStatusFn,
  TaskProgressFn
} from './agent/types'

export type { DeltaFn, DeltaKind, ActivityFn, TaskProgressFn, HiveStatusFn } from './agent/types'

// Re-exports preservando a superfície pública conhecida por testes/UI.
export {
  stripRepeatedGreeting,
  buildTaskContext,
  compactSubagentContext,
  hiveFollowupInstruction,
  inferPromisedHiveAction,
  classifyProviderError,
  createTrace,
  buildBriefing,
  briefingToSpeech
}

const asCategory = (c: unknown): MemoryCategory | undefined =>
  MEMORY_CATEGORIES.includes(c as MemoryCategory) ? (c as MemoryCategory) : undefined
const norm = (s: unknown) => String(s ?? '').toLowerCase().trim()

function applyMutations(acoes: Acao[]): { board: Board; notes: string[]; changedBoard: boolean; memoryQuestions: string[] } {
  let board = loadBoard()
  const original = board
  const notes: string[] = []
  const memoryQuestions: string[] = []
  for (const a of acoes) {
    if (a.tipo.startsWith('tarefa.') || a.tipo.startsWith('coluna.')) {
      const r = applyBoardAction(board, a)
      board = r.board
      if (r.note) notes.push(r.note)
    } else if (a.tipo === 'memoria.salvar' && a.fato) {
      addFact(String(a.fato), {
        category: asCategory(a.categoria),
        source: 'manual',
        status: 'active',
        evidence: a.evidencia ? [String(a.evidencia)] : undefined
      })
      notes.push('memória atualizada')
    } else if (a.tipo === 'memoria.remover' && a.fato) {
      const f = loadMemory().find((x) => norm(x.text).includes(norm(a.fato)))
      if (f) removeFact(f.id, true)
    } else if (a.tipo === 'evento.criar' && a.titulo && a.quando) {
      addEvent({
        title: String(a.titulo),
        whenISO: String(a.quando),
        description: a.descricao ? String(a.descricao) : undefined,
        remindMinutes: typeof a.lembreteMin === 'number' ? a.lembreteMin : Number(a.lembreteMin) || undefined,
        recurrence: a.repetir as CalendarEvent['recurrence']
      })
      notes.push('evento criado')
    } else if (a.tipo === 'evento.remover' && a.titulo) {
      const e = loadEvents().find((x) => norm(x.title).includes(norm(a.titulo)))
      if (e) removeEvent(e.id)
    } else if (a.tipo === 'lista.criar' && a.titulo) {
      listCreate(String(a.titulo))
      notes.push(`lista "${a.titulo}" criada`)
    } else if (a.tipo === 'lista.adicionar' && a.item) {
      listAddItem(String(a.lista || 'Compras'), String(a.item))
      notes.push(`+ "${a.item}" na lista`)
    } else if (a.tipo === 'lista.marcar' && a.item) {
      listToggleItem(String(a.lista || ''), String(a.item), typeof a.feito === 'boolean' ? a.feito : undefined)
      notes.push(`✓ "${a.item}"`)
    } else if (a.tipo === 'lista.removerItem' && a.item) {
      listRemoveItem(String(a.lista || ''), String(a.item))
      notes.push(`🗑 "${a.item}"`)
    } else if (a.tipo === 'lista.limpar' && a.lista) {
      listClear(String(a.lista))
      notes.push(`lista "${a.lista}" limpa`)
    } else if (a.tipo === 'nota.salvar' && a.texto) {
      addNote(String(a.texto))
      notes.push('nota salva')
    } else if (a.tipo === 'lembrete.criar' && a.texto) {
      const mins = Number(a.emMinutos)
      const whenISO =
        Number.isFinite(mins) && mins > 0
          ? new Date(Date.now() + mins * 60_000).toISOString()
          : String(a.quando || new Date(Date.now() + 60_000).toISOString())
      const modo = String(a.modo || '')
      addReminder({
        text: String(a.texto),
        whenISO,
        recurrence: a.repetir as CalendarEvent['recurrence'],
        kind: (['timer', 'alarm', 'reminder'].includes(modo) ? modo : 'reminder') as 'reminder' | 'timer' | 'alarm'
      })
      notes.push('lembrete criado')
    } else if (a.tipo === 'lembrete.remover' && a.texto) {
      removeReminderByText(String(a.texto))
      notes.push('lembrete removido')
    }
  }
  const changedBoard = board !== original
  if (changedBoard) saveBoard(board)
  return { board, notes, changedBoard, memoryQuestions }
}

function memoryFallback(userText: string, acoes: Acao[]): Acao[] {
  if (acoes.some((a) => a.tipo === 'memoria.salvar')) return acoes
  const match =
    userText.match(/(?:lembre-se que|lembra que|memorize que|guarde que|anote que)\s+(.+)/i) ||
    userText.match(/(?:minha preferência é|eu prefiro|prefiro)\s+(.+)/i)
  const fact = match?.[1]?.replace(/[.!?]+$/, '').trim()
  return fact ? [...acoes, { tipo: 'memoria.salvar', fato: fact }] : acoes
}



// Máximo de rodadas de ferramentas encadeadas por turno (buscar -> ler -> validar...).
const MAX_TOOL_ROUNDS = 3
const MAX_CODE_TOOL_ROUNDS = 6

interface CodeTurnLedger {
  actionsRun: number
  wroteFiles: Set<string>
  ranCommands: string[]
  validations: string[]
  pendingApprovals: string[]
  blockers: string[]
}

const CODE_WRITE_TOOLS = new Set([
  'codigo.criar',
  'codigo.editar',
  'codigo.scaffold',
  'codigo.substituir',
  'codigo.patch.aplicar',
  'codigo.formatar',
  'codigo.projeto'
])

const CODE_VALIDATION_TOOLS = new Set([
  'codigo.comando',
  'codigo.terminal',
  'codigo.diagnostico',
  'codigo.testar',
  'codigo.lint',
  'codigo.typecheck'
])

function createCodeTurnLedger(): CodeTurnLedger {
  return {
    actionsRun: 0,
    wroteFiles: new Set(),
    ranCommands: [],
    validations: [],
    pendingApprovals: [],
    blockers: []
  }
}

function resultObj(result: ToolResult): Record<string, unknown> {
  return result.resultado && typeof result.resultado === 'object' && !Array.isArray(result.resultado)
    ? (result.resultado as Record<string, unknown>)
    : {}
}

function resultString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resultArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordCodeResult(ledger: CodeTurnLedger, result: ToolResult): void {
  const tipo = String(result.tipo || '')
  if (!tipo.startsWith('codigo.') && !tipo.startsWith('subagente.')) return
  ledger.actionsRun++

  if (isToolErr(result)) {
    ledger.blockers.push(`${tipo}: ${result.erro}`)
    return
  }

  const o = resultObj(result)
  const command = resultString(o.command) || resultString(o.comando)
  if (command) ledger.ranCommands.push(command)
  if (o.requiresApproval === true) {
    ledger.pendingApprovals.push(command || `${tipo} precisa de autorização`)
  }
  if (resultString(o.blockedReason)) ledger.blockers.push(resultString(o.blockedReason))
  if (resultString(o.erro) || resultString(o.error)) ledger.blockers.push(resultString(o.erro) || resultString(o.error))
  if (o.ok === false && (CODE_VALIDATION_TOOLS.has(tipo) || tipo === 'codigo.projeto')) {
    const why = resultString(o.summary) || resultString(o.stderr) || resultString(o.stdout) || `${tipo} retornou falha`
    ledger.blockers.push(why)
  }

  const file = resultString(o.file)
  if (file && (CODE_WRITE_TOOLS.has(tipo) || o.changed === true || o.applied === true)) ledger.wroteFiles.add(file)
  for (const f of resultArray(o.changedFiles).map(resultString).filter(Boolean)) ledger.wroteFiles.add(f)
  for (const f of resultArray(o.created).map(resultString).filter(Boolean)) ledger.wroteFiles.add(f)
  for (const f of resultArray(o.files).map((v) => {
    if (typeof v === 'string') return v
    if (v && typeof v === 'object') return resultString((v as Record<string, unknown>).file)
    return ''
  }).filter(Boolean)) {
    if (CODE_WRITE_TOOLS.has(tipo) && (o.applied === true || o.changed === true || tipo === 'codigo.scaffold')) ledger.wroteFiles.add(f)
  }

  const summary = resultString(o.summary)
  const validationSummary = resultString(o.validationSummary)
  if (CODE_VALIDATION_TOOLS.has(tipo) && (summary || command)) {
    ledger.validations.push(summary || command)
  }
  if (validationSummary) ledger.validations.push(validationSummary)
}

function recordCodeResults(ledger: CodeTurnLedger, results: ToolResult[]): void {
  for (const result of results) recordCodeResult(ledger, result)
}

function ledgerEvidence(ledger: CodeTurnLedger) {
  return {
    actionsRun: ledger.actionsRun,
    wroteFiles: Array.from(ledger.wroteFiles),
    ranCommands: ledger.ranCommands,
    validations: ledger.validations,
    pendingApprovals: ledger.pendingApprovals,
    blockers: ledger.blockers
  }
}

function needsPromisedCodeCorrection(userText: string, fala: string, actions: Acao[], codeSeen: boolean): boolean {
  if (hasCodeAction(actions)) return false
  if (!hasCodePromise(fala)) return false
  return codeSeen || hasCodeIntent(userText)
}

async function correctPromisedCodeActions(
  cfg: AppConfig,
  messages: ChatMessage[],
  currentEnvelope: { fala: string; acoes: Acao[] },
  signal?: AbortSignal
): Promise<{ fala: string; acoes: Acao[] } | null> {
  const raw = await chatJSON(
    cfg,
    [
      ...messages,
      { role: 'assistant', content: JSON.stringify(currentEnvelope) },
      {
        role: 'system',
        content:
          'Você prometeu executar uma tarefa de programação, mas não emitiu nenhuma ação codigo.* ou subagente.*. ' +
          'Responda AGORA apenas no envelope JSON. Se for possível continuar, inclua ações reais em "acoes" para executar. ' +
          'Se não for possível, deixe "acoes" vazio e explique o bloqueio real em uma frase curta. ' +
          'Não afirme que alterou, criou, rodou ou validou algo sem ação correspondente.'
      }
    ],
    true,
    { signal }
  )
  const corrected = parseEnvelope(raw)
  return corrected.fala || corrected.acoes.length ? corrected : null
}

/** Executa um turno completo de conversa + ações, com fala transmitida em streaming. */
export async function runTurn(
  sessionId: string,
  userText: string,
  voice = false,
  onDelta?: DeltaFn,
  onActivity?: ActivityFn,
  onHive?: HiveStatusFn,
  onProgress?: TaskProgressFn
): Promise<AgentTurnResult> {
  const cfg = readConfig()

  // Intercepta confirmação para acionar depuração pelo Prometeu
  const pendDebug = getPendingSentinelDebug(sessionId)
  if (pendDebug) {
    const isAff = isAffirmative(userText) || /^(depura(r)?|corrija|corrigir|conserta(r)?|resolve(r)?)/i.test(userText.trim().toLowerCase())
    if (isAff) {
      clearPendingSentinelDebug(sessionId)
      let debugTranscript = ''
      const emitDebugDelta: DeltaFn | undefined = onDelta
        ? (chunk, phase, kind = 'both', done) => {
            if (kind === 'both' && chunk) debugTranscript += chunk
            onDelta(chunk, phase, kind, done)
          }
        : undefined
      const intro = `Certo, acionando o depurador Prometeu para analisar o erro no comando "${pendDebug.command}".`
      if (emitDebugDelta) emitDebugDelta(intro, 1, 'both', true)
      else debugTranscript = intro

      const action: Acao = {
        tipo: 'subagente.depurar',
        objetivo: `Corrigir erro no processo: ${pendDebug.command}`,
        logs_erro: pendDebug.logSnippet,
        contexto: `Comando executado: ${pendDebug.command}\nLogs capturados:\n${pendDebug.logSnippet}`
      }

      const controller = new AbortController()
      const unregisterRun = registerRun(sessionId, controller)
      const signal = controller.signal
      try {
        const result = await runQuery(action, {
          cfg,
          sessionId,
          phase: 1,
          signal,
          onDelta: emitDebugDelta,
          onActivity,
          onHive,
          onProgress
        })

        let fala = ""
        if (isToolErr(result)) {
          fala = `Desculpe, a depuração com o Prometeu falhou: ${result.erro}`
        } else {
          fala = `Prometeu concluiu a análise do erro do comando "${pendDebug.command}" e propôs a correção. Veja o relatório na tela.`
        }

        const finalChunk = `${debugTranscript.trim() ? ' ' : ''}${fala}`
        if (emitDebugDelta) emitDebugDelta(finalChunk, 1, 'both', true)
        else debugTranscript += finalChunk
        fala = debugTranscript.replace(/\s+/g, ' ').trim()

        appendMessages(sessionId, [
          { id: uid('m'), role: 'user', content: userText, ts: Date.now() },
          { id: uid('m'), role: 'assistant', content: fala, ts: Date.now() }
        ])

        return {
          fala,
          board: loadBoard(),
          memory: loadMemory(),
          events: loadEvents(),
          lists: loadLists(),
          quickNotes: loadNotes(),
          reminders: loadReminders(),
          notes: [!isToolErr(result) && (result.resultado as any)?.summary ? (result.resultado as any).summary : 'depuração finalizada'],
          changedBoard: false,
          config: cfg
        }
      } finally {
        unregisterRun()
      }
    } else {
      clearPendingSentinelDebug(sessionId)
    }
  }

  // Telemetria leve por turno (no-op a menos que algum caller leia o trace).
  const trace = process.env?.ARES_TRACE ? createTrace(sessionId) : nullTrace()
  // Controlador de cancelamento do turno: permite ao usuário (Esc/IPC code:cancel) abortar
  // um comando/coder em execução sem travar o app. Registrado por sessão.
  const controller = new AbortController()
  const unregisterRun = registerRun(sessionId, controller)
  const signal = controller.signal
  // Tudo que pode lançar (provedor, parse, abort) roda dentro do try: a baixa do
  // registro de cancelamento é garantida no finally — antes, uma exceção no meio
  // do turno deixava o AbortController preso no registro da sessão para sempre.
  try {
    const session = getSession(sessionId)
    // 16 mensagens recentes (era 12): melhora a continuidade de referências ("ele",
    // "aquele arquivo") sem pesar — o resumo automático cobre o histórico mais antigo.
    const recent = (session?.messages || []).slice(-16)
    const hasPriorAssistant = recent.some((m) => m.role === 'assistant')
    const suppressGreeting = hasPriorAssistant
    const deltaTransform: DeltaTextTransform | undefined = suppressGreeting
      ? (text) => stripRepeatedGreeting(text)
      : undefined
    const sys = buildSystemPrompt({
      board: loadBoard(),
      events: loadEvents(),
      location: cfg.integrations.location,
      codeContext: codePromptContext(cfg),
      controlContext: controlPromptContext(cfg),
      codingPrefs: codingPreferencesSummary(),
      worklogSummary: worklogSummary(cfg.integrations.code.workspaceRoot),
      brain: brainSummary(cfg),
      summary: session?.summary,
      voice,
      hasPriorAssistant
    })
    const messages: ChatMessage[] = [
      { role: 'system', content: sys },
      ...recent.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
      { role: 'user', content: voiceAwareUserContent(userText, voice) }
    ]

    let visibleTranscript = ''
    let voiceCodeSeen = false
    const voiceCodeFallbackParts: string[] = []
    const appendVoiceCodePart = (text: string): void => {
      const clean = String(text || '').replace(/\s+/g, ' ').trim()
      if (!clean) return
      const last = voiceCodeFallbackParts[voiceCodeFallbackParts.length - 1]
      if (!last || !isDuplicateSpeech(last, clean)) voiceCodeFallbackParts.push(clean)
    }
    const emitDelta: DeltaFn | undefined = onDelta
      ? (chunk, ph, kind = 'both', done) => {
          if (kind === 'both' && chunk) visibleTranscript += chunk
          onDelta(chunk, ph, kind, done)
        }
      : undefined
    const emitVisibleCodeNarration = (text: string, ph: number): void => {
      const clean = String(text || '').replace(/\s+/g, ' ').trim()
      if (!clean) return
      appendVoiceCodePart(clean)
      const chunk = `${visibleTranscript.trim() ? ' ' : ''}${clean}`
      if (emitDelta) emitDelta(chunk, ph, 'both', true)
      else visibleTranscript += chunk
    }
    const currentVisibleTranscript = (): string =>
      (visibleTranscript.replace(/\s+/g, ' ').trim() || voiceCodeFallbackParts.join(' ').replace(/\s+/g, ' ').trim())

    trace.emit('phase', { n: 1, kind: 'initial' })
    const env = parseEnvelope(await streamTurn(cfg, messages, 1, emitDelta, 'both', deltaTransform, signal))
    let fala = _finalFala(env.fala, suppressGreeting)
    let falaVoz: string | undefined
    const allNotes: string[] = []
    const codeLedger = createCodeTurnLedger()
    const inferredHive = inferPromisedHiveAction(fala, userText, env.acoes)
    if (inferredHive) {
      env.acoes = [...env.acoes, inferredHive]
      allNotes.push('colmeia corrigida: promessa convertida em ação real')
      trace.emit('hive:inferred', { tipo: inferredHive.tipo })
    }
    let codeTurnSeen = hasCodeIntent(userText) || hasCodeAction(env.acoes)
    if (needsPromisedCodeCorrection(userText, fala, env.acoes, codeTurnSeen)) {
      const corrected = await correctPromisedCodeActions(cfg, messages, { fala, acoes: env.acoes }, signal)
      if (corrected) {
        fala = _finalFala(corrected.fala || fala, suppressGreeting)
        env.acoes = corrected.acoes
        codeTurnSeen = codeTurnSeen || hasCodeAction(env.acoes)
        allNotes.push('programação corrigida: promessa convertida em ação real ou bloqueio explícito')
        trace.emit('code:corrected', { actions: env.acoes.length })
      }
    }
    let mutations = env.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo))
    let queries = dedupeActions(env.acoes.filter((a) => QUERY_TOOLS.has(a.tipo)))
    if (voice && hasCodeAction(queries)) {
      voiceCodeSeen = true
      appendVoiceCodePart(fala)
      if (!emitDelta && fala) visibleTranscript = fala
    }

    // Loop agêntico: o LLM pode ENCADEAR rodadas de ferramentas (buscar -> ler ->
    // editar -> validar) num único turno. Cada rodada roda as consultas em PARALELO
    // (Promise.all preserva a ordem), devolve os resultados e abre uma nova fase de
    // streaming (fase nova = reset no cliente). Limitado a MAX_TOOL_ROUNDS para
    // nunca entrar em ciclo; na última rodada o LLM é instruído a concluir.
    let convo: ChatMessage[] = messages
    let phase = 1
    for (let round = 0; queries.length; round++) {
      if (hasCodeAction(queries)) codeTurnSeen = true
      const maxRounds = codeTurnSeen ? MAX_CODE_TOOL_ROUNDS : MAX_TOOL_ROUNDS
      if (round >= maxRounds) {
        const pending = queries.map((q) => q.tipo).join(', ')
        const blocker = `limite de ${maxRounds} rodadas atingido com ações pendentes: ${pending}`
        codeLedger.blockers.push(blocker)
        allNotes.push(blocker)
        trace.emit('tool:limit', { maxRounds, pending: queries.length })
        break
      }
      // Voz assíncrona NÃO-BLOQUEANTE: anuncia em uma frase curta o que vai rodar
      // agora, em paralelo com a execução (a fala toca enquanto as ferramentas
      // trabalham). Na primeira rodada o próprio modelo já anunciou via streaming;
      // nas rodadas seguintes (e quando a fala veio vazia) este é o único som
      // antes do heartbeat dos 15 s.
      if (voice && hasCodeAction(queries)) voiceCodeSeen = true
      if (voice && hasCodeAction(queries) && (round > 0 || !fala.trim())) {
        const announce = voiceToolAnnouncement(queries)
        if (announce) emitVisibleCodeNarration(announce, phase)
      }
      const results = await Promise.all(
        queries.map((q) => runQuery(q, { cfg, sessionId, phase, signal, onDelta: emitDelta, onActivity, onHive, onProgress, trace }))
      )
      recordCodeResults(codeLedger, results)
      const codeMode = hasCodeAction(queries)
      if (codeMode) codeTurnSeen = true
      const proactive = proactiveCodeFollowup(cfg, results)
      if (proactive) allNotes.push(proactive.note)
      const lastRound = round === maxRounds - 1
      convo = [
        ...convo,
        { role: 'assistant', content: fala || '...' },
        {
          role: 'system',
          content:
            toolResultsPrompt(results, voice, codeMode) +
            hiveFollowupInstruction(results, voice) +
            (proactive ? `\n${proactive.instruction}` : '') +
            (lastRound
              ? '\nLimite de rodadas de ferramentas atingido: responda AGORA ao usuário com o que tem, sem chamar novas ferramentas de consulta.'
              : '')
        }
      ]
      phase++
      trace.emit('phase', { n: phase, kind: voice && codeMode ? 'voice+code' : 'normal', round })
      if (voice && codeMode) {
        const immediateSpoken = codeVoiceProgressSummary(results)
        if (immediateSpoken) {
          falaVoz = immediateSpoken
          emitVisibleCodeNarration(immediateSpoken, phase)
        }
        const finalPrefix = visibleTranscript.trim() ? ' ' : ''
        const voiceCodeTransform: DeltaTextTransform = (text, ph, kind) => {
          const base = deltaTransform ? deltaTransform(text, ph, kind) : text
          const spoken = sanitizeVoiceCodeFala(base)
          if (!spoken || isDuplicateSpeech(spoken, immediateSpoken)) return ''
          return `${finalPrefix}${spoken}`
        }
        const beforeFinal = visibleTranscript.length
        const raw = await streamTurn(cfg, convo, phase, emitDelta, 'both', voiceCodeTransform, signal)
        let envN = parseEnvelope(raw)
        if (envN.fala) {
          const modelFala = _finalFala(envN.fala, suppressGreeting)
          const spoken = sanitizeVoiceCodeFala(modelFala) || 'Analise concluida. Os detalhes principais estao nas atividades.'
          falaVoz = spoken
          if (!isDuplicateSpeech(spoken, immediateSpoken)) {
            appendVoiceCodePart(spoken)
            if (visibleTranscript.length === beforeFinal) emitVisibleCodeNarration(spoken, phase)
          }
          fala = currentVisibleTranscript() || spoken
        } else if (!immediateSpoken) {
          const fallback = 'Concluido. Os detalhes estao nas atividades.'
          falaVoz = fallback
          emitVisibleCodeNarration(fallback, phase)
          fala = currentVisibleTranscript() || fallback
        } else {
          fala = currentVisibleTranscript() || immediateSpoken
        }

        if (!lastRound && needsPromisedCodeCorrection(userText, envN.fala || fala, envN.acoes, codeTurnSeen)) {
          const corrected = await correctPromisedCodeActions(cfg, convo, { fala: envN.fala || fala, acoes: envN.acoes }, signal)
          if (corrected) {
            envN = corrected
            allNotes.push('programação corrigida: promessa convertida em ação real ou bloqueio explícito')
            trace.emit('code:corrected', { actions: envN.acoes.length })
          }
        }
        
        const inferredHiveN = inferPromisedHiveAction(fala, userText, envN.acoes)
        if (inferredHiveN) {
          envN.acoes = [...envN.acoes, inferredHiveN]
          allNotes.push('colmeia corrigida: promessa convertida em ação real')
          trace.emit('hive:inferred', { tipo: inferredHiveN.tipo })
        }

        mutations = mutations.concat(envN.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo)))
        const nextQueries = dedupeActions(envN.acoes.filter((a) => QUERY_TOOLS.has(a.tipo)))
        if (lastRound && nextQueries.length) {
          const blocker = `limite de ${maxRounds} rodadas atingido antes de executar: ${nextQueries.map((q) => q.tipo).join(', ')}`
          codeLedger.blockers.push(blocker)
          allNotes.push(blocker)
          trace.emit('tool:limit', { maxRounds, pending: nextQueries.length })
        }
        queries = lastRound ? [] : nextQueries
      } else {
        const raw = await streamTurn(cfg, convo, phase, emitDelta, 'both', deltaTransform, signal)
        let envN = parseEnvelope(raw)
        if (envN.fala) fala = _finalFala(envN.fala, suppressGreeting)

        if (!lastRound && needsPromisedCodeCorrection(userText, fala, envN.acoes, codeTurnSeen)) {
          const corrected = await correctPromisedCodeActions(cfg, convo, { fala, acoes: envN.acoes }, signal)
          if (corrected) {
            fala = _finalFala(corrected.fala || fala, suppressGreeting)
            envN = corrected
            allNotes.push('programação corrigida: promessa convertida em ação real ou bloqueio explícito')
            trace.emit('code:corrected', { actions: envN.acoes.length })
          }
        }
        
        const inferredHiveN = inferPromisedHiveAction(fala, userText, envN.acoes)
        if (inferredHiveN) {
          envN.acoes = [...envN.acoes, inferredHiveN]
          allNotes.push('colmeia corrigida: promessa convertida em ação real')
          trace.emit('hive:inferred', { tipo: inferredHiveN.tipo })
        }

        mutations = mutations.concat(envN.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo)))
        const nextQueries = dedupeActions(envN.acoes.filter((a) => QUERY_TOOLS.has(a.tipo)))
        if (lastRound && nextQueries.length) {
          const blocker = `limite de ${maxRounds} rodadas atingido antes de executar: ${nextQueries.map((q) => q.tipo).join(', ')}`
          codeLedger.blockers.push(blocker)
          allNotes.push(blocker)
          trace.emit('tool:limit', { maxRounds, pending: nextQueries.length })
        }
        queries = lastRound ? [] : nextQueries
      }
    }

    mutations = memoryFallback(userText, mutations)
    const validated = validateActions(mutations)
    allNotes.push(...validated.notes)

    // Portão de confiança: ações destrutivas (apagar/limpar/remover) só executam após
    // confirmação. O LLM pergunta na fala; aqui garantimos que nada destrutivo roda
    // sem o "sim" — mesmo se o LLM falhar.
    let toApply = validated.valid
    let heldQuestion: string | undefined
    let outcome: 'none' | 'held' | 'applied' | 'confirmed' | 'cancelled' = 'none'
    if (cfg.ui.confirmDestructive !== false) {
      const pend = getPendingConfirm(sessionId)
      const decision = decideConfirmation({ pending: pend?.actions ?? null, proposed: validated.valid, userText })
      toApply = decision.apply
      outcome = decision.outcome
      heldQuestion = decision.question
      if (decision.hold && decision.hold.length) setPendingConfirm(sessionId, decision.hold, decision.question || 'Confirma?')
      else clearPendingConfirm(sessionId)
    }

    // Snapshot para "desfazer": antes de alterar qualquer dado, guarda o estado atual.
    if (toApply.length) pushUndo(userDataDir(), userText.slice(0, 80))

    const memoryIdsBefore = new Set(loadMemory().map((f) => f.id))
    const { board, notes, changedBoard, memoryQuestions } = applyMutations(toApply)
    const createdMemoryQuestions = loadMemory()
      .filter((f) => !memoryIdsBefore.has(f.id) && f.review === 'possible_conflict' && f.conflictQuestion)
      .map((f) => String(f.conflictQuestion))
    memoryQuestions.push(...createdMemoryQuestions)
    allNotes.push(...notes)
    if (toApply.length) trace.emit('mutation', { count: toApply.length, outcome })

    // Ajusta a fala exibida conforme a confirmação (a fala falada é a do streaming).
    if (outcome === 'held') {
      if (!/\?/.test(fala)) fala = heldQuestion || fala
      allNotes.push('aguardando confirmação')
    } else if (outcome === 'cancelled') {
      allNotes.push('cancelado')
    }
    if (memoryQuestions.length && !/\?/.test(fala)) {
      fala = `${fala}\n\n${memoryQuestions[0]}`
    }
    if (voiceCodeSeen) {
      const transcript = currentVisibleTranscript()
      if (transcript) {
        fala = transcript
        falaVoz = transcript
      }
    }
    if (codeTurnSeen || codeLedger.actionsRun > 0) {
      const grounded = groundCodeSpeech(fala, ledgerEvidence(codeLedger))
      if (grounded.adjusted) {
        fala = grounded.text
        falaVoz = grounded.text
        allNotes.push('fala final ajustada com base em evidências reais do turno')
      }
    }

    appendMessages(sessionId, [
      { id: uid('m'), role: 'user', content: userText, ts: Date.now() },
      { id: uid('m'), role: 'assistant', content: fala, ts: Date.now() }
    ])
    // O resumo de contexto é uma otimização para turnos FUTUROS — não deve atrasar
    // a resposta atual nem a liberação para o próximo comando. Roda em segundo plano.
    void summarizeIfNeeded(sessionId)

    trace.end({ voice, phases: phase, rounds: phase - 1, mutations: toApply.length })
    // Se alguma ação (ia.raciocinio/ia.modelo) alterou a config do cérebro durante o
    // turno, devolve a config nova para o renderer refletir nos seletores na hora.
    const cfgAfter = readConfig()
    const brainChanged = JSON.stringify(cfgAfter.nineRouter) !== JSON.stringify(cfg.nineRouter)
    return {
      fala,
      board,
      memory: loadMemory(),
      events: loadEvents(),
      lists: loadLists(),
      quickNotes: loadNotes(),
      reminders: loadReminders(),
      notes: allNotes,
      changedBoard,
      ...(falaVoz ? { falaVoz } : {}),
      ...(brainChanged ? { config: cfgAfter } : {})
    }
  } finally {
    unregisterRun()
  }
}

// Controle de contexto: quando a sessão fica longa, resume o histórico antigo.
async function summarizeIfNeeded(sessionId: string): Promise<void> {
  const s = getSession(sessionId)
  if (!s || s.messages.length <= 24) return
  try {
    const cfg = readConfig()
    const old = s.messages.slice(0, -10)
    const text = old.map((m) => `${m.role === 'user' ? 'Usuário' : 'ARES'}: ${m.content}`).join('\n')
    const resumo = await chatJSON(
      cfg,
      [
        { role: 'system', content: 'Resuma em 4-6 frases os pontos importantes e preferências do usuário desta conversa, em pt-BR. Responda só o resumo.' },
        { role: 'user', content: (s.summary ? `Resumo anterior: ${s.summary}\n\n` : '') + text }
      ],
      false
    )
    if (resumo.trim()) setSessionSummary(sessionId, resumo.trim(), 10)
  } catch {
    /* resumo é melhoria opcional; ignora falhas */
  }
}

/**
 * Auto-extração de fatos úteis da conversa recente. Roda separada do turno (chamada
 * pelo renderer após responder) para não atrasar a fala. A extração é 100% autônoma
 * e os fatos são auto-classificados (ativo/probatório/descartado) via score de confiança.
 */
export async function extractFacts(sessionId: string): Promise<MemoryFact[]> {
  const cfg = readConfig()
  if (!cfg.memory.autoExtract) return loadMemory()
  const s = getSession(sessionId)
  if (!s || s.messages.length < 2) return loadMemory()
  const recent = s.messages.slice(-10).map((m) => `${m.role === 'user' ? 'Usuário' : 'ARES'}: ${m.content}`).join('\n')
  const known = memorySummary(800)
  const antiFacts = getAntiFactsForExtractor()
  const antiFactsPrompt = antiFacts ? `\n\nAnti-fatos (NÃO reaprender):\n${antiFacts}` : ''
  const sys =
    'Você extrai memória curada estilo Hermes: fatos DURADOUROS e úteis sobre o usuário, preferências, correções, perfil, rotina, trabalho, projetos, restrições e interesses. ' +
    'Ignore pedidos pontuais, progresso temporário, logs, saídas brutas, chaves, tokens, prompts, small talk e qualquer coisa efêmera. Não repita fatos já conhecidos. ' +
    'Responda APENAS JSON: {"fatos":[{"texto":"...","categoria":"perfil|preferencias|rotina|trabalho|projetos|restricoes|interesses|outros","confianca":0.0-1.0,"evidencia":"trecho curto"}]}. ' +
    'Se nada relevante, responda {"fatos":[]}. Máximo 3 fatos; cada texto deve ser curto, denso e útil em sessões futuras.' +
    antiFactsPrompt
  let raw = ''
  try {
    raw = await chatJSON(
      cfg,
      [
        { role: 'system', content: sys },
        { role: 'user', content: `Já conhecido:\n${known}\n\nConversa:\n${recent}` }
      ],
      true
    )
  } catch {
    return loadMemory()
  }
  try {
    const obj = JSON.parse(raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
    const fatos: { texto?: string; categoria?: string; confianca?: number; evidencia?: string }[] = Array.isArray(obj?.fatos) ? obj.fatos : []
    for (const f of fatos.slice(0, 3)) {
      const texto = String(f?.texto || '').trim()
      if (texto.length > 3) {
        addFact(texto, {
          category: asCategory(f?.categoria),
          source: 'auto',
          confidence: typeof f.confianca === 'number' ? f.confianca : undefined,
          evidence: f.evidencia ? [String(f.evidencia)] : undefined
        })
      }
    }
  } catch {
    /* extração é best-effort */
  }
  return loadMemory()
}
