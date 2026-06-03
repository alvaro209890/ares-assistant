import type { Acao, AgentTurnResult, Board, CalendarEvent, ChatMessage, MemoryFact } from '../shared/types'
import { readConfig } from './config'
import { chatJSON } from './ninerouter'
import { parseEnvelope, QUERY_TOOLS } from '../shared/protocol'
import { applyBoardAction } from './board'
import { loadBoard, saveBoard, boardSummary } from './tasks'
import {
  loadMemory,
  addFact,
  removeFact,
  loadEvents,
  addEvent,
  removeEvent,
  getSession,
  appendMessages,
  setSessionSummary
} from './data'
import { getWeather, getNews, webSearch } from './tools'

const norm = (s: unknown) => String(s ?? '').toLowerCase().trim()
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const PERSONA = `Você é o Ares, assistente de IA pessoal inspirado no JARVIS. Fala português do Brasil de forma educada, elegante, levemente espirituosa e muito competente. Trata o usuário com respeito (pode chamar de "senhor" com sutileza). Respostas curtas, úteis e naturais para serem OUVIDAS em voz alta — evite listas longas.`

function toolDocs(): string {
  return `Você SEMPRE responde com um único objeto JSON, sem texto fora dele, no formato:
{"fala": "<frase curta e falável em pt-BR>", "acoes": [ {"tipo": "...", ...campos} ]}
Se for só conversa, use "acoes": [].

AÇÕES DE MUTAÇÃO (aplique quando o usuário pedir):
- tarefa.criar {titulo, coluna?, descricao?, prioridade?(baixa|media|alta), cor?(cyan|blue|green|amber|pink), prazo?(ISO), lembrete?(ISO), subtarefas?(["..."])}
- tarefa.mover {titulo, paraColuna}
- tarefa.concluir {titulo}   |   tarefa.reabrir {titulo}   |   tarefa.remover {titulo}
- tarefa.editar {titulo, novoTitulo?, descricao?, prioridade?, cor?, prazo?}
- tarefa.subtarefa.adicionar {titulo, item}   |   tarefa.subtarefa.concluir {titulo, item}
- tarefa.lembrete.definir {titulo, quando(ISO)}
- coluna.criar {titulo}   |   coluna.renomear {titulo, novoTitulo}   |   coluna.remover {titulo}
- memoria.salvar {fato}   |   memoria.remover {fato}   (fatos/preferências do usuário)
- evento.criar {titulo, quando(ISO), descricao?}   |   evento.remover {titulo}

FERRAMENTAS DE CONSULTA (use a ação, dê uma fala curta tipo "Deixe-me verificar, senhor." e AGUARDE os resultados para então responder):
- clima.consultar {cidade?}
- web.buscar {consulta}
- noticias.listar {tema?}
- agenda.listar {dia?(ISO date)}
- tarefa.listar {}

Regras: use nomes de colunas/tarefas existentes (ver CONTEXTO). Datas SEMPRE em ISO 8601 local (ex.: 2026-06-03T09:00). Não invente dados de clima/web/notícias — só fale o que vier dos resultados.`
}

function buildSystemPrompt(ctx: {
  facts: MemoryFact[]
  board: Board
  events: CalendarEvent[]
  summary?: string
}): string {
  const now = new Date()
  const factsTxt = ctx.facts.length ? ctx.facts.map((f) => `- ${f.text}`).join('\n') : '(nada registrado)'
  const upcoming = ctx.events
    .filter((e) => new Date(e.whenISO).getTime() > Date.now() - 3600_000)
    .slice(0, 8)
    .map((e) => `- ${new Date(e.whenISO).toLocaleString('pt-BR')}: ${e.title}`)
    .join('\n')
  return [
    PERSONA,
    toolDocs(),
    `# CONTEXTO`,
    `Agora: ${now.toLocaleString('pt-BR')} (ISO ${now.toISOString()})`,
    `## Sobre o usuário (memória de longo prazo)\n${factsTxt}`,
    `## Tarefas atuais\n${boardSummary(ctx.board)}`,
    `## Próximos eventos\n${upcoming || '(nenhum)'}`,
    ctx.summary ? `## Resumo da conversa anterior\n${ctx.summary}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function runQuery(a: Acao, defaultCity: string): Promise<unknown> {
  try {
    switch (a.tipo) {
      case 'clima.consultar':
        return { tipo: a.tipo, resultado: await getWeather(String(a.cidade || defaultCity)) }
      case 'web.buscar':
        return { tipo: a.tipo, resultado: await webSearch(String(a.consulta || a.query || '')) }
      case 'noticias.listar':
        return { tipo: a.tipo, resultado: await getNews(String(a.tema || '')) }
      case 'agenda.listar': {
        const dia = a.dia ? String(a.dia).slice(0, 10) : null
        const evs = loadEvents().filter((e) => (dia ? e.whenISO.slice(0, 10) === dia : true))
        return { tipo: a.tipo, resultado: evs.map((e) => ({ titulo: e.title, quando: e.whenISO, descricao: e.description })) }
      }
      case 'tarefa.listar':
        return { tipo: a.tipo, resultado: boardSummary(loadBoard()) }
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
      addFact(String(a.fato))
      notes.push('memória atualizada')
    } else if (a.tipo === 'memoria.remover' && a.fato) {
      const f = loadMemory().find((x) => norm(x.text).includes(norm(a.fato)))
      if (f) removeFact(f.id)
    } else if (a.tipo === 'evento.criar' && a.titulo && a.quando) {
      addEvent({ title: String(a.titulo), whenISO: String(a.quando), description: a.descricao ? String(a.descricao) : undefined })
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
    userText.match(/(?:lembre-se que|lembra que|memorize que|guarde que)\s+(.+)/i) ||
    userText.match(/(?:minha preferência é|eu prefiro)\s+(.+)/i)
  const fact = match?.[1]?.replace(/[.!?]+$/, '').trim()
  return fact ? [...acoes, { tipo: 'memoria.salvar', fato: fact }] : acoes
}

/** Executa um turno completo de conversa + ações. */
export async function runTurn(sessionId: string, userText: string): Promise<AgentTurnResult> {
  const cfg = readConfig()
  const session = getSession(sessionId)
  const recent = (session?.messages || []).slice(-12)
  const sys = buildSystemPrompt({
    facts: loadMemory(),
    board: loadBoard(),
    events: loadEvents(),
    summary: session?.summary
  })
  const messages: ChatMessage[] = [
    { role: 'system', content: sys },
    ...recent.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: 'user', content: userText }
  ]

  let env = parseEnvelope(await chatJSON(cfg, messages, true))
  let fala = env.fala
  let mutations = env.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo))
  const queries = env.acoes.filter((a) => QUERY_TOOLS.has(a.tipo))

  if (queries.length) {
    const results: unknown[] = []
    for (const q of queries) results.push(await runQuery(q, cfg.integrations.weatherCity))
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
    const env2 = parseEnvelope(await chatJSON(cfg, followup, true))
    if (env2.fala) fala = env2.fala
    mutations = mutations.concat(env2.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo)))
  }

  mutations = memoryFallback(userText, mutations)

  const { board, notes, changedBoard } = applyMutations(mutations)

  appendMessages(sessionId, [
    { id: uid('m'), role: 'user', content: userText, ts: Date.now() },
    { id: uid('m'), role: 'assistant', content: fala, ts: Date.now() }
  ])
  await summarizeIfNeeded(sessionId)

  return { fala, board, memory: loadMemory(), events: loadEvents(), notes, changedBoard }
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
