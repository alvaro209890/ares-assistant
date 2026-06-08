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

export function toolResultsPrompt(results: unknown[], voice: boolean, codeMode: boolean): string {
  const base = 'Resultados das ferramentas (responda ao usuario em pt-BR, curto e falavel, sem inventar nada alem disto):'
  const voiceCode =
    'MODO VOZ PARA CODIGO: responda em ate 2 frases; nao leia codigo, diff, JSON, stdout ou stderr; diga apenas o que foi feito, arquivos principais, status de validacao e se precisa de autorizacao.'
  const instruction = voice && codeMode ? `${base}\n${voiceCode}` : base
  return `${instruction}\n${JSON.stringify(results)}`
}
