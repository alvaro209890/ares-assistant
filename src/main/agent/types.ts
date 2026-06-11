// Tipos compartilhados pelos módulos do agente. Mantém os módulos `agent/*`
// desacoplados de detalhes de electron/data/etc., e dá nomes claros a contratos
// que antes circulavam como `unknown`.

import type { AgentActivityEvent, Acao, HiveWorkerStatus } from '../../shared/types'

// Canal do delta: 'both' (exibe no chat E fala — padrão), 'display' (só texto na tela,
// não fala — usado para streamar a resposta COMPLETA de código) ou 'speak' (só fala,
// não altera a tela — usado para o resumo falável conciso de tarefas de programação).
export type DeltaKind = 'both' | 'display' | 'speak'

export type DeltaFn = (chunk: string, phase: number, kind?: DeltaKind) => void
export type ActivityFn = (activity: AgentActivityEvent) => void
export type ProgressFn = (event: { stream: 'stdout' | 'stderr'; chunk: string }) => void
export type DeltaTextTransform = (text: string, phase: number, kind: DeltaKind) => string

// Envelope padrão devolvido por toda ferramenta de consulta/mutação.
// Discriminado por presença de `erro`: facilita o consumo no router/follow-up
// sem repetir `as { resultado?: ... ; erro?: string }` em cada ponto.
export type ToolOk<T = unknown> = { tipo: string; resultado: T; erro?: undefined }
export type ToolErr = { tipo: string; resultado?: undefined; erro: string }
export type ToolResult<T = unknown> = ToolOk<T> | ToolErr

export const toolOk = <T,>(tipo: string, resultado: T): ToolOk<T> => ({ tipo, resultado })
export const toolErr = (tipo: string, erro: string): ToolErr => ({ tipo, erro })

export function isToolErr(r: ToolResult): r is ToolErr {
  return typeof (r as ToolErr).erro === 'string'
}

// Re-export para os módulos do agente não precisarem subir até shared só por isso.
export type { Acao, HiveWorkerStatus }
