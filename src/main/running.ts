// Registro de execuções canceláveis por sessão. Cada turno registra um AbortController;
// um pedido de cancelamento (Esc na UI -> IPC `code:cancel`) aborta os controllers da
// sessão, o que mata o processo em andamento no spawnAsync (build/install/coder travado)
// sem derrubar nem travar o app. Puro (sem Electron), portanto testável.

import { killAllBackgroundProcesses, killBackgroundProcesses } from './exec'

const bySession = new Map<string, Set<AbortController>>()

/** Registra um controller para a sessão. Retorna a função de baixa (idempotente). */
export function registerRun(sessionId: string, controller: AbortController): () => void {
  let set = bySession.get(sessionId)
  if (!set) {
    set = new Set()
    bySession.set(sessionId, set)
  }
  set.add(controller)
  return () => {
    const s = bySession.get(sessionId)
    if (!s) return
    s.delete(controller)
    if (s.size === 0) bySession.delete(sessionId)
  }
}

/** Aborta tudo que estiver rodando na sessão. Retorna quantos foram abortados. */
export function cancelSession(sessionId: string): number {
  killBackgroundProcesses(sessionId)
  const set = bySession.get(sessionId)
  if (!set) return 0
  let n = 0
  for (const c of set) {
    if (!c.signal.aborted) {
      c.abort()
      n++
    }
  }
  bySession.delete(sessionId)
  return n
}

/** Aborta todas as execuções de todas as sessões (ex.: ao fechar o app). */
export function cancelAll(): number {
  killAllBackgroundProcesses()
  let n = 0
  for (const id of [...bySession.keys()]) n += cancelSession(id)
  return n
}

/** Quantas execuções ativas (para testes/diagnóstico). */
export function activeRunCount(sessionId?: string): number {
  if (sessionId) return bySession.get(sessionId)?.size ?? 0
  let n = 0
  for (const set of bySession.values()) n += set.size
  return n
}

