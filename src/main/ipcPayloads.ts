import type { DeltaKind } from './agent/types'

export function chatDeltaPayload(
  chunk: string,
  phase: number,
  kind: DeltaKind = 'both',
  done?: boolean
): { chunk: string; phase: number; kind: DeltaKind; done?: boolean } {
  return { chunk, phase, kind, done }
}
