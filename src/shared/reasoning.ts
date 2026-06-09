// Nível de raciocínio (reasoning effort) do cérebro — lógica pura e testável,
// compartilhada entre main (chamada da API + ação de voz) e renderer (seletores).
//
// Três níveis expostos ao usuário (baixo/médio/alto) que mapeiam para o parâmetro
// reasoning_effort low/medium/high — universalmente aceito pelos modelos de
// raciocínio (DeepSeek V4 Flash/Pro, GPT-5.5). Provedores que não raciocinam
// simplesmente ignoram o campo (e não o enviamos a eles, ver providers.ts).

import type { ReasoningLevel } from './types'

export const REASONING_LEVELS: ReasoningLevel[] = ['baixo', 'medio', 'alto']

export const REASONING_LABEL: Record<ReasoningLevel, string> = {
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto'
}

// Descrição curta do efeito de cada nível (mostrada na UI e falável).
export const REASONING_HINT: Record<ReasoningLevel, string> = {
  baixo: 'respostas rápidas, menos deliberação',
  medio: 'equilíbrio entre velocidade e profundidade',
  alto: 'raciocínio mais profundo (mais lento)'
}

/** Converte o nível pt-BR no parâmetro reasoning_effort da API (OpenAI/DeepSeek). */
export function reasoningEffort(level: ReasoningLevel): 'low' | 'medium' | 'high' {
  switch (level) {
    case 'baixo':
      return 'low'
    case 'alto':
      return 'high'
    default:
      return 'medium'
  }
}

/** Garante um nível válido (fallback "medio"). */
export function coerceReasoning(value: unknown): ReasoningLevel {
  return value === 'baixo' || value === 'medio' || value === 'alto' ? value : 'medio'
}

const ABS_WORDS: Record<string, ReasoningLevel> = {
  baixo: 'baixo',
  baixa: 'baixo',
  low: 'baixo',
  minimo: 'baixo',
  minima: 'baixo',
  rapido: 'baixo',
  medio: 'medio',
  media: 'medio',
  medium: 'medio',
  normal: 'medio',
  padrao: 'medio',
  alto: 'alto',
  alta: 'alto',
  high: 'alto',
  maximo: 'alto',
  maxima: 'alto',
  profundo: 'alto',
  forte: 'alto'
}

const UP_WORDS = ['aumentar', 'aumenta', 'aumente', 'subir', 'sobe', 'suba', 'maior', 'mais', 'eleva', 'eleve', 'turbina']
const DOWN_WORDS = ['diminuir', 'diminui', 'diminua', 'reduzir', 'reduz', 'reduza', 'baixar', 'abaixa', 'abaixe', 'menor', 'menos', 'desce', 'reduzido']

const stripAccents = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Próximo nível na direção dada (saturando nas pontas). */
export function adjustReasoning(current: ReasoningLevel, direction: 'subir' | 'descer'): ReasoningLevel {
  const i = REASONING_LEVELS.indexOf(current)
  const next = direction === 'subir' ? i + 1 : i - 1
  return REASONING_LEVELS[Math.max(0, Math.min(REASONING_LEVELS.length - 1, next))]
}

/**
 * Resolve um comando de raciocínio (vindo de voz/LLM) a partir do nível atual.
 * Aceita nível absoluto ("baixo", "máximo"), direção relativa ("aumente", "diminua")
 * ou objeto da ação {nivel, direcao}. Devolve o nível resultante ou null se não entendeu.
 */
export function resolveReasoning(
  current: ReasoningLevel,
  arg: string | { nivel?: string; direcao?: string } | undefined
): ReasoningLevel | null {
  const raw = typeof arg === 'string' ? arg : [arg?.direcao, arg?.nivel].filter(Boolean).join(' ')
  const text = stripAccents(String(raw || '').toLowerCase()).trim()
  if (!text) return null

  // Absoluto primeiro (mais específico): procura uma palavra-nível no texto.
  for (const token of text.split(/[^a-z]+/).filter(Boolean)) {
    if (ABS_WORDS[token]) return ABS_WORDS[token]
  }
  // Relativo: aumentar/diminuir a partir do atual.
  if (DOWN_WORDS.some((w) => text.includes(w))) return adjustReasoning(current, 'descer')
  if (UP_WORDS.some((w) => text.includes(w))) return adjustReasoning(current, 'subir')
  return null
}
