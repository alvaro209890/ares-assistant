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
  setSessionSummary,
  listCreate,
  listAddItem,
  listToggleItem,
  listRemoveItem,
  listClear,
  listsSummary,
  loadLists,
  addNote,
  loadNotes,
  addReminder,
  removeReminderByText,
  remindersSummary,
  loadReminders,
  userDataDir
} from './data'
import { getWeather, getWeatherAt, getNews, webSearch, calcExpression, convertCurrency, convertUnit, readPage } from './tools'
import { getSystemMetrics, readClipboard, writeClipboard } from './system'
import {
  controlPromptContext,
  runBrightness,
  runLock,
  runMedia,
  runOpen,
  runScreenshot,
  runVolume,
  type BrightnessAction,
  type MediaAction,
  type VolumeAction
} from './control'
import { pushUndo, undoLast } from './history'
import { runCoderTask } from './coder'
import { clearPendingConfirm, decideConfirmation, getPendingConfirm, setPendingConfirm } from './confirm'
import { buildBriefing, briefingToSpeech } from './briefing'
import {
  applyCodePatch,
  buildCodeIndex,
  codePromptContext,
  diagnoseProject,
  previewCodePatch,
  readCodeFile,
  runCodeCommand,
  runCodeGit,
  runCodeTerminal,
  scaffoldProject,
  searchCode,
  summarizeCodeWorkspace,
  writeCodeFile
} from './code'
import { clearPendingCode, getPendingCode, setPendingCode } from './pending'

const norm = (s: unknown) => String(s ?? '').toLowerCase().trim()
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const asCategory = (c: unknown): MemoryCategory | undefined =>
  MEMORY_CATEGORIES.includes(c as MemoryCategory) ? (c as MemoryCategory) : undefined

/** Mapeia a fala do usuário ("aumenta", "mudo", "alterna") para uma ação de volume. */
function normVolumeAction(raw: unknown): VolumeAction {
  const s = norm(raw)
  if (/(des ?mut|religa|tira.*mudo|unmute|liga.*som)/.test(s)) return 'unmute'
  if (/(mut|mudo|silenci|sem som)/.test(s)) return 'mute'
  if (/(toggle|alterna)/.test(s)) return 'toggle'
  if (/(up|aument|sub|mais|\+|alto)/.test(s)) return 'up'
  if (/(down|dimin|baix|menos|-)/.test(s)) return 'down'
  return 'set'
}

/** Mapeia a fala ("pausa", "próxima", "tocar") para uma ação de mídia. */
function normMediaAction(raw: unknown): MediaAction {
  const s = norm(raw)
  if (/(prox|próx|pul|next|avan|frente|adiant)/.test(s)) return 'next'
  if (/(anter|volt|previous|prev|retroce)/.test(s)) return 'previous'
  if (/(stop|parar|^pare|interromp)/.test(s)) return 'stop'
  if (/(continu|retoma|despaus|resume|^play|^toca|^tocar)/.test(s)) return 'play'
  if (/(paus)/.test(s)) return 'pause'
  return 'playpause'
}

/** Mapeia a fala ("clareia", "escurece") para uma ação de brilho. */
function normBrightnessAction(raw: unknown): BrightnessAction {
  const s = norm(raw)
  if (/(up|aument|sub|mais|clar|ilumin)/.test(s)) return 'up'
  if (/(down|dimin|baix|menos|escur)/.test(s)) return 'down'
  return 'set'
}

const PERSONA = `Você é o Ares, assistente de IA pessoal inspirado no JARVIS. Fala português do Brasil de forma educada, elegante, levemente espirituosa e muito competente. Trata o usuário com respeito (pode chamar de "senhor" com sutileza, sem repetir a cada frase). Seja natural e direto, nunca robótico. Use o CONTEXTO (memória, agenda, tarefas, localização) para responder de forma pessoal e útil, sem repetir dados que o usuário não pediu.
Em assuntos de programação você é um engenheiro de software sênior: fala com precisão técnica mas em linguagem clara e falável, sem ler código longo nem despejar logs inteiros — resume e cita arquivo:linha. ANTES de executar no terminal qualquer comando que altere o sistema, instale dependências, crie/apague arquivos ou mexa no Git (commit/push), você PEDE AUTORIZAÇÃO ao usuário de forma natural ("Senhor, isso vai rodar tal comando — autoriza?") e só age após o aceite. Nunca tenta burlar bloqueios de segurança nem usar sudo.`

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
- lista.criar {titulo}   |   lista.adicionar {item, lista?}   |   lista.marcar {item, lista?, feito?(bool)}   |   lista.removerItem {item, lista?}   |   lista.limpar {lista}   (listas simples: compras, afazeres)
- nota.salvar {texto}   (anotações rápidas; também para guardar rascunhos de mensagens/e-mails)
- lembrete.criar {texto, quando?(ISO), emMinutos?(número), repetir?(none|daily|weekly|monthly), modo?(reminder|timer|alarm)}   |   lembrete.remover {texto}
  · "me lembra do remédio todo dia às 8h" -> lembrete.criar {texto:"remédio", quando ISO de hoje 08:00, repetir:"daily"}
  · "põe um timer de 10 minutos" -> lembrete.criar {texto:"timer", emMinutos:10, modo:"timer"}
  · "me acorda às 6h" -> lembrete.criar {texto:"despertador", quando ISO 06:00, modo:"alarm"}

FERRAMENTAS DE CONSULTA (dê uma fala curta tipo "Deixe-me verificar." e AGUARDE os resultados para então responder):
- clima.consultar {cidade?}   (sem cidade = usa a localização aproximada)
- web.buscar {consulta}
- noticias.listar {tema?}
- agenda.listar {dia?(ISO date)}
- tarefa.listar {}
- briefing.consultar {}   (use quando pedirem "briefing", "resumo do dia", "como está meu dia")
- calcular {expressao}   (contas: "30% de 250", "12*7+3")
- converter.moeda {de, para, valor}   (ex.: de:"USD", para:"BRL", valor:50)
- converter.unidade {de, para, valor}   (medidas locais: comprimento, massa, volume, área, velocidade, tempo, dados e temperatura — ex.: de:"km", para:"milhas", valor:10; de:"C", para:"F", valor:30)
- pagina.ler {url}   (lê uma página da web e resume/responde a partir do conteúdo real dela)
- sistema.status {}   (uso de CPU, memória e tempo ligado do computador — "como está o sistema?", "quanta memória livre?")
- area.ler {}   (lê o texto da área de transferência para resumir/traduzir/explicar o que o usuário copiou — "resuma o que eu copiei")
- area.escrever {texto}   (copia um texto para a área de transferência — "copie isso", "põe esse texto na área de transferência")
- sistema.abrir {alvo}   (abre app/site/arquivo no computador — "abra o Firefox", "abra youtube.com", "abra ~/Documentos"; use nomes comuns: firefox, chrome, vscode, calculadora, arquivos, terminal)
- sistema.volume {acao(set|up|down|mute|unmute|toggle), nivel?(0-100)}   (controla o volume — "aumenta o volume", "volume em 30", "muda pro mudo")
- sistema.bloquear {}   (bloqueia a tela do computador — "bloqueie a tela", "trave o pc")
- sistema.captura {}   (tira uma captura de tela e salva em arquivo — "tire um print da tela")
- sistema.midia {acao(playpause|play|pause|next|previous|stop)}   (controla a música/vídeo tocando — "pausa", "próxima", "toca")
- sistema.brilho {acao(set|up|down), nivel?(0-100)}   (ajusta o brilho da tela — "clareia a tela", "brilho em 50", "escurece")
- desfazer {}   (desfaz a ÚLTIMA alteração de dados — tarefa/lista/nota/lembrete/evento/memória; use quando o usuário disser "desfaz", "cancela isso", "volta atrás")
- codigo.workspace {path?}   (resume um projeto/workspace local: stack, scripts, árvore, git, linguagens)
- codigo.buscar {path?, consulta, filtro?}   (busca texto/símbolo no código; use antes de explicar funções ou localizar implementação)
- codigo.ler {path?, arquivo, inicio?, linhas?}   (lê trecho de arquivo local com números de linha; use para responder com precisão)
- codigo.comando {path?, comando}   (executa comando de dev da allowlist, sem shell, com timeout; use para testes/build/typecheck)
- codigo.terminal {path?, comando, confirmado?}   (TERMINAL completo via shell, com pipes/&&/redirecionamento. Comando seguro/allowlist roda direto; qualquer outro EXIGE autorização: chame SEM "confirmado" para propor — vem requiresApproval — explique e peça o "sim"; comandos catastróficos/sudo são bloqueados)
- codigo.confirmar {}   (executa a ação que ficou pendente de autorização, DEPOIS que o usuário disser sim/autorizo/pode)
- codigo.cancelar {}   (descarta a ação pendente quando o usuário recusar)
- codigo.git {path?, operacao(status|diff|diffStat|log), arquivo?}   (consulta Git local sem alterar repo)
- codigo.indexar {path?, refresh?(bool)}   (gera/lê índice persistente de arquivos, exports e scripts do projeto)
- codigo.scaffold {nome, tipo_projeto?(site|pagina|node), path?}   (CRIA um projeto novo a partir de template — use para "crie um site/página/projeto"; precisa de "Permitir aplicar patches")
- codigo.criar {path?, arquivo, conteudo, sobrescrever?(bool)}   (cria/escreve um arquivo no projeto; precisa de "Permitir aplicar patches")
- codigo.diagnostico {path?}   (verifica a saúde do projeto: roda typecheck/lint/test disponíveis e permitidos e resume; use proativamente após mudanças)
- codigo.projeto {objetivo, path?, passos?}   (CODER AUTÔNOMO: dado um objetivo, ele planeja, escreve os arquivos, roda checagens seguras e itera sozinho até concluir; precisa de "Permitir aplicar patches". Use para "construa/faça um app/site/programa que faça X" quando envolver vários arquivos ou lógica)
- codigo.patch.preview {path?, diff?, patches?}   (valida e resume patch antes de aplicar; use sempre antes de aplicação)
- codigo.patch.aplicar {path?, diff?, patches?}   (aplica patch apenas se habilitado e já confirmado pelo usuário)

MODO PROGRAMADOR:
- Para perguntas de código, não chute: use codigo.workspace/codigo.buscar/codigo.ler quando houver path, arquivo, símbolo ou repo mencionado.
- Se o usuário pedir edição/refatoração/debug/testes em projeto real, trabalhe com as ferramentas nativas: localize contexto, leia os arquivos, escreva com codigo.criar/codigo.patch.aplicar ou use codigo.projeto para mudanças maiores.
- Para patches, primeiro use codigo.patch.preview. Só use codigo.patch.aplicar se o usuário pedir claramente para aplicar e a config permitir.
- Para validar mudanças, use codigo.comando com scripts permitidos (ex.: npm test, npm run build, npm run typecheck) e reporte stdout/stderr relevantes.
- TERMINAL: para testes/build padrão prefira codigo.comando; para QUALQUER outro comando (instalar dependência, criar/editar arquivo, git add/commit/push, rodar script próprio) use codigo.terminal.
- AUTORIZAÇÃO: se codigo.terminal devolver requiresApproval, NÃO repita a chamada nem invente que rodou. Diga em voz natural exatamente o comando que será executado e por quê, e peça confirmação. Quando o usuário autorizar, chame codigo.confirmar; se recusar, chame codigo.cancelar. Só anuncie um resultado depois que "ran" for true.
- SEGURANÇA: comandos bloqueados (sudo, rm -rf de raiz/HOME, formatar disco etc.) não rodam de jeito nenhum — explique que é por segurança, não tente contornar.
- Ao rodar comandos, reporte o código de saída e só o essencial do stdout/stderr; não leia saídas longas inteiras em voz.
- Para estado do repo, use codigo.git em vez de inventar status/diff.
- CRIAR PROJETOS: para um modelo simples e conhecido ("crie um site/página em branco"), use codigo.scaffold. Para algo com lógica ou vários arquivos ("faça um app de lista de tarefas", "construa uma calculadora", "um jogo da velha"), use codigo.projeto (CODER AUTÔNOMO), que constrói tudo sozinho. Se o usuário indicar onde (ex.: um caminho), passe o path. Depois diga em uma frase como abrir/rodar.
- PROATIVIDADE EM CÓDIGO: aja como engenheiro proativo — depois de criar/editar, ofereça e, quando fizer sentido, rode codigo.diagnostico ou codigo.comando para validar e relate o resultado (passou/falhou + o essencial). Aponte riscos e o próximo passo, sem esperar o usuário pedir.
- Escrita real (codigo.scaffold/codigo.criar) exige "Permitir aplicar patches" ligado; se vier erro de desativado, explique como ligar.
- Sem path explícito, use o workspace padrão de programação. Se o pedido depender de um repo específico e o contexto não deixar claro, peça o path.
- Explique respostas de código com referências de arquivo/linha quando a ferramenta devolver linhas.

CONFIANÇA NA CONVERSA:
- CONFIRMAÇÃO: para REMOVER/APAGAR/LIMPAR dados (tarefa.remover, coluna.remover, evento.remover, lembrete.remover, memoria.remover, lista.limpar), inclua a ação no JSON E pergunte na fala de forma curta ("Confirma que apago a tarefa X?"). O sistema SEGURA a ação até o usuário confirmar; quando ele disser "sim/pode/confirmo", apenas confirme na fala ("Pronto, removida.") — não precisa repetir a ação. Se disser "não", diga que manteve. Nunca diga que apagou antes da confirmação.
- DESAMBIGUAÇÃO: se o pedido casar com VÁRIOS itens existentes (você vê tarefas/eventos/listas no CONTEXTO) e não estiver claro qual, pergunte "qual deles?" listando as opções, em vez de chutar.
- CORREÇÃO: se o usuário corrigir ("não, eu disse X", "não era isso", "errado"), reconheça; se a última ação foi errada, inclua a ação desfazer e refaça com o valor certo.

Regras: use nomes de colunas/tarefas/listas existentes (ver CONTEXTO). Datas SEMPRE em ISO local sem fuso (ex.: 2026-06-03T09:00), resolvidas pela seção DATAS. memoria.salvar só para fatos duradouros do usuário (preferências, perfil, rotina), nunca para pedidos pontuais. Para rascunho de mensagem/e-mail: escreva o texto em "fala" para o usuário revisar e, se ele pedir para guardar, use nota.salvar. Para ações externas sensíveis (enviar mensagem, publicar, alterar serviços externos), só oriente o usuário ou peça confirmação; não finja integrações que não existem.`
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
  const h = now.getHours()
  const periodo = h < 5 ? 'madrugada' : h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite'
  return [
    `Agora: ${weekday}, ${now.toLocaleString('pt-BR')} (ISO local ${localISO(now)}) — período: ${periodo}`,
    `Saudações coerentes com o período: "bom dia" de manhã, "boa tarde" à tarde, "boa noite" à noite.`,
    `Hoje=${day(0)} · Amanhã=${day(1)} · Depois de amanhã=${day(2)}`,
    `Próxima segunda (semana que vem começa aqui)=${nextMon.getFullYear()}-${String(nextMon.getMonth() + 1).padStart(2, '0')}-${String(nextMon.getDate()).padStart(2, '0')}`,
    `"daqui a N horas/minutos" = some à hora atual. Sem horário dito, assuma 09:00 para o dia indicado.`
  ].join('\n')
}

function buildSystemPrompt(ctx: {
  board: Board
  events: CalendarEvent[]
  location: UserLocation
  codeContext: string
  controlContext: string
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
      : ctx.location.city || ctx.location.label
        ? `${ctx.location.label || [ctx.location.city, ctx.location.region].filter(Boolean).join(', ')} (manual)`
      : '(não disponível; use a cidade padrão quando necessário)'
  return [
    PERSONA,
    ctx.voice ? VOICE_HINT : TEXT_HINT,
    toolDocs(),
    `# CONTEXTO`,
    `## DATAS\n${dateAnchors(now)}`,
    `## Localização aproximada do usuário\n${loc}`,
    `## Programação\n${ctx.codeContext}`,
    `## Controle do computador\n${ctx.controlContext}`,
    `## Sobre o usuário (memória de longo prazo)\n${memorySummary()}`,
    `## Tarefas atuais\n${boardSummary(ctx.board)}`,
    `## Próximos eventos\n${upcoming || '(nenhum)'}`,
    `## Lembretes\n${remindersSummary()}`,
    `## Listas\n${listsSummary()}`,
    ctx.summary ? `## Resumo da conversa anterior\n${ctx.summary}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function runQuery(a: Acao, cfg: AppConfig, sessionId: string): Promise<unknown> {
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
      case 'calcular':
        return { tipo: a.tipo, resultado: calcExpression(String(a.expressao || a.conta || '')) }
      case 'converter.moeda':
        return {
          tipo: a.tipo,
          resultado: await convertCurrency(String(a.de || ''), String(a.para || ''), Number(a.valor))
        }
      case 'converter.unidade':
        return {
          tipo: a.tipo,
          resultado: convertUnit(String(a.de || ''), String(a.para || ''), Number(a.valor))
        }
      case 'pagina.ler':
        return { tipo: a.tipo, resultado: await readPage(String(a.url || a.endereco || a.link || '')) }
      case 'sistema.status':
        return { tipo: a.tipo, resultado: getSystemMetrics() }
      case 'area.ler': {
        const c = readClipboard()
        return c.vazio ? { tipo: a.tipo, erro: 'A área de transferência está vazia.' } : { tipo: a.tipo, resultado: c }
      }
      case 'area.escrever':
        return { tipo: a.tipo, resultado: writeClipboard(String(a.texto || a.text || a.conteudo || a.content || '')) }
      case 'sistema.abrir':
        return {
          tipo: a.tipo,
          resultado: runOpen(cfg, String(a.alvo || a.target || a.app || a.aplicativo || a.url || a.programa || ''))
        }
      case 'sistema.volume': {
        const level = Number(a.nivel ?? a.level ?? a.valor ?? a.percentual)
        const action = normVolumeAction(a.acao ?? a.action ?? a.direcao)
        if (action === 'set' && !Number.isFinite(level)) {
          return { tipo: a.tipo, erro: 'Diga o nível (0 a 100) ou se é para aumentar, diminuir ou mutar.' }
        }
        return { tipo: a.tipo, resultado: runVolume(cfg, { action, level }) }
      }
      case 'sistema.bloquear':
        return { tipo: a.tipo, resultado: runLock(cfg) }
      case 'sistema.captura':
        return { tipo: a.tipo, resultado: runScreenshot(cfg) }
      case 'sistema.midia':
        return { tipo: a.tipo, resultado: runMedia(cfg, normMediaAction(a.acao ?? a.action ?? a.comando)) }
      case 'sistema.brilho': {
        const level = Number(a.nivel ?? a.level ?? a.valor ?? a.percentual)
        const action = normBrightnessAction(a.acao ?? a.action ?? a.direcao)
        if (action === 'set' && !Number.isFinite(level)) {
          return { tipo: a.tipo, erro: 'Diga o nível do brilho (0 a 100) ou se é para clarear ou escurecer.' }
        }
        return { tipo: a.tipo, resultado: runBrightness(cfg, { action, level }) }
      }
      case 'desfazer': {
        const r = undoLast(userDataDir())
        return r.ok
          ? { tipo: a.tipo, resultado: { ok: true, desfeito: r.label || 'a última alteração' } }
          : { tipo: a.tipo, erro: 'Não há nada para desfazer.' }
      }
      case 'codigo.workspace':
        return { tipo: a.tipo, resultado: summarizeCodeWorkspace(cfg, String(a.path || a.raiz || a.workspace || '')) }
      case 'codigo.buscar':
        return {
          tipo: a.tipo,
          resultado: searchCode(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            query: String(a.consulta || a.query || a.simbolo || ''),
            filter: a.filtro ? String(a.filtro) : a.glob ? String(a.glob) : undefined,
            maxResults: Number(a.limite || a.max || 0) || undefined
          })
        }
      case 'codigo.ler':
        return {
          tipo: a.tipo,
          resultado: readCodeFile(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            file: String(a.arquivo || a.file || ''),
            startLine: Number(a.inicio || a.start || 0) || undefined,
            lines: Number(a.linhas || a.lines || 0) || undefined
          })
        }
      case 'codigo.comando':
        return {
          tipo: a.tipo,
          resultado: runCodeCommand(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            command: String(a.comando || a.command || '')
          })
        }
      case 'codigo.terminal': {
        const root = String(a.path || a.raiz || a.workspace || '')
        const approved = a.confirmado === true || a.autorizado === true || a.confirm === true || a.approved === true
        const result = runCodeTerminal(cfg, { root, command: String(a.comando || a.command || ''), approved })
        if (result.requiresApproval) {
          setPendingCode(sessionId, { kind: 'terminal', command: result.command, root, reason: result.reason })
        } else if (result.ran) {
          clearPendingCode(sessionId)
        }
        return { tipo: a.tipo, resultado: result }
      }
      case 'codigo.confirmar': {
        const pend = getPendingCode(sessionId)
        if (!pend) return { tipo: a.tipo, erro: 'Não há nenhum comando pendente de autorização.' }
        const result = runCodeTerminal(cfg, { root: pend.root, command: pend.command, approved: true })
        if (result.ran) clearPendingCode(sessionId)
        return { tipo: a.tipo, resultado: result }
      }
      case 'codigo.cancelar': {
        const had = !!getPendingCode(sessionId)
        clearPendingCode(sessionId)
        return { tipo: a.tipo, resultado: { cancelado: had, mensagem: had ? 'comando pendente descartado' : 'nada pendente' } }
      }
      case 'codigo.git':
        return {
          tipo: a.tipo,
          resultado: runCodeGit(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            operation: String(a.operacao || a.operation || 'status'),
            file: a.arquivo || a.file ? String(a.arquivo || a.file) : undefined
          })
        }
      case 'codigo.indexar':
        return {
          tipo: a.tipo,
          resultado: buildCodeIndex(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            refresh: a.refresh === true || a.atualizar === true
          })
        }
      case 'codigo.scaffold':
        return {
          tipo: a.tipo,
          resultado: scaffoldProject(cfg, {
            tipo: String(a.tipo_projeto || a.template || a.modelo || a.kind || 'site'),
            nome: String(a.nome || a.name || a.projeto || ''),
            path: String(a.path || a.raiz || a.destino || a.onde || ''),
            force: a.force === true || a.forcar === true
          })
        }
      case 'codigo.criar':
        return {
          tipo: a.tipo,
          resultado: writeCodeFile(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            file: String(a.arquivo || a.file || ''),
            content: String(a.conteudo ?? a.content ?? a.texto ?? ''),
            overwrite: a.sobrescrever === true || a.overwrite === true
          })
        }
      case 'codigo.diagnostico':
        return { tipo: a.tipo, resultado: diagnoseProject(cfg, { root: String(a.path || a.raiz || a.workspace || '') }) }
      case 'codigo.projeto':
        return {
          tipo: a.tipo,
          resultado: await runCoderTask(cfg, {
            objetivo: String(a.objetivo || a.tarefa || a.descricao || a.texto || ''),
            root: String(a.path || a.raiz || a.destino || a.onde || a.nome || ''),
            passos: Number(a.passos || a.steps || 0) || undefined
          })
        }
      case 'codigo.patch.preview':
        return {
          tipo: a.tipo,
          resultado: previewCodePatch(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            diff: a.diff,
            patches: a.patches
          })
        }
      case 'codigo.patch.aplicar':
        return {
          tipo: a.tipo,
          resultado: applyCodePatch(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            diff: a.diff,
            patches: a.patches
          })
        }
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
    codeContext: codePromptContext(cfg),
    controlContext: controlPromptContext(cfg),
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
    // Ferramentas de consulta rodam em PARALELO (são, em geral, independentes:
    // clima, notícias, web, código). Promise.all preserva a ordem dos resultados.
    const results = await Promise.all(queries.map((q) => runQuery(q, cfg, sessionId)))
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

  return {
    fala,
    board,
    memory: loadMemory(),
    events: loadEvents(),
    lists: loadLists(),
    quickNotes: loadNotes(),
    reminders: loadReminders(),
    notes: allNotes,
    changedBoard
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
