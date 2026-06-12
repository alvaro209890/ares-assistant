// Pré-processamento de texto e "tom de voz" do Ares para a síntese neural (Piper).
// Mantido SEM dependência do Electron para ser testável de forma isolada (o piper.ts
// importa daqui e cuida apenas do processo do binário). A ideia é deixar a fala mais
// fluida e expressiva, estilo JARVIS: siglas técnicas pronunciadas corretamente,
// pausas curtas entre frases e ritmo que varia com o conteúdo (erro = direto e rápido,
// sucesso = calmo e elegante).

/**
 * Silêncio entre frases (s). Uma respiração curta — natural sem ficar lento. Com as
 * vírgulas agora preservadas (ver prepareText), as pausas internas voltam a existir, então
 * este valor cobre apenas a separação entre frases.
 */
export const PIPER_SENTENCE_SILENCE = '0.05'

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
  RAM: 'ram',
  WIFI: 'uai fai',
  LINUX: 'línux',
  GIF: 'guife'
}

// Siglas técnicas que devem ser pronunciadas corretamente em vez de "engolidas".
// Tudo em CAIXA ALTA: a correspondência é sensível a maiúsculas para não mexer em
// palavras comuns (ex.: "as", "os", o "ts"/"js" minúsculos de extensões de arquivo).
const TECH_ACRONYMS = [
  'API', 'JSON', 'HTML', 'CSS', 'SQL', 'URL', 'HTTPS', 'HTTP', 'NPM', 'CLI',
  'SDK', 'CPU', 'GPU', 'RAM', 'UI', 'ID', 'TSX', 'JSX', 'TS', 'JS', 'XML', 'JWT',
  'PDF', 'USB', 'IP', 'HD', 'SSD', 'CSV', 'PNG', 'SVG', 'IDE', 'LLM', 'IA', 'WIFI', 'GIF'
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

export type SpeechTone = 'erro' | 'sucesso' | 'pergunta' | 'neutro'

const ERROR_SIGNALS =
  /\b(erro|erros|falh\w*|imposs[ií]vel|exce[cç][aã]o|inv[aá]lid\w*|recus\w*|negad\w*|bloquead\w*|cancelad\w*|problema\w*|desculpe|lamento|infelizmente|n[aã]o (consegui|foi poss[ií]vel|encontrei|deu certo|funcionou))\b/i

const SUCCESS_SIGNALS =
  /\b(pronto|conclu[ií]\w*|feito|sucesso|tudo certo|passou|passaram|aplicad\w*|criad\w*|salv\w*|atualizad\w*|removid\w*|funcionou|perfeito|excelente|com prazer|à\s+disposi[cç][aã]o)\b/i

/**
 * Decide o "tom" da fala a partir do conteúdo. Erro tem precedência sobre os demais
 * (uma frase pode ter várias pistas, e o aviso de erro é o que importa primeiro);
 * pergunta vem antes de sucesso ("Confirma que aplico?" deve soar como pergunta).
 */
export function detectTone(text: string): SpeechTone {
  const t = String(text || '')
  if (ERROR_SIGNALS.test(t)) return 'erro'
  if (/\?\s*$/.test(t.trim())) return 'pergunta'
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
  const rawRate = clamp(Number.isFinite(rate as number) ? (rate as number) : 0.98, 0.5, 1.6)
  // A escala da UI continua responsiva, mas a curva do Piper fica mais conservadora.
  // Isso evita áudio embolado quando o usuário deixa a velocidade um pouco acima de 1.
  const r = 1 + (rawRate - 1) * 0.65
  let ls = 1 / r
  if (tone === 'erro') ls *= 0.96
  else if (tone === 'sucesso') ls *= 1.04
  else if (tone === 'pergunta') ls *= 1.02 // pergunta: um tiquinho mais pausada, soa atenciosa
  return clamp(ls, 0.45, 2.2)
}

// ---------------------------------------------------------------------------
// Normalização de números e símbolos para pt-BR.
// O Piper (e voz neural em geral) lê números e símbolos de forma pobre/ambígua.
// Escrevê-los por extenso é a maior alavanca de qualidade percebida e independe do
// modelo. Tudo aqui é puro e testável. Convenção pt-BR: ponto = milhar, vírgula = decimal.
// ---------------------------------------------------------------------------

const UNITS = [
  'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete',
  'dezoito', 'dezenove'
]
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const HUNDREDS = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
  'setecentos', 'oitocentos', 'novecentos'
]
const ORDINALS_M = [
  '', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo',
  'nono', 'décimo'
]
const ORDINALS_F = [
  '', 'primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'sétima', 'oitava',
  'nona', 'décima'
]

function under1000(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cem'
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const rem = n % 100
  if (h) parts.push(HUNDREDS[h])
  if (rem) {
    if (rem < 20) parts.push(UNITS[rem])
    else {
      const t = Math.floor(rem / 10)
      const u = rem % 10
      parts.push(u ? `${TENS[t]} e ${UNITS[u]}` : TENS[t])
    }
  }
  return parts.join(' e ')
}

/** Inteiro 0..999999 por extenso (pt-BR). Acima disso devolve null (mantém os dígitos). */
export function intToPtBR(n: number): string | null {
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) return null
  if (n === 0) return 'zero'
  if (n >= 1000000) return null
  const thousands = Math.floor(n / 1000)
  const rest = n % 1000
  if (!thousands) return under1000(rest)
  const thousandsPart = thousands === 1 ? 'mil' : `${under1000(thousands)} mil`
  if (!rest) return thousandsPart
  const connector = rest < 100 || rest % 100 === 0 ? ' e ' : ' '
  return `${thousandsPart}${connector}${under1000(rest)}`
}

/** Lê dígitos um a um (para frações longas e códigos). */
function digitsPtBR(digits: string): string {
  return digits.split('').map((d) => UNITS[Number(d)] ?? d).join(' ')
}

function decimalTailPtBR(frac: string): string {
  // 1 dígito → palavra ("cinco"); 2+ → dígito a dígito (evita "três vírgula catorze"
  // ambíguo com "um quatro"). Mantém zeros à esquerda audíveis ("zero cinco").
  if (frac.length === 1) return UNITS[Number(frac)] ?? frac
  return digitsPtBR(frac)
}

function moneyPtBR(intPart: string, centavos: string | undefined): string {
  const reais = Number(intPart.replace(/\./g, ''))
  const reaisWords = intToPtBR(reais)
  if (reaisWords == null) return ''
  const unit = reais === 1 ? 'real' : 'reais'
  let out = `${reaisWords} ${unit}`
  if (centavos && centavos !== '00') {
    const c = Number(centavos)
    const cWords = intToPtBR(c)
    if (cWords != null) out += ` e ${cWords} ${c === 1 ? 'centavo' : 'centavos'}`
  }
  return out
}

const MONTHS_PT = [
  '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
]

// Abreviações de meses pt-BR (com e sem ponto) → índice 1–12.
const MONTH_ABBREV: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12
}

/** Data por extenso ("10 de junho de 2026"); null se dia/mês inválidos. */
function dateToPtBR(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dayWords = day === 1 ? 'primeiro' : intToPtBR(day)
  const yearWords = intToPtBR(year)
  if (!dayWords || !yearWords) return null
  return `${dayWords} de ${MONTHS_PT[month]} de ${yearWords}`
}

// Unidades de dados/tempo após número: "16 GB" -> "dezesseis gigabytes".
const DATA_UNIT_WORDS: Record<string, [string, string]> = {
  TB: ['terabyte', 'terabytes'],
  GB: ['gigabyte', 'gigabytes'],
  MB: ['megabyte', 'megabytes'],
  KB: ['kilobyte', 'kilobytes'],
  MS: ['milissegundo', 'milissegundos']
}

/**
 * Normaliza números e construções numéricas comuns para pt-BR falado. A ordem importa:
 * data/moeda/versão/hora antes do decimal genérico, e o inteiro simples por último.
 */
export function normalizePtNumbers(text: string): string {
  let t = String(text || '')
  // Data ISO (2026-06-10) e brasileira (10/06/2026) por extenso.
  t = t.replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g, (m, y: string, mo: string, d: string) => {
    return dateToPtBR(Number(y), Number(mo), Number(d)) || m
  })
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g, (m, d: string, mo: string, y: string) => {
    return dateToPtBR(Number(y), Number(mo), Number(d)) || m
  })
  // Data com mês abreviado: 12/mar/2026, 15-jan-2025, 1/dez/2024.
  t = t.replace(/\b(\d{1,2})[/-](jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?[/-](20\d{2})\b/gi,
    (m, d: string, mo: string, y: string) => {
      const month = MONTH_ABBREV[mo.toLowerCase()]
      return month ? (dateToPtBR(Number(y), month, Number(d)) || m) : m
    }
  )
  // Unidades de dados/tempo: 16 GB, 512MB, 120 ms.
  t = t.replace(/\b(\d+(?:,\d+)?)\s?(TB|GB|MB|KB|ms)\b/g, (m, num: string, unit: string) => {
    const words = DATA_UNIT_WORDS[unit.toUpperCase()]
    if (!words) return m
    const plural = !(num === '1' || num === '1,0')
    return `${num} ${plural ? words[1] : words[0]}`
  })
  // Moeda: R$ 1.250,90
  t = t.replace(/R\$\s?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/g, (m, int: string, cents?: string) => {
    const words = moneyPtBR(int, cents)
    return words || m
  })
  // Versão com 'v': v0.24 / v1.2.3 (inequívoco).
  t = t.replace(/\bv(\d+(?:\.\d+)+)\b/gi, (_m, ver: string) => `versão ${versionToPtBR(ver)}`)
  // Versão sem 'v' (2+ pontos), EXCETO agrupamento de milhar (todos os grupos de 3 dígitos,
  // ex.: 1.250.000), que é deixado para a regra de milhar/inteiro.
  t = t.replace(/\b\d+(?:\.\d+){2,}\b/g, (m) => (/^\d{1,3}(?:\.\d{3})+$/.test(m) ? m : versionToPtBR(m)))
  // Hora: 14:30 / 09:05
  t = t.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (m, h: string, min: string) => {
    const hWords = intToPtBR(Number(h))
    if (hWords == null) return m
    if (min === '00') return `${hWords} ${Number(h) === 1 ? 'hora' : 'horas'}`
    const mWords = intToPtBR(Number(min))
    return mWords == null ? m : `${hWords} e ${mWords}`
  })
  // Porcentagem: 10% / 3,5%
  t = t.replace(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d+))?\s?%/g, (m, int: string, frac?: string) => {
    const base = numberPhrase(int, frac)
    return base ? `${base} por cento` : m
  })
  // Ordinais 1º..10º / 1ª..10ª (acima de 10 mantém o token original)
  t = t.replace(/\b(\d{1,2})\s?([ºª°])/g, (m, num: string, sym: string) => {
    const idx = Number(num)
    if (idx < 1 || idx > 10) return m
    return sym === 'ª' ? ORDINALS_F[idx] : ORDINALS_M[idx]
  })
  // Decimal genérico: 3,5 / 1.250,90
  t = t.replace(/\b(\d{1,3}(?:\.\d{3})*|\d+),(\d+)\b/g, (m, int: string, frac: string) => {
    const intWords = intToPtBR(Number(int.replace(/\./g, '')))
    if (intWords == null) return m
    return `${intWords} vírgula ${decimalTailPtBR(frac)}`
  })
  // Inteiro com milhar: 1.000 / 12.500
  t = t.replace(/\b\d{1,3}(?:\.\d{3})+\b/g, (m) => {
    const words = intToPtBR(Number(m.replace(/\./g, '')))
    return words || m
  })
  // Inteiro simples (até 6 dígitos; acima mantém os dígitos para não virar locução enorme).
  t = t.replace(/\b\d+\b/g, (m) => {
    if (m.length > 6) return m
    const words = intToPtBR(Number(m))
    return words || m
  })
  return t
}

/** Lê uma string de versão (já sem 'v') como segmentos por extenso unidos por "ponto". */
function versionToPtBR(ver: string): string {
  return ver
    .split('.')
    .map((seg) => intToPtBR(Number(seg)) ?? digitsPtBR(seg))
    .join(' ponto ')
}

/** Frase para um número possivelmente decimal (usado em %). */
function numberPhrase(intPart: string, frac?: string): string {
  const intWords = intToPtBR(Number(intPart.replace(/\./g, '')))
  if (intWords == null) return ''
  return frac ? `${intWords} vírgula ${decimalTailPtBR(frac)}` : intWords
}

/** Símbolos isolados (cercados por espaços) por extenso. Conservador de propósito. */
export function normalizeSymbols(text: string): string {
  return String(text || '')
    .replace(/(\d)\s?°\s?C\b/g, '$1 graus')
    .replace(/\s&\s/g, ' e ')
    .replace(/\s\+\s/g, ' mais ')
    .replace(/\s=\s/g, ' igual a ')
    .replace(/\s@\s/g, ' arroba ')
}

// ---------------------------------------------------------------------------
// Dicionário de pronúncia para palavras estrangeiras/técnicas.
// O Piper pt-BR lê essas palavras com fonemas incorretos ou engolidos.
// Mapeamos para a grafia fonética que o modelo neural pronuncia corretamente.
// Chaves em minúsculo; a busca é case-insensitive.
// ---------------------------------------------------------------------------

const FOREIGN_WORDS: Record<string, string> = {
  github: 'guitrábe',
  gitlab: 'guitlébe',
  bitbucket: 'bítibâquete',
  claude: 'clóde',
  gemini: 'gémini',
  copilot: 'côpailote',
  docker: 'dóquer',
  flutter: 'fláter',
  python: 'páithon',
  react: 'riéqui',
  nextjs: 'néquist jei ésse',
  nuxt: 'nâquist',
  typescript: 'táipi iscrípt',
  javascript: 'djaváscrípt',
  markdown: 'márk dáun',
  webhook: 'uébi rruque',
  deploy: 'deplói',
  merge: 'mêrdje',
  branch: 'brânch',
  commit: 'comíte',
  pipeline: 'páipilaine',
  frontend: 'frónt énd',
  backend: 'béque énd',
  endpoint: 'énd poínt',
  middleware: 'mídou uér',
  framework: 'fréimuôrque',
  kubernetes: 'cubernétis',
  terraform: 'tèrrafórm',
  vercel: 'versél',
  supabase: 'supabéise',
  vite: 'víte',
  webpack: 'uébi péque',
  electron: 'eléctron',
  runtime: 'rântáime',
  dashboard: 'déchbôrde',
  cache: 'quéche',
  stack: 'istéque',
  script: 'iscrípt',
  sprint: 'isprínt',
  feature: 'fítcher',
  release: 'rilísse',
  issue: 'íchiu',
  token: 'tôquem',
  prompt: 'prômpt',
  router: 'rôuter',
  plugin: 'plâguin',
  layout: 'lêiaúte',
  template: 'têmpleite',
  snippet: 'isníppete',
  swagger: 'isuéger',
  cluster: 'clâster',
  container: 'contêiner',
  download: 'daunlôude',
  upload: 'aplôude',
  update: 'apidêite',
  upgrade: 'apigrêide',
  rollback: 'rôubéque',
  callback: 'colbéque',
  overflow: 'ôverflôu',
  timeout: 'táimeáute',
  startup: 'istártâpi',
  setup: 'setâpi',
  login: 'lóguim',
  logout: 'lógáute',
  feedback: 'fídbéque',
  workspace: 'uôrquisipéisse',
  benchmark: 'bêntchimarque',
  string: 'istríng',
  boolean: 'buliâno',
  integer: 'íntedjer',
  float: 'flôute',
  null: 'nâl',
  undefined: 'ândifáind',
  async: 'êissínque',
  await: 'êiuêite',
  yield: 'íelde',
  default: 'difólte',
  interface: 'ínterfeice',
  abstract: 'ábistréqui',
  override: 'ôverráide',
  extends: 'équisténds',
  implements: 'ímpleménts',
  package: 'péquedj',
  import: 'impórte',
  export: 'équisporte',
  require: 'requáire',
  module: 'módiule',
  openai: 'ôpen êi ái',
  chatgpt: 'tchéte gê pê tê',
  gpt: 'gê pê tê',
  llama: 'lhâma',
  llm: 'éle éle ême',
  embedding: 'embéding',
  fine: 'fáine',
  tuning: 'tiúning',
  sonnet: 'sónete',
  haiku: 'ráiku',
  opus: 'ôpus',
  flash: 'flésh',
  thinking: 'thínking',
}

// Regex das palavras estrangeiras, do mais longo pro mais curto para evitar match parcial.
const FOREIGN_RE = new RegExp(
  `\\b(${Object.keys(FOREIGN_WORDS).sort((a, b) => b.length - a.length).join('|')})\\b`,
  'gi'
)

/** Substitui palavras estrangeiras/técnicas pela pronúncia fonética pt-BR. */
export function expandForeignWords(text: string): string {
  return text.replace(FOREIGN_RE, (m) => FOREIGN_WORDS[m.toLowerCase()] ?? m)
}

// ---------------------------------------------------------------------------
// Normalização de nomes de modelos de IA (gemini-2.5-flash, gpt-4o, etc.)
// ---------------------------------------------------------------------------

/**
 * Normaliza nomes de modelos de IA para fala natural. Exemplos:
 *   gemini-2.5-flash  → gémini dois ponto cinco flésh
 *   gpt-4o            → gê pê tê quatro ó
 *   claude-3.5-sonnet  → clóde três ponto cinco sónete
 *   llama-3.1          → lhâma três ponto um
 */
export function normalizeModelNames(text: string): string {
  // Padrão: palavra-número.número-sufixo (com variações)
  return text.replace(
    /\b(gemini|gpt|claude|llama|mistral|phi|qwen|deepseek|codestral|command)[-\s]?(\d+(?:[.]\d+)*)[-\s]?(pro|flash|ultra|nano|lite|sonnet|haiku|opus|turbo|preview|mini|small|medium|large|thinking|it|instruct|chat|base|latest|o)?\b/gi,
    (_m, name: string, ver: string, suffix?: string) => {
      const namePhonetic = FOREIGN_WORDS[name.toLowerCase()] ?? name
      const verParts = ver.split('.').map((s: string) => intToPtBR(Number(s)) ?? s).join(' ponto ')
      const suffPhonetic = suffix ? ` ${FOREIGN_WORDS[suffix.toLowerCase()] ?? suffix}` : ''
      return `${namePhonetic} ${verParts}${suffPhonetic}`
    }
  )
}

// ---------------------------------------------------------------------------
// Simplificação de URLs e caminhos para fala.
// ---------------------------------------------------------------------------

/** Último segmento de um caminho (nome do arquivo/pasta), sem barras. */
function pathBasename(p: string): string {
  const seg = p.split(/[\\/]+/).filter(Boolean)
  return seg.length ? seg[seg.length - 1] : p
}

/**
 * Substitui caminhos de arquivo por apenas o nome final, para a voz não soletrar
 * "C maiúsculo, dois pontos, barra, Users, barra...". Trata caminhos entre aspas
 * (que podem conter espaços, ex.: "ares_site teste") e caminhos soltos com letra
 * de unidade ou barra invertida. Caminhos com só "/" (datas "12/06", "e/ou") NÃO
 * são tocados — exigem '\' ou 'C:' para contar como caminho.
 */
export function simplifyPaths(text: string): string {
  return String(text || '')
    // Entre aspas simples/duplas: aceita espaços no caminho.
    .replace(/'([^']*[\\/][^']*)'/g, (m, p: string) =>
      /[\\/]/.test(p) && (/\\/.test(p) || /^[A-Za-z]:/.test(p)) ? pathBasename(p) : m
    )
    .replace(/"([^"]*[\\/][^"]*)"/g, (m, p: string) =>
      /[\\/]/.test(p) && (/\\/.test(p) || /^[A-Za-z]:/.test(p)) ? pathBasename(p) : m
    )
    // Soltos (sem espaço): drive letter (C:\... ou C:/...) ou caminho com '\'.
    // O lookbehind evita casar o "s:/" de "https://" (a letra antes do ':' não
    // pode ser outra letra) — URLs continuam intactas para o simplifyUrls.
    .replace(/(?<![A-Za-z])[A-Za-z]:[\\/][^\s"']*|\\[^\s"']+(?:\\[^\s"']+)*/g, (m) => pathBasename(m))
}

/** Remove URLs completas e substitui por "link" ou só o domínio. */
export function simplifyUrls(text: string): string {
  // URLs completas: https://github.com/user/repo → "link do guitrábe"
  return text
    .replace(/https?:\/\/(?:www\.)?([a-zA-Z0-9.-]+)[^\s)\]]*/, (_m, domain: string) => {
      const base = domain.split('.')[0]
      const phonetic = FOREIGN_WORDS[base.toLowerCase()]
      return phonetic ? `link do ${phonetic}` : `link`
    })
}

/** Remove marcação visual que faz o TTS soletrar ruído em voz alta. */
export function cleanSpeechMarkup(text: string): string {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' trecho de código omitido. ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]{1,120})`/g, '$1')
    .replace(/`[^`]*$/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d{1,2}[.)]\s+/gm, '')
    .replace(/[*_~]+/g, '')
}

/**
 * Pré-processa o texto para a síntese: normaliza números/símbolos, pronuncia siglas
 * técnicas e palavras estrangeiras, normaliza nomes de modelos de IA, e ajusta a
 * pontuação. As vírgulas são PRESERVADAS (viram pausa curta natural no Piper).
 */
export function prepareText(text: string): string {
  let t = cleanSpeechMarkup(text)
  t = simplifyUrls(t)
  t = simplifyPaths(t)
  t = normalizePtNumbers(t)
  t = normalizeSymbols(t)
  t = normalizeModelNames(t)
  t = expandTechAcronyms(t)
  t = expandForeignWords(t)
  return t
    .replace(/\b(senhor|senhora)\s*[,;:]\s*/gi, '$1. ')
    .replace(/\s*;\s*/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\.{3,}|…/g, '. ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*:\s*/g, ', ')
    .replace(/\s+([.!?,])/g, '$1')
    .replace(/([.!?]){2,}/g, '$1')
    .replace(/,{2,}/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface SpeechNoise {
  noiseScale: number
  noiseW: number
}

/**
 * Parâmetros de expressividade do Piper por tom. noise_scale controla a variação
 * timbral; noise_w a variação de ritmo/duração. Pequenas variações por tom dão vida à
 * fala (erro = mais seco/nítido; sucesso = mais caloroso) sem distorcer. Base = defaults
 * do Piper (0.667 / 0.8).
 */
export function computeNoise(tone: SpeechTone = 'neutro'): SpeechNoise {
  let noiseScale = 0.62
  let noiseW = 0.74
  if (tone === 'erro') {
    noiseScale = 0.58
    noiseW = 0.72
  } else if (tone === 'sucesso') {
    noiseScale = 0.64
    noiseW = 0.78
  } else if (tone === 'pergunta') {
    // pergunta: mais variação de ritmo/timbre -> entonação mais "curiosa"/melódica.
    noiseScale = 0.65
    noiseW = 0.8
  }
  return {
    noiseScale: clamp(noiseScale, 0.55, 0.68),
    noiseW: clamp(noiseW, 0.68, 0.82)
  }
}

// ---------------------------------------------------------------------------
// Aparar silêncio do WAV (PCM 16-bit mono do Piper).
// O Piper anexa o sentence_silence também ao FIM da locução; como o Ares fala
// frase a frase (uma locução por frase), esse rabo de silêncio vira um "vão"
// audível entre frases. Aparar o excesso deixa a fala encadeada e fluida — a
// pausa entre frases passa a ser controlada por nós, não pelo resíduo do WAV.
// ---------------------------------------------------------------------------

const WAV_HEADER_BYTES = 44
// ~1% do fundo de escala: abaixo disso é silêncio (ruído de fundo do vocoder).
const SILENCE_AMPLITUDE = 330

export interface WavTrimOptions {
  maxLeadingMs?: number
  maxTrailingMs?: number
  sampleRate?: number
}

/**
 * Apara silêncio no início/fim de um WAV PCM16 mono, mantendo no máximo
 * `maxLeadingMs`/`maxTrailingMs` de respiro. Devolve o buffer original se o
 * formato não for o esperado (não-WAV, estéreo, float) — nunca lança.
 */
export function tightenWavSilence(wav: Buffer, opts: WavTrimOptions = {}): Buffer {
  const maxLeadingMs = opts.maxLeadingMs ?? 30
  const maxTrailingMs = opts.maxTrailingMs ?? 70
  if (!wav || wav.length <= WAV_HEADER_BYTES) return wav
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return wav
  // Só o layout canônico do Piper (fmt PCM16 mono + data no offset 36) é tratado.
  if (wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16) return wav
  if (wav.toString('ascii', 36, 40) !== 'data') return wav
  const sampleRate = opts.sampleRate ?? wav.readUInt32LE(24)
  if (!sampleRate) return wav

  const totalSamples = Math.floor((wav.length - WAV_HEADER_BYTES) / 2)
  let firstLoud = -1
  let lastLoud = -1
  for (let i = 0; i < totalSamples; i++) {
    const v = wav.readInt16LE(WAV_HEADER_BYTES + i * 2)
    if (v > SILENCE_AMPLITUDE || v < -SILENCE_AMPLITUDE) {
      if (firstLoud === -1) firstLoud = i
      lastLoud = i
    }
  }
  if (firstLoud === -1) return wav // tudo silêncio: melhor não mexer

  const keepLeading = Math.round((maxLeadingMs / 1000) * sampleRate)
  const keepTrailing = Math.round((maxTrailingMs / 1000) * sampleRate)
  const start = Math.max(0, firstLoud - keepLeading)
  const end = Math.min(totalSamples, lastLoud + 1 + keepTrailing)
  if (start === 0 && end === totalSamples) return wav

  const body = wav.subarray(WAV_HEADER_BYTES + start * 2, WAV_HEADER_BYTES + end * 2)
  const out = Buffer.concat([wav.subarray(0, WAV_HEADER_BYTES), body])
  out.writeUInt32LE(36 + body.length, 4) // tamanho RIFF
  out.writeUInt32LE(body.length, 40) // tamanho do chunk data
  return out
}
