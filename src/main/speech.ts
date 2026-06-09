// Pré-processamento de texto e "tom de voz" do Ares para a síntese neural (Piper).
// Mantido SEM dependência do Electron para ser testável de forma isolada (o piper.ts
// importa daqui e cuida apenas do processo do binário). A ideia é deixar a fala mais
// fluida e expressiva, estilo JARVIS: siglas técnicas pronunciadas corretamente,
// pausas curtas entre frases e ritmo que varia com o conteúdo (erro = direto e rápido,
// sucesso = calmo e elegante).

/** Silêncio entre frases (s). Curto, para uma fala contínua e menos robótica. */
export const PIPER_SENTENCE_SILENCE = '0.025'

// Nomes das letras em pt-BR, para soletrar siglas que o Piper não pronuncia bem.
const LETTER_PT: Record<string, string> = {
  A: 'á', B: 'bê', C: 'cê', D: 'dê', E: 'é', F: 'éfe', G: 'gê', H: 'agá',
  I: 'í', J: 'jota', K: 'cá', L: 'éle', M: 'ême', N: 'êne', O: 'ó', P: 'pê',
  Q: 'quê', R: 'érre', S: 'ésse', T: 'tê', U: 'u', V: 'vê', W: 'dáblio',
  X: 'xis', Y: 'ípsilon', Z: 'zê'
}

// Siglas com pronúncia consagrada (lidas como palavra, não soletradas).
const ACRONYM_OVERRIDE: Record<string, string> = {
  JSON: 'jêison',
  RAM: 'ram'
}

// Siglas técnicas que devem ser pronunciadas corretamente em vez de "engolidas".
// Tudo em CAIXA ALTA: a correspondência é sensível a maiúsculas para não mexer em
// palavras comuns (ex.: "as", "os", o "ts"/"js" minúsculos de extensões de arquivo).
const TECH_ACRONYMS = [
  'API', 'JSON', 'HTML', 'CSS', 'SQL', 'URL', 'HTTPS', 'HTTP', 'NPM', 'CLI',
  'SDK', 'CPU', 'GPU', 'RAM', 'UI', 'ID', 'TSX', 'JSX', 'TS', 'JS', 'XML', 'JWT'
]

function spellAcronym(token: string): string {
  return ACRONYM_OVERRIDE[token] ?? token.split('').map((c) => LETTER_PT[c] || c).join(' ')
}

// Regex única, com as siglas mais longas primeiro (HTTPS antes de HTTP, TSX antes de TS),
// aceitando um "s" minúsculo de plural (APIs, URLs).
const ACRONYM_RE = new RegExp(
  `\\b(${[...TECH_ACRONYMS].sort((a, b) => b.length - a.length).join('|')})s?\\b`,
  'g'
)

/** Soletra/pronuncia siglas técnicas (API, JSON, TS, JS, …) para a voz acertar. */
export function expandTechAcronyms(text: string): string {
  return text.replace(ACRONYM_RE, (_m, core: string) => spellAcronym(core))
}

export type SpeechTone = 'erro' | 'sucesso' | 'neutro'

const ERROR_SIGNALS =
  /\b(erro|erros|falh\w*|imposs[ií]vel|exce[cç][aã]o|inv[aá]lid\w*|recus\w*|negad\w*|bloquead\w*|cancelad\w*|problema\w*|desculpe|lamento|infelizmente|n[aã]o (consegui|foi poss[ií]vel|encontrei|deu certo|funcionou))\b/i

const SUCCESS_SIGNALS =
  /\b(pronto|conclu[ií]\w*|feito|sucesso|tudo certo|passou|passaram|aplicad\w*|criad\w*|salv\w*|atualizad\w*|removid\w*|funcionou|perfeito|excelente|com prazer|à\s+disposi[cç][aã]o)\b/i

/**
 * Decide o "tom" da fala a partir do conteúdo. Erro tem precedência sobre sucesso
 * (uma frase pode ter as duas pistas, e o aviso de erro é o que importa primeiro).
 */
export function detectTone(text: string): SpeechTone {
  const t = String(text || '')
  if (ERROR_SIGNALS.test(t)) return 'erro'
  if (SUCCESS_SIGNALS.test(t)) return 'sucesso'
  return 'neutro'
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/**
 * length_scale do Piper = inverso da velocidade. Variamos dinamicamente pelo tom:
 * erro → um pouco mais rápido e direto; sucesso → um pouco mais calmo e elegante.
 * Mantém-se dentro de limites seguros para a voz não distorcer.
 */
export function computeLengthScale(rate: number | undefined, tone: SpeechTone = 'neutro'): number {
  const r = clamp(Number.isFinite(rate as number) ? (rate as number) : 1.08, 0.5, 1.6)
  let ls = 1 / r
  if (tone === 'erro') ls *= 0.92
  else if (tone === 'sucesso') ls *= 1.06
  return clamp(ls, 0.45, 2.2)
}

/**
 * Pré-processa o texto para reduzir pausas excessivas em vírgulas/pontuação e
 * pronunciar siglas técnicas. O Piper pausa bastante em vírgulas; removemos essas
 * pausas internas e mantemos pontuação forte para preservar a respiração entre frases.
 */
export function prepareText(text: string): string {
  return expandTechAcronyms(text)
    .replace(/\b(senhor|senhora)\s*[,;:]\s*/gi, '$1. ')
    .replace(/\s*[,;]\s*/g, ' ')
    .replace(/\.{3,}|…/g, '. ')
    .replace(/\s*[—–]\s*/g, ' ')
    .replace(/\s*:\s*/g, ' ')
    .replace(/\s+([.!?])/g, '$1')
    .replace(/([.!?]){2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
