import type { AppConfig, ChatMessage, HiveWorkerStatus, MemoryFact } from '../../shared/types'
import { chatJSON } from '../ninerouter'
import { tokenSimilarity } from '../memory'
import type { SubagentProfile, SubagentResult, SubagentTask } from './types'

export type HiveStatusFn = (status: HiveWorkerStatus) => void

// Relatórios são para o Ares sintetizar, não para exibição bruta: um teto evita
// estourar o contexto da rodada seguinte.
const REPORT_MAX_CHARS = 6000

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

/** Monta a mensagem de tarefa enviada ao subagente. Pura e testável. */
export function buildTaskPrompt(task: SubagentTask): string {
  const parts = [`OBJETIVO:\n${task.goal.trim()}`]
  if (task.context?.trim()) parts.push(`CONTEXTO DO ARES (o que já se sabe/fez neste turno):\n${task.context.trim()}`)
  if (task.evidence?.trim()) parts.push(`MATERIAL COLETADO (use como fonte primária):\n${task.evidence.trim()}`)
  if (task.memories?.length) parts.push(`MEMÓRIA DE LONGO PRAZO (fatos sobre o usuário/projetos):\n- ${task.memories.join('\n- ')}`)
  parts.push('Produza seu relatório técnico agora.')
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
