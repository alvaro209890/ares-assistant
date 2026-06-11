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
  runCodeGit,
  summarizeCodeWorkspace
} from '../code'
import { codingPreferencesSummary, getSession, getSessionContext } from '../data'
import {
  evidenceOf,
  parseGitStatusFiles,
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
  if (url) {
    try {
      const page = await readPage(url)
      sections.push({
        title: `Conteúdo da página ${url}`,
        body: JSON.stringify(page),
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
  maxChars = 2800
): string | undefined {
  const session = getSession(sessionId)
  const parts: string[] = []
  const ctx = String(actionContext || '').trim()
  if (ctx) parts.push(`Contexto direto do turno:\n${ctx.slice(0, 900)}`)

  const prefs = codingPreferencesSummary().trim()
  if (prefs) parts.push(`Preferências de código do usuário:\n${prefs.slice(0, 500)}`)

  const op = getSessionContext()
  const opLines: string[] = []
  if (op.lastEditedFile) opLines.push(`último arquivo editado: ${op.lastEditedFile}${op.lastEditedRoot ? ` (em ${op.lastEditedRoot})` : ''}`)
  if (op.lastTerminalCommand) opLines.push(`último comando OK: ${op.lastTerminalCommand}`)
  if (opLines.length) parts.push(`Estado operacional recente:\n- ${opLines.join('\n- ')}`)

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
  /(?:\bvou\s+(?:pedir|chamar|acionar|consultar|encaminhar|delegar)|\bpeç[oa]\s+(?:para|à|ao)|\bdeixe?\s+(?:com|que)\s+(?:a|o)\s+|\bacionar\s+(?:a|o)\s+|\bdelegar\s+(?:para|à|ao)|\bencaminhar\s+(?:para|à|ao)|\bagora\s+com\s+(?:a|o)\s+|\bfica\s+com\s+(?:a|o)\s+|\bhefesto\s+(?:vai|projeta|desenh)|\bt[eê]mis\s+(?:fará|vai|audita)|\batena\s+(?:vai|investiga|pesquisa))/iu

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
  return null
}

/** Instrução para a fala pós-relatório dos especialistas (na rodada seguinte). */
export function hiveFollowupInstruction(results: unknown[], voice: boolean): string {
  const tipos = new Set(results.map((r) => (r as { tipo?: string })?.tipo).filter(Boolean))
  const parts: string[] = []
  if (tipos.has('subagente.pesquisar')) {
    parts.push(
      voice
        ? 'PESQUISA DA ATENA: dê uma resposta mais completa que o normal, mas falável: 3 a 5 frases com o achado principal, datas, fontes principais e qualquer incerteza relevante.'
        : 'PESQUISA DA ATENA: responda de forma completa e organizada, com achado principal, datas/linha do tempo, fontes principais e incertezas. Não invente detalhes fora do relatório.'
    )
  }
  if (tipos.has('subagente.construir')) {
    parts.push(
      voice
        ? 'BRIEFING DO HEFESTO: resuma [ESCOPO] e os [ARQUIVOS] em 2 a 4 frases e diga se aplica passo a passo ou se delega ao coder autônomo.'
        : 'BRIEFING DO HEFESTO: sintetize [ESCOPO], [ARQUIVOS] (ordem) e [VALIDAR]. Decida explicitamente entre dois caminhos: (a) aplicar você mesmo com codigo.editar/criar seguindo o [PASSOS], OU (b) delegar ao coder autônomo via codigo.projeto. Nunca leia o relatório inteiro; destaque próximos passos acionáveis.'
    )
  }
  if (tipos.has('subagente.auditar')) {
    parts.push(
      voice
        ? 'AUDITORIA DA TÊMIS: comece pelo [VEREDITO] APROVADO/REPROVADO e cite só os problemas de gravidade alta/média.'
        : 'AUDITORIA DA TÊMIS: comece pelo [VEREDITO] APROVADO/REPROVADO; depois liste os [PROBLEMAS] com arquivo:linha, gravidade e correção sugerida. Não inclua elogios nem itens cosméticos.'
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
