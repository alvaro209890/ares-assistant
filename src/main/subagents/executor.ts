import type { AppConfig, ChatMessage, HiveWorkerStatus, MemoryFact } from '../../shared/types'
import { chatJSON } from '../ninerouter'
import { tokenSimilarity } from '../memory'
import type {
  EvidencePackage,
  SubagentProfile,
  SubagentReportTags,
  SubagentResult,
  SubagentTask
} from './types'
import { renderEvidencePackage } from './evidence'

export type HiveStatusFn = (status: HiveWorkerStatus) => void

// Relatórios são para o Ares sintetizar, não para exibição bruta: um teto evita
// estourar o contexto da rodada seguinte. EVIDENCE_BUDGET controla o tamanho do
// material COLETADO (entrada) — separado do tamanho do relatório (saída).
const REPORT_MAX_CHARS = 6000
const EVIDENCE_BUDGET = 18000

/**
 * Recupera os fatos da memória de longo prazo mais parecidos com o objetivo
 * (similaridade de tokens Jaccard, sem dependência nativa de embeddings).
 * Pura e testável.
 */
export function relevantMemories(goal: string, facts: MemoryFact[], max = 5, minScore = 0.08): string[] {
  if (!goal.trim() || !facts.length) return []
  return facts
    .filter((f) => f.status === 'active')
    .map((f) => ({ text: f.text, score: tokenSimilarity(goal, f.text) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.text)
}

/**
 * Renderiza o campo `evidence` da tarefa para texto: aceita EvidencePackage
 * (caminho novo, com orçamento por seção) ou string crua (compat com chamadores
 * antigos e testes). Sem alocação extra quando o material já vier pronto.
 */
function renderEvidenceField(ev: SubagentTask['evidence']): string {
  if (!ev) return ''
  if (typeof ev === 'string') return ev.trim()
  return renderEvidencePackage(ev, EVIDENCE_BUDGET).trim()
}

/** Monta a mensagem de tarefa enviada ao subagente. Pura e testável. */
export function buildTaskPrompt(task: SubagentTask): string {
  const parts = [`OBJETIVO:\n${task.goal.trim()}`]
  if (task.context?.trim()) parts.push(`CONTEXTO DO ARES (o que já se sabe/fez neste turno):\n${task.context.trim()}`)
  const evText = renderEvidenceField(task.evidence)
  if (evText) parts.push(`MATERIAL COLETADO (use como fonte primária):\n${evText}`)
  if (task.memories?.length) parts.push(`MEMÓRIA DE LONGO PRAZO (fatos sobre o usuário/projetos):\n- ${task.memories.join('\n- ')}`)
  parts.push('Produza seu relatório técnico agora, seguindo os blocos rotulados do seu papel.')
  return parts.join('\n\n')
}

/**
 * Executa uma tarefa em um subagente: mesma conexão/modelo do Ares (ninerouter),
 * mudando apenas systemPrompt e temperature do perfil. Emite status para a UI da
 * Colmeia antes/depois. Nunca lança: erro vira relatório com ok:false.
 */
export async function executeSubagentTask(
  profile: SubagentProfile,
  task: SubagentTask,
  cfg: AppConfig,
  onStatus?: HiveStatusFn,
  signal?: AbortSignal
): Promise<SubagentResult> {
  const started = Date.now()
  const emit = (phase: HiveWorkerStatus['phase'], detail?: string): void =>
    onStatus?.({ id: profile.id, label: profile.label, phase, detail, updatedAt: Date.now() })

  emit('thinking', `Analisando: ${task.goal.slice(0, 100)}`)
  const messages: ChatMessage[] = [
    { role: 'system', content: profile.systemPrompt },
    { role: 'user', content: buildTaskPrompt(task) }
  ]
  try {
    const raw = await chatJSON(cfg, messages, false, { temperature: profile.temperature, signal })
    const report = raw.trim().slice(0, REPORT_MAX_CHARS)
    if (!report) {
      emit('error', 'relatório vazio')
      return { agentId: profile.id, label: profile.label, ok: false, report: 'O subagente devolveu um relatório vazio.', durationMs: Date.now() - started }
    }
    emit('done', summarizeReport(report))
    return { agentId: profile.id, label: profile.label, ok: true, report, durationMs: Date.now() - started }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    emit('error', msg.slice(0, 120))
    return { agentId: profile.id, label: profile.label, ok: false, report: `Falha do subagente: ${msg}`, durationMs: Date.now() - started }
  }
}

/** Primeira frase do relatório, curta, para o badge de status da UI. Pura. */
export function summarizeReport(report: string): string {
  const firstLine = report.split('\n').find((l) => l.trim()) ?? ''
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine
  return sentence.trim().slice(0, 120)
}

/**
 * Extração best-effort de tags do relatório (template sugerido nos prompts).
 * Devolve o que conseguir achar; ausências são `undefined`. Pura e testável.
 * Usada pelo Ares para decidir follow-ups (ex.: se Têmis reprovou, oferecer
 * rerodar checagens) sem o LLM precisar adivinhar a estrutura.
 */
export function parseReportTags(report: string): SubagentReportTags {
  const tags: SubagentReportTags = {}
  const text = String(report || '')
  const verdictMatch = text.match(/\[?\s*VEREDITO\s*\]?\s*[:\-]?\s*(APROVADO|REPROVADO)/i)
  if (verdictMatch) tags.verdict = verdictMatch[1].toUpperCase() as 'APROVADO' | 'REPROVADO'

  const filesBlock = text.match(/\[\s*ARQUIVOS\s*\]\s*\n([\s\S]*?)(?=\n\s*\[|$)/i)
  if (filesBlock) {
    const files = filesBlock[1]
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
      .map((l) => l.split(/[\s(:]/)[0])
      .filter((f) => f && /[./\\]/.test(f))
    if (files.length) tags.files = Array.from(new Set(files)).slice(0, 30)
  }

  const risksBlock = text.match(/\[\s*RISCOS\s*\]\s*\n([\s\S]*?)(?=\n\s*\[|$)/i)
  if (risksBlock) {
    const risks = risksBlock[1]
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*\s]+/, '').trim())
      .filter((l) => l.length > 4)
    if (risks.length) tags.risks = risks.slice(0, 15)
  }
  return tags
}
