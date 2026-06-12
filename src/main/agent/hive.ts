// Colmeia: tudo que diz respeito a orquestrar subagentes vive aqui.
//   - Coletores de evidência (Atena/Hefesto/Têmis) — cada um devolve um EvidencePackage tipado.
//   - buildTaskContext: contexto orientado a tarefa entregue ao subagente.
//   - inferPromisedHiveAction: guarda determinística do protocolo.
//   - hiveFollowupInstruction: instrução para a fase pós-relatório.
//   - proactiveCodeFollowup: sugestão proativa após Hefesto / criar / aplicar patch.
//
// Mantido fora de agent.ts para que o orquestrador foque em fluxo de turno e
// para que mudanças na Colmeia não obriguem reler 1900 linhas.

import type { AppConfig } from '../../shared/types'
import { getNews, readPage, webSearch } from '../tools'
import {
  diagnoseProject,
  outlineCodeFile,
  proactiveValidationCommand,
  readCodeContext,
  runCodeGit,
  summarizeCodeWorkspace
} from '../code'
import { codingPreferencesSummary, getSession } from '../data'
import { worklogSummary } from '../worklog'
import {
  evidenceOf,
  parseGitStatusFiles,
  parseReportTags,
  pickRelevantFiles,
  type EvidencePackage,
  type EvidenceSection,
  type SubagentProfile
} from '../subagents'
import type { Acao, ProgressFn } from './types'

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Coletor da Atena: web search, busca de recência e Google News, opcionalmente
 * uma página específica. Cada bloco vira uma seção do EvidencePackage (rotulada,
 * priorizada), em vez de um único texto truncado por chars. Falhas viram `notes`.
 */
export async function gatherResearcherEvidence(a: Acao, goal: string): Promise<EvidencePackage> {
  const notes: string[] = []
  const sections: EvidenceSection[] = []
  const query = String(a.consulta || goal)
  const now = new Date()
  sections.push({
    title: 'Metadados da pesquisa',
    body: `Data: ${now.toLocaleString('pt-BR')} (ISO ${now.toISOString()}). Priorize fontes/notícias mais recentes e cite datas.`,
    priority: 3,
    minChars: 0
  })
  const [results, recentResults, news] = await Promise.all([
    webSearch(query, 6).catch((e) => { notes.push(`web.buscar falhou: ${msg(e)}`); return [] }),
    webSearch(`${query} notícias recentes lançamento atualização ${now.getFullYear()}`, 6).catch(() => []),
    getNews(query, 8).catch((e) => { notes.push(`noticias falhou: ${msg(e)}`); return [] })
  ])
  if (results.length) {
    sections.push({
      title: 'Resultados de busca',
      body: results.map((r) => `- ${r.title} (${r.url}): ${r.snippet}`).join('\n'),
      priority: 1,
      minChars: 600
    })
  }
  if (recentResults.length) {
    sections.push({
      title: 'Resultados focados em recência',
      body: recentResults.map((r) => `- ${r.title} (${r.url}): ${r.snippet}`).join('\n'),
      priority: 2,
      minChars: 400
    })
  }
  if (news.length) {
    sections.push({
      title: 'Notícias recentes (Google News RSS)',
      body: news
        .map((n) => `- ${n.title}${n.source ? ` — ${n.source}` : ''}${n.published ? ` — ${n.published}` : ''}${n.link ? ` (${n.link})` : ''}`)
        .join('\n'),
      priority: 1,
      minChars: 400
    })
  }
  const url = String(a.url || a.endereco || '').trim()

  // Busca proativa: lê as top-2 páginas dos resultados principais em paralelo,
  // sem bloquear — se uma falhar ou demorar >7s, é descartada silenciosamente.
  // Só faz isso quando não há URL explícita (para não duplicar a leitura abaixo).
  if (!url && results.length) {
    const topUrls = results
      .slice(0, 3)
      .map((r) => (r as { url?: string }).url)
      .filter((u): u is string => !!u && u.startsWith('http'))
      .slice(0, 2)
    if (topUrls.length) {
      const timeout = (ms: number): Promise<never> =>
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
      const fetched = await Promise.allSettled(
        topUrls.map((pu) => Promise.race([readPage(pu), timeout(7000)]))
      )
      for (let i = 0; i < topUrls.length; i++) {
        const r = fetched[i]
        if (r.status !== 'fulfilled' || !r.value) continue
        const p = r.value as { title?: string; text?: string; content?: string } | string
        const body = typeof p === 'string'
          ? p
          : [p.title, p.text || p.content].filter(Boolean).join('\n\n')
        if (body.trim().length > 100) {
          sections.push({
            title: `Conteúdo completo: ${topUrls[i]}`,
            body: body.slice(0, 5000),
            priority: 1,
            minChars: 2000
          })
        }
      }
    }
  }

  if (url) {
    try {
      const page = await readPage(url)
      const p = page as { title?: string; text?: string; content?: string } | string
      const body = typeof p === 'string'
        ? p
        : [p.title, p.text || p.content].filter(Boolean).join('\n\n')
      sections.push({
        title: `Conteúdo da página ${url}`,
        body: body || JSON.stringify(page),
        priority: 1,
        minChars: 1000
      })
    } catch (e) {
      notes.push(`pagina.ler falhou: ${msg(e)}`)
    }
  }
  return evidenceOf(sections, notes)
}

/**
 * Coletor do Hefesto: workspace + git state + ARQUIVOS RELEVANTES com outline.
 * A relevância vem de tokens do objetivo (pickRelevantFiles); para cada um a
 * gente injeta o outline (declarações + linhas), que é compacto e mais útil
 * para projetar a mudança do que listar todos os arquivos. Falhas individuais
 * (arquivo binário, outline indisponível) não interrompem a coleta.
 */
export async function gatherEngineerEvidence(
  cfg: AppConfig,
  root: string,
  goal: string,
  signal?: AbortSignal,
  progress?: ProgressFn
): Promise<EvidencePackage> {
  const notes: string[] = []
  const sections: EvidenceSection[] = []
  const ws = summarizeCodeWorkspace(cfg, root)
  const [status, diffStat] = await Promise.all([
    runCodeGit(cfg, { root, operation: 'status', signal, onProgress: progress }).catch(() => null),
    runCodeGit(cfg, { root, operation: 'diffStat', signal, onProgress: progress }).catch(() => null)
  ])

  sections.push({
    title: `Workspace ${ws.name}`,
    body: [
      `caminho: ${ws.root}`,
      `linguagens: ${Object.entries(ws.languages).map(([k, n]) => `${k}=${n}`).join(', ') || 'n/a'}`,
      `package manager: ${ws.packageManager || 'n/a'}`,
      `scripts: ${ws.scripts ? Object.keys(ws.scripts).join(', ') : 'n/a'}`,
      `health: ${ws.health?.label || 'n/a'}`,
      ws.hints.length ? `hints: ${ws.hints.join('; ')}` : ''
    ].filter(Boolean).join('\n'),
    priority: 1,
    minChars: 400
  })

  const statusOut = status?.stdout?.trim() || ''
  const diffStatOut = diffStat?.stdout?.trim() || ''
  if (statusOut || diffStatOut) {
    sections.push({
      title: 'Estado Git',
      body: [
        statusOut ? `status:\n${statusOut}` : '',
        diffStatOut ? `diff --stat:\n${diffStatOut}` : ''
      ].filter(Boolean).join('\n\n'),
      priority: 2,
      minChars: 300
    })
  }

  const changedFiles = parseGitStatusFiles(statusOut)
  const relevant = Array.from(
    new Set([
      ...changedFiles.filter((f) => ws.files.includes(f)).slice(0, 6),
      ...pickRelevantFiles(ws.files, goal, 8)
    ])
  ).slice(0, 10)

  const outlines: string[] = []
  for (const file of relevant) {
    if (signal?.aborted) break
    try {
      const ol = outlineCodeFile(cfg, { root, file })
      if (!ol.items.length) continue
      const items = ol.items.slice(0, 18).map((i) => `${i.kind} ${i.name} @ L${i.line}`).join('\n')
      outlines.push(`### ${file} (${ol.totalLines} linhas)\n${items}`)
    } catch {
      /* arquivo binário/inacessível: pula sem ruído */
    }
  }
  if (outlines.length) {
    sections.push({
      title: `Arquivos relevantes ao objetivo (outlines)`,
      body: outlines.join('\n\n'),
      priority: 1,
      minChars: 1000
    })
  } else if (ws.files.length) {
    notes.push('nenhum arquivo bateu com o objetivo: enviando lista geral')
  }

  sections.push({
    title: 'Árvore de arquivos do projeto',
    body: ws.files.slice(0, 250).join('\n'),
    priority: 3,
    minChars: 0
  })
  return evidenceOf(sections, notes)
}

/**
 * Coletor da Têmis: diagnóstico real + DIFF POR ARQUIVO (top-N alterados, com
 * outline de cada um). Substituí o `diff.slice(0, 12000)` por orçamento por
 * arquivo: cada um vai como bloco próprio, então a auditoria nunca recebe um
 * hunk truncado no meio.
 */
export async function gatherAuditorEvidence(
  cfg: AppConfig,
  root: string,
  signal?: AbortSignal,
  progress?: ProgressFn
): Promise<EvidencePackage> {
  const notes: string[] = []
  const sections: EvidenceSection[] = []
  const [diag, status] = await Promise.all([
    diagnoseProject(cfg, { root, signal, onProgress: progress }).catch((e) => { notes.push(`diagnóstico falhou: ${msg(e)}`); return null }),
    runCodeGit(cfg, { root, operation: 'status', signal, onProgress: progress }).catch(() => null)
  ])

  if (diag) {
    const checks = diag.checks
      .map((c) => `- ${c.name} (${c.command}): ${c.ran ? c.summary : 'não rodou'}`)
      .join('\n')
    sections.push({
      title: `Diagnóstico de ${diag.name} — ${diag.health.label}`,
      body: [checks, diag.hints.join('\n')].filter(Boolean).join('\n'),
      priority: 1,
      minChars: 500
    })
  }

  const statusOut = status?.stdout?.trim() || ''
  if (statusOut) {
    sections.push({
      title: 'git status --short',
      body: statusOut,
      priority: 1,
      minChars: 200
    })
  }

  const changed = parseGitStatusFiles(statusOut).slice(0, 8)
  const fileBlocks: string[] = []
  for (const f of changed) {
    if (signal?.aborted) break
    const diff = await runCodeGit(cfg, { root, operation: 'diff', file: f, signal, onProgress: progress }).catch(() => null)
    const diffOut = (diff?.stdout || '').trim()
    if (!diffOut) continue
    let outline = ''
    try {
      const ol = outlineCodeFile(cfg, { root, file: f })
      outline = ol.items.slice(0, 14).map((i) => `${i.kind} ${i.name} @ L${i.line}`).join('\n')
    } catch {
      /* arquivo novo/binário: sem outline */
    }
    fileBlocks.push(
      `### ${f}\n` +
      (outline ? `outline:\n${outline}\n\n` : '') +
      `diff:\n${diffOut.slice(0, 3500)}`
    )
  }
  if (fileBlocks.length) {
    sections.push({
      title: `Mudanças por arquivo (${fileBlocks.length}/${changed.length || 0})`,
      body: fileBlocks.join('\n\n'),
      priority: 1,
      minChars: 1500
    })
  } else if (changed.length === 0) {
    notes.push('sem arquivos alterados detectáveis via git status — auditoria sem escopo concreto')
  }
  return evidenceOf(sections, notes)
}

/**
 * Coletor do Prometeu: LOGS DE ERRO em primeiro plano (vindos da ação ou do
 * último comando), diagnóstico real do projeto e os arquivos citados no stack
 * trace com outline. O log de erro é a seção de maior prioridade — é a matéria-
 * prima do diagnóstico; o resto é contexto para localizar a causa raiz.
 */
export async function gatherDebuggerEvidence(
  cfg: AppConfig,
  root: string,
  a: Acao,
  goal: string,
  signal?: AbortSignal,
  progress?: ProgressFn
): Promise<EvidencePackage> {
  const notes: string[] = []
  const sections: EvidenceSection[] = []
  const errorLogs = String(a.logs_erro || a.logs || a.erro || a.stderr || '').trim()

  if (errorLogs) {
    sections.push({
      title: 'Saída de erro (logs/stack trace)',
      body: errorLogs,
      priority: 1,
      minChars: 2500
    })
  } else {
    notes.push('nenhum log de erro recebido na ação: diagnóstico parte só do estado do projeto')
  }

  const [diag, status] = await Promise.all([
    diagnoseProject(cfg, { root, signal, onProgress: progress }).catch((e) => { notes.push(`diagnóstico falhou: ${msg(e)}`); return null }),
    runCodeGit(cfg, { root, operation: 'status', signal, onProgress: progress }).catch(() => null)
  ])
  if (diag) {
    const checks = diag.checks
      .map((c) => `- ${c.name} (${c.command}): ${c.ran ? c.summary : 'não rodou'}`)
      .join('\n')
    sections.push({
      title: `Diagnóstico de ${diag.name} — ${diag.health.label}`,
      body: [checks, diag.hints.join('\n')].filter(Boolean).join('\n'),
      priority: 1,
      minChars: 500
    })
  }
  const statusOut = status?.stdout?.trim() || ''
  if (statusOut) {
    sections.push({ title: 'git status --short', body: statusOut, priority: 2, minChars: 200 })
  }

  // Usa extractErrorLocations para obter arquivo + linha exata de cada ponto
  // do stack trace. Para cada localização lê ±30 linhas de contexto real em vez
  // de apenas o outline — o Prometeu vê o código no ponto exato do erro.
  const ws = summarizeCodeWorkspace(cfg, root)
  const locations = extractErrorLocations(errorLogs, ws.files)
  const codeContexts: string[] = []
  const filesWithContext = new Set<string>()
  for (const { file, line } of locations.slice(0, 4)) {
    if (signal?.aborted) break
    try {
      const ctx = readCodeContext(cfg, root, file, line, 30)
      codeContexts.push(`### ${file} (em torno da linha ${line})\n${ctx}`)
      filesWithContext.add(file)
    } catch {
      /* arquivo inacessível: cai no outline abaixo */
    }
  }
  if (codeContexts.length) {
    sections.push({
      title: 'Contexto de código nos pontos de erro',
      body: codeContexts.join('\n\n'),
      priority: 1,
      minChars: 1500
    })
  }

  // Para arquivos citados no log mas sem linha (ou que falharam no contexto),
  // ainda fornece o outline como fallback.
  const fromLogs = extractFilesFromErrorLogs(errorLogs, ws.files)
  const remaining = Array.from(
    new Set([
      ...fromLogs.filter((f) => !filesWithContext.has(f)),
      ...pickRelevantFiles(ws.files, `${goal} ${errorLogs.slice(0, 400)}`, 5)
    ])
  ).slice(0, 6)
  const outlines: string[] = []
  for (const file of remaining) {
    if (signal?.aborted) break
    try {
      const ol = outlineCodeFile(cfg, { root, file })
      if (!ol.items.length) continue
      const items = ol.items.slice(0, 18).map((i) => `${i.kind} ${i.name} @ L${i.line}`).join('\n')
      outlines.push(`### ${file} (${ol.totalLines} linhas)\n${items}`)
    } catch {
      /* arquivo binário/inacessível: pula sem ruído */
    }
  }
  if (outlines.length) {
    sections.push({
      title: 'Arquivos suspeitos (outlines)',
      body: outlines.join('\n\n'),
      priority: 2,
      minChars: 600
    })
  }
  return evidenceOf(sections, notes)
}

/**
 * Extrai localizações arquivo:linha de logs de erro/stack trace, confirmando
 * cada caminho contra a lista real do workspace. Preferida ao invés de
 * extractFilesFromErrorLogs quando o número de linha é essencial (Prometeu).
 * Pura e testável.
 */
export function extractErrorLocations(
  logs: string,
  projectFiles: string[]
): Array<{ file: string; line: number }> {
  if (!logs || !projectFiles.length) return []
  const found: Array<{ file: string; line: number }> = []
  const normalized = new Map(projectFiles.map((f) => [f.toLowerCase(), f]))
  // Casa "path/file.ts:456", "path/file.ts:456:7", "at file.ts (linha 456"
  const re = /([\w./\\-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|rb))(?::(\d+)|\s+\((\d+))/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(logs)) && found.length < 6) {
    const lineNum = parseInt(m[2] || m[3] || '0', 10)
    if (!lineNum) continue
    const raw = m[1].replace(/\\+/g, '/').replace(/^\.\//, '')
    const parts = raw.toLowerCase().split('/')
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/')
      const hit =
        normalized.get(suffix) ||
        projectFiles.find((f) => f.toLowerCase().endsWith(`/${suffix}`) || f.toLowerCase() === suffix)
      if (hit && !found.some((x) => x.file === hit)) {
        found.push({ file: hit, line: lineNum })
        break
      }
    }
  }
  return found
}

/**
 * Extrai caminhos de arquivos do projeto citados num log de erro/stack trace.
 * Casa tanto caminhos com / quanto com \ (Windows) e confere contra a lista
 * real de arquivos do workspace. Pura e testável.
 */
export function extractFilesFromErrorLogs(logs: string, projectFiles: string[]): string[] {
  if (!logs || !projectFiles.length) return []
  const found: string[] = []
  const normalized = new Map(projectFiles.map((f) => [f.toLowerCase(), f]))
  const re = /([\w./\\-]+\.(?:tsx?|jsx?|mjs|cjs|json|py|go|rs|java|rb|css|html|vue))(?=[\s:),'"]|$)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(logs)) && found.length < 6) {
    const raw = m[1].replace(/\\+/g, '/').replace(/^\.\//, '')
    // Tenta casar pelo caminho completo e por sufixos progressivamente menores.
    const parts = raw.toLowerCase().split('/')
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/')
      const hit = normalized.get(suffix) || projectFiles.find((f) => f.toLowerCase().endsWith(`/${suffix}`) || f.toLowerCase() === suffix)
      if (hit) {
        if (!found.includes(hit)) found.push(hit)
        break
      }
    }
  }
  return found
}

/**
 * Despachante: roteia para o coletor certo conforme o perfil. Falhas viram
 * `notes` no pacote — nunca derrubam o turno. Quando o módulo de programação
 * está desativado, devolve um pacote sinalizando a indisponibilidade no notes.
 */
export async function gatherSubagentEvidence(
  profile: SubagentProfile,
  a: Acao,
  cfg: AppConfig,
  goal: string,
  signal?: AbortSignal,
  progress?: ProgressFn
): Promise<EvidencePackage | undefined> {
  const root = String(a.path || a.raiz || a.workspace || '')
  try {
    if (profile.id === 'researcher') return await gatherResearcherEvidence(a, goal)
    if (!cfg.integrations.code.enabled) {
      return { sections: [], notes: ['ferramentas de programação desativadas: sem material de código'] }
    }
    if (profile.id === 'engineer') return await gatherEngineerEvidence(cfg, root, goal, signal, progress)
    if (profile.id === 'debugger') return await gatherDebuggerEvidence(cfg, root, a, goal, signal, progress)
    return await gatherAuditorEvidence(cfg, root, signal, progress)
  } catch (e) {
    return { sections: [], notes: [`falha ao coletar material: ${msg(e)}`] }
  }
}

/**
 * Contexto orientado a tarefa para os subagentes (em vez de "últimas N mensagens
 * truncadas"). Empacota o que de fato vai ajudar o especialista a decidir.
 */
export function buildTaskContext(
  sessionId: string,
  actionContext?: string,
  workspaceRoot?: string,
  maxChars = 2800
): string | undefined {
  const session = getSession(sessionId)
  const parts: string[] = []
  const ctx = String(actionContext || '').trim()
  if (ctx) parts.push(`Contexto direto do turno:\n${ctx.slice(0, 900)}`)

  const prefs = codingPreferencesSummary().trim()
  if (prefs) parts.push(`Preferências de código do usuário:\n${prefs.slice(0, 500)}`)

  if (workspaceRoot) {
    const wlog = worklogSummary(workspaceRoot, 600)
    if (wlog) parts.push(`Trabalho em andamento no projeto:\n${wlog}`)
  }

  if (session?.summary?.trim()) parts.push(`Resumo da conversa:\n${session.summary.trim().slice(0, 600)}`)

  const recent = (session?.messages || [])
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'Usuário' : 'Ares'}: ${m.content.replace(/\s+/g, ' ').trim().slice(0, 260)}`)
    .filter((line) => line.length > 12)
  if (recent.length) parts.push(`Últimas mensagens relevantes:\n${recent.join('\n')}`)

  const out = parts.join('\n\n').trim()
  return out ? out.slice(0, maxChars) : undefined
}

/** Compat: nome antigo, mesma assinatura. */
export const compactSubagentContext = buildTaskContext

// Verbos de DELEGAÇÃO (separados dos verbos de DOMÍNIO) — só consideramos que o
// Ares prometeu chamar a Colmeia quando ele sinaliza encaminhamento explícito.
const DELEGATION_RE =
  /(?:\bvou\s+(?:pedir|chamar|acionar|consultar|encaminhar|delegar|passar)|\bpeç[oa]\s+(?:para|à|ao)|\bdeixe?\s+(?:com|que)\s+(?:a|o)\s+|\bacionar\s+(?:a|o)\s+|\bdelegar\s+(?:para|à|ao)|\bencaminhar\s+(?:para|à|ao)|\bagora\s+com\s+(?:a|o)\s+|\bfica\s+com\s+(?:a|o)\s+|\bhefesto\s+(?:vai|projeta|desenh)|\bt[eê]mis\s+(?:fará|vai|audita)|\batena\s+(?:vai|investiga|pesquisa)|\bprometeu\s+(?:vai|depura|investiga|analisa))/iu

/**
 * Guarda determinística para a Colmeia: se o modelo PROMETE chamar um
 * especialista mas esquece de emitir a ação JSON, o runtime cumpre a promessa.
 * Conservador por design: exige (a) verbo de delegação claro + (b) nome do
 * especialista + (c) verbo de DOMÍNIO compatível com aquele especialista.
 */
export function inferPromisedHiveAction(fala: string, userText: string, acoes: Acao[]): Acao | null {
  if (acoes.some((a) => String(a.tipo || '').startsWith('subagente.'))) return null
  const combined = `${fala}\n${userText}`
  if (!DELEGATION_RE.test(combined)) return null
  const goal = userText.trim() || fala.trim()
  if (goal.length < 6) return null
  const contexto = 'Ação inferida pelo runtime: o Ares prometeu acionar a Colmeia, mas o modelo não emitiu a ação JSON.'
  const has = (re: RegExp): boolean => re.test(combined)

  if (has(/\batena\b/iu) && has(/(pesquis|investig|fonte|web|documenta|consulta|not[ií]cia|lan[çc]ament|estado\s+da\s+arte)/iu)) {
    return { tipo: 'subagente.pesquisar', objetivo: goal, consulta: goal, contexto }
  }
  if (has(/\bhefesto\b/iu) && has(/(constru|implement|projet|arquitet|desenh|plano|blueprint|briefing|estrutur)/iu)) {
    return { tipo: 'subagente.construir', objetivo: goal, contexto }
  }
  if (has(/\bt[eê]mis\b/iu) && has(/(audit|revis|valid|qualid|verificar|diagn[oó]stic|parecer|veredito|inspe[cç])/iu)) {
    return { tipo: 'subagente.auditar', objetivo: goal, contexto }
  }
  if (has(/\bprometeu\b/iu) && has(/(depur|debug|erro|falha|exce[cç][aã]o|stack|trace|quebr|crash|bug|analis)/iu)) {
    return { tipo: 'subagente.depurar', objetivo: goal, contexto }
  }
  return null
}

/**
 * Instrução para a fala pós-relatório dos especialistas (na rodada seguinte).
 * Extrai validateCmd de cada relatório para incluir o comando exato no texto
 * em vez do genérico "use o [VALIDAR]".
 */
export function hiveFollowupInstruction(results: unknown[], voice: boolean): string {
  const tipos = new Set(results.map((r) => (r as { tipo?: string })?.tipo).filter(Boolean))

  // Parseia validateCmd e scope de cada relatório recebido.
  const cmds = new Map<string, string>()
  const scopes = new Map<string, string>()
  for (const r of results) {
    const o = r as { tipo?: string; resultado?: { relatorio?: string } }
    if (!o.tipo || !o.resultado?.relatorio) continue
    const tags = parseReportTags(o.resultado.relatorio)
    if (tags.validateCmd) cmds.set(o.tipo, tags.validateCmd)
    if (tags.scope) scopes.set(o.tipo, tags.scope)
  }

  const parts: string[] = []
  if (tipos.has('subagente.pesquisar')) {
    parts.push(
      voice
        ? 'PESQUISA DA ATENA: dê uma resposta mais completa que o normal, mas falável: 3 a 5 frases com o achado principal, datas, fontes principais e qualquer incerteza relevante.'
        : 'PESQUISA DA ATENA: responda de forma completa e organizada, com achado principal, datas/linha do tempo, fontes principais e incertezas. Não invente detalhes fora do relatório.'
    )
  }
  if (tipos.has('subagente.construir')) {
    const validate = cmds.get('subagente.construir')
    const scope = scopes.get('subagente.construir')
    parts.push(
      voice
        ? `BRIEFING DO HEFESTO: resuma ${scope ? `"${scope.slice(0, 80)}"` : '[ESCOPO]'} em 1-2 frases e diga se aplica passo a passo ou se delega ao coder autônomo.`
        : `BRIEFING DO HEFESTO: sintetize [ESCOPO], [ARQUIVOS] (ordem) e [TRECHOS] antes/depois. Decida entre: (a) aplicar você mesmo com codigo.editar/criar seguindo [PASSOS], OU (b) delegar ao coder autônomo via codigo.projeto se o [ESCOPO] recomendar. Após aplicar, valide com: ${validate ? `\`${validate}\`` : 'o comando do [VALIDAR]'}. Não leia o relatório inteiro — cite próximos passos.`
    )
  }
  if (tipos.has('subagente.auditar')) {
    const validate = cmds.get('subagente.auditar')
    parts.push(
      voice
        ? 'AUDITORIA DA TÊMIS: comece pelo [VEREDITO] APROVADO/REPROVADO e cite só os problemas de gravidade alta/média.'
        : `AUDITORIA DA TÊMIS: comece pelo [VEREDITO] APROVADO/REPROVADO; depois liste os [PROBLEMAS] com arquivo:linha, gravidade e correção sugerida. Se REPROVADO, aplique as correções e valide com: ${validate ? `\`${validate}\`` : 'o comando do [VALIDAR]'}. Omita elogios e cosméticos.`
    )
  }
  if (tipos.has('subagente.depurar')) {
    const validate = cmds.get('subagente.depurar')
    parts.push(
      voice
        ? `DIAGNÓSTICO DO PROMETEU: diga a [CAUSA RAIZ] em 1 frase curta falável, APLIQUE imediatamente a [CORRECAO] com codigo.editar (uma ou mais chamadas) e rode o comando de [VALIDAR] na mesma rodada para testar. Nunca pergunte permissão ou leia o stack trace.`
        : `DIAGNÓSTICO DO PROMETEU: APLIQUE imediatamente todas as correções descritas no [CORRECAO] usando a ferramenta codigo.editar e rode o comando de validação: ${validate ? `\`${validate}\`` : 'o comando do [VALIDAR]'} na mesma rodada para testar. Nunca pergunte permissão ao usuário, não apresente trechos de ANTES/DEPOIS e não descreva os passos antes de executá-los. Apenas aplique e valide de forma autônoma.`
    )
  }
  return parts.length ? `\n${parts.join('\n')}` : ''
}

/**
 * Após um briefing/criação de arquivo/patch bem-sucedido, monta uma sugestão
 * proativa de próximo passo. Retorna a instrução para o LLM oferecer isso na fala
 * e uma nota curta para o toast. Null se não se aplicar.
 */
export function proactiveCodeFollowup(
  cfg: AppConfig,
  results: unknown[]
): { instruction: string; note: string } | null {
  // Briefing do Hefesto: oferecer aplicar passo-a-passo OU delegar ao coder autônomo.
  const built = results.find((r) => {
    const o = r as { tipo?: string; resultado?: { ok?: boolean } }
    return o?.tipo === 'subagente.construir' && o.resultado?.ok === true
  })
  if (built) {
    return {
      instruction:
        'PROATIVIDADE DA COLMEIA: Hefesto entregou o BRIEFING. Resuma o [ESCOPO] e os [ARQUIVOS] em 1-2 frases. ' +
        'Se o briefing for pequeno/cirúrgico, OFEREÇA aplicar passo a passo com codigo.editar/codigo.criar seguindo a ordem do [PASSOS]. ' +
        'Se o briefing marcar "delegar ao coder autônomo" no [ESCOPO] OU for claramente multiarquivo, OFEREÇA chamar codigo.projeto com o objetivo enriquecido pelo briefing. ' +
        'Após qualquer escrita real, sugira a Têmis (subagente.auditar) para revisar o diff.',
      note: 'briefing do Hefesto pronto: aplicar passo a passo ou delegar ao coder autônomo'
    }
  }
  const ok = results.find((r) => {
    const o = r as { tipo?: string; resultado?: { applied?: boolean; created?: unknown[] } }
    if (o?.tipo === 'codigo.patch.aplicar') return o.resultado?.applied === true
    if (o?.tipo === 'codigo.criar') return true
    if (o?.tipo === 'codigo.scaffold') return Array.isArray(o.resultado?.created) && o.resultado!.created!.length > 0
    return false
  }) as { resultado?: { root?: string } } | undefined
  if (!ok) return null
  try {
    const summary = summarizeCodeWorkspace(cfg, ok.resultado?.root || '')
    const command = proactiveValidationCommand(summary.scripts, summary.packageManager || 'npm')
    if (!command) return null
    return {
      instruction: `PROATIVIDADE: a alteração foi aplicada. Ofereça rodar "${command}" para validar (uma frase curta) e, se o usuário aceitar, use codigo.comando/codigo.terminal.`,
      note: `sugestão: validar com ${command}`
    }
  } catch {
    return null
  }
}
