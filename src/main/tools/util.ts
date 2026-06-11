// Helpers compartilhados pelas commands para extrair argumentos da `Acao` sem
// repetir `String(a.path || a.raiz || ...)` em 40 lugares. Pure, sem efeitos.

import type { Acao } from '../../shared/types'
import type { BrightnessAction, MediaAction, VolumeAction } from '../control'

export const norm = (s: unknown): string => String(s ?? '').toLowerCase().trim()
export const argRoot = (a: Acao): string => String(a.path || a.raiz || a.workspace || '')
export const argFile = (a: Acao): string => String(a.arquivo || a.file || '')
export const argLimit = (a: Acao): number | undefined => Number(a.limite || a.max || 0) || undefined

export function normVolumeAction(raw: unknown): VolumeAction {
  const s = norm(raw)
  if (/(des ?mut|religa|tira.*mudo|unmute|liga.*som)/.test(s)) return 'unmute'
  if (/(mut|mudo|silenci|sem som)/.test(s)) return 'mute'
  if (/(toggle|alterna)/.test(s)) return 'toggle'
  if (/(up|aument|sub|mais|\+|alto)/.test(s)) return 'up'
  if (/(down|dimin|baix|menos|-)/.test(s)) return 'down'
  return 'set'
}

export function normMediaAction(raw: unknown): MediaAction {
  const s = norm(raw)
  if (/(prox|próx|pul|next|avan|frente|adiant)/.test(s)) return 'next'
  if (/(anter|volt|previous|prev|retroce)/.test(s)) return 'previous'
  if (/(stop|parar|^pare|interromp)/.test(s)) return 'stop'
  if (/(continu|retoma|despaus|resume|^play|^toca|^tocar)/.test(s)) return 'play'
  if (/(paus)/.test(s)) return 'pause'
  return 'playpause'
}

export function normBrightnessAction(raw: unknown): BrightnessAction {
  const s = norm(raw)
  if (/(up|aument|sub|mais|clar|ilumin)/.test(s)) return 'up'
  if (/(down|dimin|baix|menos|escur)/.test(s)) return 'down'
  return 'set'
}
