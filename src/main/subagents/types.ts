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
  reportMaxChars?: number // teto do relatório gerado (default 6000)
  // Blocos rotulados que o relatório PRECISA ter (ex.: ['VEREDITO']). Se o
  // modelo esquecer algum, o executor faz UMA rodada corretiva antes de aceitar
  // — relatório sem os blocos quebra o parse e degrada a síntese do Ares.
  requiredTags?: string[]
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

// Problema estruturado extraído do bloco [PROBLEMAS] do relatório da Têmis.
export interface SubagentProblem {
  file: string
  line?: number
  severity: string // 'alta' | 'média' | 'baixa' ou string livre
  desc: string
}

// Tags extraídas best-effort do relatório (template sugerido nos prompts).
// Permite ao Ares responder de forma mais robusta sem depender de regex no LLM
// (ex.: usar `verdict` para decidir se vale rerodar checagens, `validateCmd`
// para incluir o comando exato no follow-up em vez do genérico "[VALIDAR]").
export interface SubagentReportTags {
  verdict?: 'APROVADO' | 'REPROVADO' | null
  files?: string[]
  risks?: string[]
  rootCause?: string           // [CAUSA RAIZ] primeira linha/parágrafo (Prometeu)
  validateCmd?: string         // [VALIDAR] primeiro comando extraído (todos)
  scope?: string               // [ESCOPO] primeira linha (Hefesto)
  summary?: string             // [RESUMO] primeira(s) frase(s) (Atena/Têmis)
  problems?: SubagentProblem[] // [PROBLEMAS] estruturado (Têmis)
}
