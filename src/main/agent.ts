import type { Acao, AgentTurnResult, AppConfig, Board, CalendarEvent, ChatMessage, MemoryCategory, MemoryFact, UserLocation } from '../shared/types'
import { MEMORY_CATEGORIES } from '../shared/types'
import { readConfig } from './config'
import { chatJSON, streamChat } from './ninerouter'
import { parseEnvelope, QUERY_TOOLS, validateAction, extractFalaPrefix } from '../shared/protocol'
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
  setSessionSummary
} from './data'
import { getWeather, getWeatherAt, getNews, webSearch } from './tools'
import { buildBriefing, briefingToSpeech } from './briefing'

const norm = (s: unknown) => String(s ?? '').toLowerCase().trim()
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const asCategory = (c: unknown): MemoryCategory | undefined =>
  MEMORY_CATEGORIES.includes(c as MemoryCategory) ? (c as MemoryCategory) : undefined

const PERSONA = `Você é o Ares, assistente de IA pessoal inspirado no JARVIS. Fala português do Brasil de forma educada, elegante, levemente espirituosa e muito competente. Trata o usuário com respeito (pode chamar de "senhor" com sutileza, sem repetir a cada frase). Seja natural e direto, nunca robótico. Use o CONTEXTO (memória, agenda, tarefas, localização) para responder de forma pessoal e útil, sem repetir dados que o usuário não pediu.`

const VOICE_HINT =
  'A resposta será OUVIDA em voz alta: seja MUITO conciso (1-2 frases), sem listas, sem markdown, sem URLs longas. Diga o essencial.'
const TEXT_HINT = 'Pode ser um pouco mais detalhado quando ajudar, mas evite enrolação e listas longas desnecessárias.'

function toolDocs(): string {
  return `Você SEMPRE responde com um único objeto JSON válido, sem texto fora dele, no formato:
{"fala": "<resposta curta e falável em pt-BR>", "acoes": [ {"tipo": "...", ...campos} ]}
Se for só conversa, use "acoes": [].

QUANDO AGIR vs SÓ RESPONDER:
- Use ferramentas/ações somente quando o pedido exigir (criar/alterar dados, ou buscar info que você não tem).
- Para conversa, opinião ou algo já presente no CONTEXTO, apenas responda em "fala" com "acoes": [].
- Nunca invente clima, notícias, resultados de busca ou agenda: use a ferramenta e fale só o que voltar.

AÇÕES DE MUTAÇÃO (aplique quando o usuário pedir):
- tarefa.criar {titulo, coluna?, descricao?, prioridade?(baixa|media|alta), cor?(cyan|blue|green|amber|pink), prazo?(ISO), lembrete?(ISO), etiquetas?(["..."]), repetir?(none|daily|weekly|monthly), subtarefas?(["..."])}
- tarefa.mover {titulo, paraColuna}
- tarefa.concluir {titulo}   |   tarefa.reabrir {titulo}   |   tarefa.remover {titulo}
- tarefa.editar {titulo, novoTitulo?, descricao?, prioridade?, cor?, prazo?, etiquetas?, repetir?}
- tarefa.subtarefa.adicionar {titulo, item}   |   tarefa.subtarefa.concluir {titulo, item}
- tarefa.lembrete.definir {titulo, quando(ISO)}
- coluna.criar {titulo}   |   coluna.renomear {titulo, novoTitulo}   |   coluna.remover {titulo}
- memoria.salvar {fato, categoria?(perfil|preferencias|rotina|trabalho|projetos|restricoes|interesses|outros)}   |   memoria.remover {fato}
- evento.criar {titulo, quando(ISO), descricao?, lembreteMin?(minutos antes), repetir?(none|daily|weekly|monthly)}   |   evento.remover {titulo}

FERRAMENTAS DE CONSULTA (dê uma fala curta tipo "Deixe-me verificar." e AGUARDE os resultados para então responder):
- clima.consultar {cidade?}   (sem cidade = usa a localização aproximada)
- web.buscar {consulta}
- noticias.listar {tema?}
- agenda.listar {dia?(ISO date)}
- tarefa.listar {}
- briefing.consultar {}   (use quando pedirem "briefing", "resumo do dia", "como está meu dia")

Regras: use nomes de colunas/tarefas existentes (ver CONTEXTO). Datas SEMPRE em ISO local sem fuso (ex.: 2026-06-03T09:00), resolvidas pela seção DATAS. memoria.salvar só para fatos duradouros do usuário (preferências, perfil, rotina), nunca para pedidos pontuais.`
}

// Âncoras de datas relativas, pré-calculadas, para o LLM resolver "hoje", "amanhã",
// "semana que vem", "daqui a 2 horas" etc. de forma consistente.
function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function dateAnchors(now: Date): string {
  const day = (offset: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + offset)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  // próxima segunda-feira (início de "semana que vem")
  const nextMon = new Date(now)
  const delta = ((8 - nextMon.getDay()) % 7) || 7
  nextMon.setDate(nextMon.getDate() + delta)
  const weekday = now.toLocaleDateString('pt-BR', { weekday: 'long' })
  return [
    `Agora: ${weekday}, ${now.toLocaleString('pt-BR')} (ISO local ${localISO(now)})`,
    `Hoje=${day(0)} · Amanhã=${day(1)} · Depois de amanhã=${day(2)}`,
    `Próxima segunda (semana que vem começa aqui)=${nextMon.getFullYear()}-${String(nextMon.getMonth() + 1).padStart(2, '0')}-${String(nextMon.getDate()).padStart(2, '0')}`,
    `"daqui a N horas/minutos" = some à hora atual. Sem horário dito, assuma 09:00 para o dia indicado.`
  ].join('\n')
}

function buildSystemPrompt(ctx: {
  board: Board
  events: CalendarEvent[]
  location: UserLocation
  summary?: string
  voice: boolean
}): string {
  const now = new Date()
  const upcoming = ctx.events
    .filter((e) => new Date(e.whenISO).getTime() > Date.now() - 3600_000)
    .slice(0, 8)
    .map((e) => `- ${new Date(e.whenISO).toLocaleString('pt-BR')}: ${e.title}`)
    .join('\n')
  const loc =
    ctx.location.enabled && typeof ctx.location.latitude === 'number' && typeof ctx.location.longitude === 'number'
      ? `${ctx.location.label || ctx.location.city || 'localização atual'} (aprox.)`
      : '(não disponível; use a cidade padrão quando necessário)'
  return [
    PERSONA,
    ctx.voice ? VOICE_HINT : TEXT_HINT,
    toolDocs(),
    `# CONTEXTO`,
    `## DATAS\n${dateAnchors(now)}`,
    `## Localização aproximada do usuário\n${loc}`,
    `## Sobre o usuário (memória de longo prazo)\n${memorySummary()}`,
    `## Tarefas atuais\n${boardSummary(ctx.board)}`,
    `## Próximos eventos\n${upcoming || '(nenhum)'}`,
    ctx.summary ? `## Resumo da conversa anterior\n${ctx.summary}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function runQuery(a: Acao, cfg: AppConfig): Promise<unknown> {
  const integrations = cfg.integrations
  try {
    switch (a.tipo) {
      case 'clima.consultar': {
        const city = String(a.cidade || '').trim()
        const resultado = city
          ? await getWeather(city)
          : integrations.location.enabled && typeof integrations.location.latitude === 'number'
            ? await getWeatherAt(integrations.location)
            : await getWeather(integrations.weatherCity)
        return { tipo: a.tipo, resultado }
      }
      case 'web.buscar':
        return { tipo: a.tipo, resultado: await webSearch(String(a.consulta || a.query || '')) }
      case 'noticias.listar':
        return { tipo: a.tipo, resultado: await getNews(String(a.tema || integrations.newsTopic || '')) }
      case 'agenda.listar': {
        const dia = a.dia ? String(a.dia).slice(0, 10) : null
        const evs = loadEvents().filter((e) => (dia ? e.whenISO.slice(0, 10) === dia : true))
        return { tipo: a.tipo, resultado: evs.map((e) => ({ titulo: e.title, quando: e.whenISO, descricao: e.description })) }
      }
      case 'tarefa.listar':
        return { tipo: a.tipo, resultado: boardSummary(loadBoard()) }
      case 'briefing.consultar': {
        const b = await buildBriefing(cfg)
        return {
          tipo: a.tipo,
          resultado: {
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
          }
        }
      }
    }
  } catch (e) {
    return { tipo: a.tipo, erro: e instanceof Error ? e.message : String(e) }
  }
  return { tipo: a.tipo, erro: 'ferramenta desconhecida' }
}

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
      addFact(String(a.fato), { category: asCategory(a.categoria), source: 'manual', status: 'active' })
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

export type DeltaFn = (chunk: string, phase: number) => void

/**
 * Faz uma chamada do agente transmitindo a "fala" em tempo real (streaming) via
 * onDelta. Sem consumidor de streaming, cai na chamada JSON robusta. Em falha de
 * stream sem nada emitido, faz fallback para chatJSON.
 */
async function streamTurn(
  cfg: AppConfig,
  messages: ChatMessage[],
  phase: number,
  onDelta?: DeltaFn
): Promise<string> {
  if (!onDelta) return chatJSON(cfg, messages, true)
  let cumulative = ''
  let emitted = 0
  const pump = (full: string): void => {
    const { text } = extractFalaPrefix(full)
    if (text.length > emitted) {
      onDelta(text.slice(emitted), phase)
      emitted = text.length
    }
  }
  try {
    const full = await streamChat(cfg, messages, (delta) => {
      cumulative += delta
      pump(cumulative)
    })
    pump(full)
    return full
  } catch (e) {
    if (emitted > 0) throw e // já falamos parte: não dá para refazer com segurança
    const full = await chatJSON(cfg, messages, true)
    const env = parseEnvelope(full)
    if (env.fala) onDelta(env.fala, phase)
    return full
  }
}

/** Separa as ações válidas das inválidas, com notas para o usuário. */
function validateActions(acoes: Acao[]): { valid: Acao[]; notes: string[] } {
  const valid: Acao[] = []
  const notes: string[] = []
  for (const a of acoes) {
    const v = validateAction(a)
    if (v.ok) valid.push(a)
    else notes.push(`ação ignorada (${v.error})`)
  }
  return { valid, notes }
}

/** Executa um turno completo de conversa + ações, com fala transmitida em streaming. */
export async function runTurn(
  sessionId: string,
  userText: string,
  voice = false,
  onDelta?: DeltaFn
): Promise<AgentTurnResult> {
  const cfg = readConfig()
  const session = getSession(sessionId)
  const recent = (session?.messages || []).slice(-12)
  const sys = buildSystemPrompt({
    board: loadBoard(),
    events: loadEvents(),
    location: cfg.integrations.location,
    summary: session?.summary,
    voice
  })
  const messages: ChatMessage[] = [
    { role: 'system', content: sys },
    ...recent.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: 'user', content: userText }
  ]

  const env = parseEnvelope(await streamTurn(cfg, messages, 1, onDelta))
  let fala = env.fala
  const allNotes: string[] = []
  let mutations = env.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo))
  const queries = env.acoes.filter((a) => QUERY_TOOLS.has(a.tipo))

  if (queries.length) {
    const results: unknown[] = []
    for (const q of queries) results.push(await runQuery(q, cfg))
    const followup: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: env.fala || '...' },
      {
        role: 'system',
        content:
          'Resultados das ferramentas (responda ao usuário em pt-BR, curto e falável, sem inventar nada além disto):\n' +
          JSON.stringify(results)
      }
    ]
    // Fase 2 (resposta final após as ferramentas): novo streaming, fase 2 = reset no cliente.
    const env2 = parseEnvelope(await streamTurn(cfg, followup, 2, onDelta))
    if (env2.fala) fala = env2.fala
    mutations = mutations.concat(env2.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo)))
  }

  mutations = memoryFallback(userText, mutations)
  const validated = validateActions(mutations)
  allNotes.push(...validated.notes)

  const { board, notes, changedBoard } = applyMutations(validated.valid)
  allNotes.push(...notes)

  appendMessages(sessionId, [
    { id: uid('m'), role: 'user', content: userText, ts: Date.now() },
    { id: uid('m'), role: 'assistant', content: fala, ts: Date.now() }
  ])
  await summarizeIfNeeded(sessionId)

  return { fala, board, memory: loadMemory(), events: loadEvents(), notes: allNotes, changedBoard }
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
    'Você extrai fatos DURADOUROS e úteis sobre o usuário a partir da conversa (preferências, perfil, rotina, trabalho, projetos, restrições, interesses). ' +
    'Ignore pedidos pontuais, tarefas, small talk e qualquer coisa efêmera. Não repita fatos já conhecidos. ' +
    'Responda APENAS um JSON: {"fatos":[{"texto":"...","categoria":"perfil|preferencias|rotina|trabalho|projetos|restricoes|interesses|outros"}]}. ' +
    'Se nada relevante, responda {"fatos":[]}. Máximo 3 fatos, cada um curto e em 1ª/3ª pessoa clara.'
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
    const fatos: { texto?: string; categoria?: string }[] = Array.isArray(obj?.fatos) ? obj.fatos : []
    const status = cfg.memory.autoApprove ? 'active' : 'pending'
    for (const f of fatos.slice(0, 3)) {
      const texto = String(f?.texto || '').trim()
      if (texto.length > 3) addFact(texto, { category: asCategory(f?.categoria), source: 'auto', status })
    }
  } catch {
    /* extração é best-effort */
  }
  return loadMemory()
}

export { buildBriefing, briefingToSpeech }
