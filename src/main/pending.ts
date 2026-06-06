// Pendências de autorização do terminal.
//
// Quando o Ares propõe um comando da camada 'confirm', ele guarda aqui o comando
// exato proposto, por sessão, e pede o "sim" ao usuário em voz. No turno seguinte,
// se o usuário autorizar, `codigo.confirmar` executa exatamente o que ficou
// pendente — sem depender do LLM repetir o comando idêntico (evita divergência).
//
// O store é em memória (um pedido de autorização é efêmero e vale só dentro da
// conversa atual). Se o app reiniciar, o usuário simplesmente repete o pedido.

export interface PendingCodeOp {
  kind: 'terminal'
  command: string
  root?: string
  reason: string
  createdAt: number
}

const store = new Map<string, PendingCodeOp>()

// Pendências expiram para não executar algo "autorizado" muito depois do combinado.
const TTL_MS = 10 * 60_000

export function setPendingCode(sessionId: string, op: Omit<PendingCodeOp, 'createdAt'>): PendingCodeOp {
  const full: PendingCodeOp = { ...op, createdAt: Date.now() }
  store.set(sessionId, full)
  return full
}

export function getPendingCode(sessionId: string): PendingCodeOp | undefined {
  const op = store.get(sessionId)
  if (!op) return undefined
  if (Date.now() - op.createdAt > TTL_MS) {
    store.delete(sessionId)
    return undefined
  }
  return op
}

export function clearPendingCode(sessionId: string): boolean {
  return store.delete(sessionId)
}
