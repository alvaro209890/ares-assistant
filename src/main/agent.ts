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
  sessionContextSummary
} from './data'
import { controlPromptContext } from './control'
import { codePromptContext } from './code'
import { pushUndo } from './history'
import { clearPendingConfirm, decideConfirmation, getPendingConfirm, setPendingConfirm } from './confirm'
import { buildBriefing, briefingToSpeech } from './briefing'
import { registerRun } from './running'
import {
  codeVoiceProgressSummary,
  hasCodeAction,
  isDuplicateSpeech,
  sanitizeVoiceCodeFala,
  toolResultsPrompt,
  voiceAwareUserContent
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
import { streamTurn, validateActions, classifyProviderError } from './agent/stream'
import { createTrace, nullTrace } from './agent/trace'
import { uid } from './agent/activity'
import type { ActivityFn, DeltaFn, DeltaTextTransform, HiveWorkerStatus } from './agent/types'

export type { DeltaFn, DeltaKind, ActivityFn } from './agent/types'
export type HiveStatusFn = (status: HiveWorkerStatus) => void

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

function applyMutations(acoes: Acao[]): { board: Board; notes: string[]; changedBoard: boolean } {
  let board = loadBoard()
  const original = board
  const notes: string[] = []
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
      if (f) removeFact(f.id)
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
  return { board, notes, changedBoard }
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

/** Executa um turno completo de conversa + ações, com fala transmitida em streaming. */
export async function runTurn(
  sessionId: string,
  userText: string,
  voice = false,
  onDelta?: DeltaFn,
  onActivity?: ActivityFn,
  onHive?: HiveStatusFn
): Promise<AgentTurnResult> {
  const cfg = readConfig()
  // Telemetria leve por turno (no-op a menos que algum caller leia o trace).
  const trace = process.env?.ARES_TRACE ? createTrace(sessionId) : nullTrace()
  // Controlador de cancelamento do turno: permite ao usuário (Esc/IPC code:cancel) abortar
  // um comando/coder em execução sem travar o app. Registrado por sessão.
  const controller = new AbortController()
  const unregisterRun = registerRun(sessionId, controller)
  const signal = controller.signal
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
    sessionContext: sessionContextSummary(),
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

  trace.emit('phase', { n: 1, kind: 'initial' })
  const env = parseEnvelope(await streamTurn(cfg, messages, 1, onDelta, 'both', deltaTransform, signal))
  let fala = _finalFala(env.fala, suppressGreeting)
  let falaVoz: string | undefined
  const allNotes: string[] = []
  const inferredHive = inferPromisedHiveAction(fala, userText, env.acoes)
  if (inferredHive) {
    env.acoes = [...env.acoes, inferredHive]
    allNotes.push('colmeia corrigida: promessa convertida em ação real')
    trace.emit('hive:inferred', { tipo: inferredHive.tipo })
  }
  let mutations = env.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo))
  let queries = env.acoes.filter((a) => QUERY_TOOLS.has(a.tipo))

  // Loop agêntico: o LLM pode ENCADEAR rodadas de ferramentas (buscar -> ler ->
  // editar -> validar) num único turno. Cada rodada roda as consultas em PARALELO
  // (Promise.all preserva a ordem), devolve os resultados e abre uma nova fase de
  // streaming (fase nova = reset no cliente). Limitado a MAX_TOOL_ROUNDS para
  // nunca entrar em ciclo; na última rodada o LLM é instruído a concluir.
  let convo: ChatMessage[] = messages
  let phase = 1
  for (let round = 0; queries.length && round < MAX_TOOL_ROUNDS; round++) {
    const results = await Promise.all(
      queries.map((q) => runQuery(q, { cfg, sessionId, phase, signal, onDelta, onActivity, onHive, trace }))
    )
    const codeMode = hasCodeAction(queries)
    const proactive = proactiveCodeFollowup(cfg, results)
    if (proactive) allNotes.push(proactive.note)
    const lastRound = round === MAX_TOOL_ROUNDS - 1
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
        onDelta?.(` ${immediateSpoken}`, phase, 'speak')
      }
      const raw = await streamTurn(cfg, convo, phase, onDelta, 'display', deltaTransform, signal)
      const envN = parseEnvelope(raw)
      if (envN.fala) {
        fala = _finalFala(envN.fala, suppressGreeting)
        const spoken = sanitizeVoiceCodeFala(fala) || 'Análise concluída. Os detalhes principais estão na tela.'
        falaVoz = spoken
        if (!isDuplicateSpeech(spoken, immediateSpoken)) onDelta?.(` ${spoken}`, phase, 'speak')
      } else if (!immediateSpoken) {
        const fallback = 'Concluído. Os detalhes estão na tela.'
        falaVoz = fallback
        onDelta?.(` ${fallback}`, phase, 'speak')
      }
      mutations = mutations.concat(envN.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo)))
      queries = lastRound ? [] : envN.acoes.filter((a) => QUERY_TOOLS.has(a.tipo))
    } else {
      const raw = await streamTurn(cfg, convo, phase, onDelta, 'both', deltaTransform, signal)
      const envN = parseEnvelope(raw)
      if (envN.fala) fala = _finalFala(envN.fala, suppressGreeting)
      mutations = mutations.concat(envN.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo)))
      queries = lastRound ? [] : envN.acoes.filter((a) => QUERY_TOOLS.has(a.tipo))
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

  const { board, notes, changedBoard } = applyMutations(toApply)
  allNotes.push(...notes)
  if (toApply.length) trace.emit('mutation', { count: toApply.length, outcome })

  // Ajusta a fala exibida conforme a confirmação (a fala falada é a do streaming).
  if (outcome === 'held') {
    if (!/\?/.test(fala)) fala = heldQuestion || fala
    allNotes.push('aguardando confirmação')
  } else if (outcome === 'cancelled') {
    allNotes.push('cancelado')
  }

  appendMessages(sessionId, [
    { id: uid('m'), role: 'user', content: userText, ts: Date.now() },
    { id: uid('m'), role: 'assistant', content: fala, ts: Date.now() }
  ])
  // O resumo de contexto é uma otimização para turnos FUTUROS — não deve atrasar
  // a resposta atual nem a liberação para o próximo comando. Roda em segundo plano.
  void summarizeIfNeeded(sessionId)

  unregisterRun()
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
 * pelo renderer após responder) para não atrasar a fala. Classifica por categoria e
 * relevância; com autoApprove desligado, os fatos ficam pendentes para revisão.
 */
export async function extractFacts(sessionId: string): Promise<MemoryFact[]> {
  const cfg = readConfig()
  if (!cfg.memory.autoExtract) return loadMemory()
  const s = getSession(sessionId)
  if (!s || s.messages.length < 2) return loadMemory()
  const recent = s.messages.slice(-10).map((m) => `${m.role === 'user' ? 'Usuário' : 'ARES'}: ${m.content}`).join('\n')
  const known = memorySummary(800)
  const sys =
    'Você extrai memória curada estilo Hermes: fatos DURADOUROS e úteis sobre o usuário, preferências, correções, perfil, rotina, trabalho, projetos, restrições e interesses. ' +
    'Ignore pedidos pontuais, progresso temporário, logs, saídas brutas, chaves, tokens, prompts, small talk e qualquer coisa efêmera. Não repita fatos já conhecidos. ' +
    'Responda APENAS JSON: {"fatos":[{"texto":"...","categoria":"perfil|preferencias|rotina|trabalho|projetos|restricoes|interesses|outros","confianca":0.0-1.0,"evidencia":"trecho curto"}]}. ' +
    'Se nada relevante, responda {"fatos":[]}. Máximo 3 fatos; cada texto deve ser curto, denso e útil em sessões futuras.'
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
    const status = cfg.memory.autoApprove ? 'active' : 'pending'
    for (const f of fatos.slice(0, 3)) {
      const texto = String(f?.texto || '').trim()
      if (texto.length > 3) {
        addFact(texto, {
          category: asCategory(f?.categoria),
          source: 'auto',
          status,
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
