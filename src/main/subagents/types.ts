import type { SubagentId } from '../../shared/types'

// Perfil de um subagente especialista da Colmeia. Todos usam o MESMO provedor/
// modelo do Ares (ninerouter), variando apenas systemPrompt e temperature.
export interface SubagentProfile {
  id: SubagentId
  label: string // nome em pt-BR mostrado na UI ("Investigador", ...)
  role: string // função em uma frase (vai para o relatório/atividade)
  systemPrompt: string
  temperature: number
}

// Tarefa despachada pelo Ares (Manager) a um subagente (Worker).
export interface SubagentTask {
  goal: string // instrução objetiva do que o subagente deve produzir
  context?: string // resumo do turno atual (o que o Ares já sabe/fez)
  evidence?: string // material bruto coletado pelo Ares (busca web, diagnóstico, workspace)
  memories?: string[] // fatos relevantes recuperados da memória de longo prazo
}

// Relatório técnico devolvido ao Ares. NUNCA vai direto para o TTS:
// só o Ares sintetiza e fala com o usuário.
export interface SubagentResult {
  agentId: SubagentId
  label: string
  ok: boolean
  report: string
  durationMs: number
}
