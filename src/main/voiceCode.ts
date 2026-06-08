import type { Acao } from '../shared/types'

const CODE_HINT_RE =
  /\b(c[oó]digo|programa[cç][aã]o|arquivo|pasta|projeto|workspace|src|npm|npx|git|guit|patch|diff|terminal|linha|fun[cç][aã]o|classe|componente|build|teste|test|typecheck|commit|push)\b/i

const EXTENSIONS: Array<[RegExp, string]> = [
  [/\bponto\s+(t\s*s\s*x|tsx)\b/gi, '.tsx'],
  [/\bponto\s+(t\s*s|ts)\b/gi, '.ts'],
  [/\bponto\s+(j\s*s\s*x|jsx)\b/gi, '.jsx'],
  [/\bponto\s+(j\s*s|js)\b/gi, '.js'],
  [/\bponto\s+(j\s*s\s*o\s*n|json)\b/gi, '.json'],
  [/\bponto\s+(m\s*d|md)\b/gi, '.md'],
  [/\bponto\s+(c\s*s\s*s|css)\b/gi, '.css'],
  [/\bponto\s+(h\s*t\s*m\s*l|html)\b/gi, '.html'],
  [/\bponto\s+(p\s*y|py)\b/gi, '.py'],
  [/\bponto\s+(y\s*a\s*m\s*l|yaml)\b/gi, '.yaml'],
  [/\bponto\s+(y\s*m\s*l|yml)\b/gi, '.yml'],
  [/\bponto\s+(e\s*n\s*v|env)\b/gi, '.env']
]

export function isCodeActionType(tipo: unknown): boolean {
  return typeof tipo === 'string' && tipo.startsWith('codigo.')
}

export function hasCodeAction(actions: Acao[]): boolean {
  return actions.some((a) => isCodeActionType(a.tipo))
}

export function voiceCodeInterpretation(input: string): string | null {
  const original = String(input || '').trim()
  if (!original || !CODE_HINT_RE.test(original)) return null

  let out = original
  for (const [re, replacement] of EXTENSIONS) out = out.replace(re, replacement)
  out = out
    .replace(/\bcontra\s+barra\b/gi, '\\')
    .replace(/\bbarra\b/gi, '/')
    .replace(/\bdois\s+pontos\b/gi, ':')
    .replace(/\b(h[ií]fen|tra[cç]o)\b/gi, '-')
    .replace(/\b(underline|sublinhado)\b/gi, '_')
    .replace(/\b(n\s*p\s*m|ene\s+pe\s+eme|npm)\s+(run|rum|rom|r[aã]n)\b/gi, 'npm run')
    .replace(/\b(n\s*p\s*x|ene\s+pe\s+xis|npx)\b/gi, 'npx')
    .replace(/\b(git|guit)\s+(estado|status)\b/gi, 'git status')
    .replace(/\bponto\b/gi, '.')
    .replace(/\s*([/\\:._-])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  return out && out !== original ? out : null
}

export function voiceAwareUserContent(userText: string, voice: boolean): string {
  if (!voice) return userText
  const interpreted = voiceCodeInterpretation(userText)
  if (!interpreted) return userText
  return `${userText}\n\n[Interpretacao auxiliar para voz em codigo: ${interpreted}]`
}

export function sanitizeVoiceCodeFala(input: string): string {
  let text = String(input || '')
    .replace(/```[\s\S]*?```/g, 'Trecho de codigo omitido na fala.')
    .replace(/`([^`]{1,120})`/g, '$1')
    .replace(/`[^`]*$/g, '')
    .replace(/[#*_>\[\]]/g, '')
    .replace(/\b(stdout|stderr)\b\s*:/gi, '$1 resumido:')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return ''
  const protectedText = text.replace(
    /([A-Za-z0-9_./\\-]+)\.(tsx?|jsx?|json|md|css|html|py|ya?ml|env)\b/g,
    (_m, name: string, ext: string) => `${name}<DOT>${ext}`
  )
  const sentences = protectedText.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [protectedText]
  text = sentences.slice(0, 2).join(' ').replace(/<DOT>/g, '.')
  if (text.length > 360) {
    text = `${text.slice(0, 357).replace(/\s+\S*$/, '').trim()}...`
  }
  return text
}

const VOICE_TOOL_RESULT_LIMIT = 4000
const VOICE_TRUNCATED_MARK = '[...resultado truncado para voz...]'

function compactVoiceValue(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    if (value.length <= 360) return value
    return `${value.slice(0, 320).replace(/\s+\S*$/, '').trim()} ${VOICE_TRUNCATED_MARK}`
  }
  if (typeof value !== 'object') return value
  if (depth >= 4) return VOICE_TRUNCATED_MARK

  if (Array.isArray(value)) {
    const maxItems = depth <= 1 ? 12 : 6
    const items = value.slice(0, maxItems).map((item) => compactVoiceValue(item, depth + 1))
    return value.length > maxItems ? [...items, `${VOICE_TRUNCATED_MARK} (${value.length - maxItems} itens)`] : items
  }

  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    // Campos pesados sao resumidos antes de chegar ao LLM em modo voz.
    if (['content', 'stdout', 'stderr', 'output', 'diff', 'patch', 'texto'].includes(key) && typeof raw === 'string') {
      out[key] =
        raw.length > 180
          ? `${raw.slice(0, 160).replace(/\s+\S*$/, '').trim()} ${VOICE_TRUNCATED_MARK}`
          : raw
      continue
    }
    out[key] = compactVoiceValue(raw, depth + 1)
  }
  return out
}

function truncateForVoice(results: unknown[]): unknown[] {
  const json = JSON.stringify(results)
  if (json.length <= VOICE_TOOL_RESULT_LIMIT) return results

  let compacted = results.map((r) => compactVoiceValue(r))
  let compactedJson = JSON.stringify(compacted)
  if (compactedJson.length <= VOICE_TOOL_RESULT_LIMIT) return compacted as unknown[]

  compacted = compacted.slice(0, 6)
  compactedJson = JSON.stringify(compacted)
  const room = Math.max(0, VOICE_TOOL_RESULT_LIMIT - VOICE_TRUNCATED_MARK.length - 32)
  const clipped = compactedJson.slice(0, room).replace(/[,{\[]?[^,[{\]}]*$/, '')
  return [`${clipped} ${VOICE_TRUNCATED_MARK}`]
}

export function toolResultsPrompt(results: unknown[], voice: boolean, codeMode: boolean): string {
  const base = 'Resultados das ferramentas (responda ao usuario em pt-BR, curto e falavel, sem inventar nada alem disto):'
  const voiceCode =
    'MODO VOZ PARA CODIGO: responda em ate 2 frases; nao leia codigo, diff, JSON, stdout ou stderr; diga apenas o que foi feito, arquivos principais, status de validacao e se precisa de autorizacao.'
  const instruction = voice && codeMode ? `${base}\n${voiceCode}` : base
  const payload = voice && codeMode ? truncateForVoice(results) : results
  return `${instruction}\n${JSON.stringify(payload)}`
}
