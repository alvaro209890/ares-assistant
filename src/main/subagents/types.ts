import type { SubagentId } from '../../shared/types'

// Perfil de um subagente especialista da Colmeia. Todos usam o MESMO provedor/
// modelo do Ares (ninerouter), variando systemPrompt + temperature + pacote de
// evidência montado especificamente para o tipo de tarefa.
export interface SubagentProfile {
  id: SubagentId
  label: string // nome em pt-BR mostrado na UI ("Atena", ...)
  role: string // função em uma frase (vai para o relatório/atividade)
  systemPrompt: string
  temperature: number
}

// Uma seção rotulada de um EvidencePackage. Cada agente recebe seu material em
// blocos com prioridade e mínimo desejado de caracteres — em vez de um corte
// único por tamanho bruto, o renderer aloca orçamento por seção em ordem de
// prioridade (1 = essencial, 2 = útil, 3 = opcional).
export interface EvidenceSection {
  title: string
  body: string
  priority?: number // default 2
  minChars?: number // default 600
}

// Pacote de evidência tipado entregue ao subagente. Notes guarda problemas
// na coleta (offline, timeout, sem diff…) sem misturar com o material útil.
export interface EvidencePackage {
  sections: EvidenceSection[]
  notes?: string[]
}

// Tarefa despachada pelo Ares (Manager) a um subagente (Worker).
// `evidence` aceita tanto EvidencePackage (caminho novo) quanto string (back-
// compat com chamadores antigos e testes que ainda passam texto bruto).
export interface SubagentTask {
  goal: string // instrução objetiva do que o subagente deve produzir
  context?: string // resumo do turno atual (o que o Ares já sabe/fez)
  evidence?: EvidencePackage | string
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

// Tags extraídas best-effort do relatório (template sugerido nos prompts).
// Permite ao Ares responder de forma mais robusta sem depender de regex no LLM
// (ex.: usar `verdict` para decidir se vale rerodar checagens).
export interface SubagentReportTags {
  verdict?: 'APROVADO' | 'REPROVADO' | null
  files?: string[]
  risks?: string[]
}
