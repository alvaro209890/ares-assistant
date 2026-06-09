import type { Acao } from '../shared/types'

const CODE_HINT_RE =
  /\b(c[oó]digo|programa[cç][aã]o|arquivo|pasta|projeto|workspace|src|npm|npx|git|guit|patch|diff|terminal|linha|fun[cç][aã]o|classe|componente|m[eé]todo|vari[aá]vel|build|teste|test|typecheck|commit|push|callback|call back|async|await|ass[ií]ncron|arrow|promise|promessa|lambda|try|catch)\b/i

// Termos técnicos ditados por voz -> forma canônica que o LLM entende melhor. Aplicados
// antes da limpeza de pontuação. Só geram efeito se o usuário falar a variante em pt-BR
// (se já disser a forma canônica, não há o que interpretar).
const CODE_TERMS: Array<[RegExp, string]> = [
  [/\bfun[cç][aã]o\s+(seta|flecha|arrow)\b/gi, 'arrow function'],
  [/\barrow\s+function\b/gi, 'arrow function'],
  [/\b(ass[ií]ncrono(\s+com)?\s+await|async\s+e\s+await|async\s+await)\b/gi, 'async await'],
  [/\b(try\s*catch|trai\s*cat(ch|chi)?|tente\s+(e\s+)?capture|tratamento\s+de\s+erro)\b/gi, 'try catch'],
  [/\b(call\s*back|fun[cç][aã]o\s+de\s+retorno)\b/gi, 'callback'],
  [/\b(promessa|promise)\b/gi, 'promise'],
  [/\b(fun[cç][aã]o\s+an[oô]nima|lambda)\b/gi, 'arrow function']
]

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
  for (const [re, replacement] of CODE_TERMS) out = out.replace(re, replacement)
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

// Linhas de stack trace / code frame que não devem ser lidas em voz.
const STACK_LINE_RE =
  /^\s*(at\s+|\.{3}\s|node:internal|[\w./\\-]+:\d+:\d+\)?\s*$|\d+\s*[|│]|\^+\s*$|~+\s*$|in\s+\S+\s+\(.*\)\s*$)/i

/**
 * Extrai a CAUSA RAIZ de uma saída de erro (stderr/erro): a primeira linha que de fato
 * descreve o problema, ignorando o stack trace e os "code frames". Assim, ao reportar um
 * erro de terminal, o Ares fala só o essencial ("Erro: módulo X não encontrado") em vez
 * de despejar o rastreamento inteiro.
 */
export function rootCauseError(raw: string, maxLen = 200): string {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !STACK_LINE_RE.test(l))
  if (!lines.length) return ''
  const meaningful =
    /(error|erro|exception|cannot|not found|n[aã]o encontrad|undefined|is not (a |defined)|unexpected|fail|falh\w*|recus\w*|denied|enoent|module not found|missing|permission|timeout|syntaxerror|typeerror)/i
  const hit = lines.find((l) => meaningful.test(l)) || lines[0]
  return hit.length > maxLen ? `${hit.slice(0, maxLen - 1).replace(/\s+\S*$/, '').trim()}…` : hit
}

export function sanitizeVoiceCodeFala(input: string): string {
  // Limpeza base: remove blocos/inline de código e marcações markdown.
  const base = String(input || '')
    .replace(/```[\s\S]*?```/g, 'Trecho de codigo omitido na fala.')
    .replace(/`([^`]{1,120})`/g, '$1')
    .replace(/`[^`]*$/g, '')
    .replace(/[#*_>\[\]]/g, '')

  // Tenta remover quadros de stack trace; se isso esvaziar tudo (resposta toda "técnica"),
  // cai para o texto base sem esse filtro — nunca devolve vazio à toa (era a causa de a voz
  // não continuar a resposta após analisar diretório/erro).
  const noStack = base
    .split(/\r?\n/)
    .filter((l) => !STACK_LINE_RE.test(l.trim()))
    .join(' ')
  let text = (noStack.trim() ? noStack : base)
    .replace(/\b(stdout|stderr)\b\s*:/gi, '$1 resumido:')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return ''
  // Protege extensões (".ts", ".json") para não cortar frase no ponto do arquivo.
  const protectedText = text.replace(
    /([A-Za-z0-9_./\\-]+)\.(tsx?|jsx?|json|md|css|html|py|ya?ml|env)\b/g,
    (_m, name: string, ext: string) => `${name}<DOT>${ext}`
  )
  const sentences = protectedText.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || []
  // Fala concisa: até 2 frases. Se não houver pontuação (lista de arquivos etc.), usa o
  // texto inteiro em vez de virar vazio.
  text = (sentences.length ? sentences.slice(0, 2).join(' ') : protectedText).replace(/<DOT>/g, '.').trim()
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
    // Erros: fala só a causa raiz, sem o stack trace inteiro.
    if (['stderr', 'erro', 'error'].includes(key) && typeof raw === 'string' && raw.trim()) {
      out[key] = rootCauseError(raw)
      continue
    }
    // Demais campos pesados sao resumidos antes de chegar ao LLM em modo voz.
    if (['content', 'stdout', 'output', 'diff', 'patch', 'texto'].includes(key) && typeof raw === 'string') {
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

/**
 * Reduz campos de erro à CAUSA RAIZ em qualquer profundidade, sem mexer no resto. Roda
 * sempre em modo voz+código (independente do tamanho) para que o Ares reporte o erro de
 * terminal de forma direta, sem despejar o stack trace.
 */
function focusErrorsForVoice(value: unknown, depth = 0): unknown {
  if (value == null || typeof value !== 'object' || depth >= 6) return value
  if (Array.isArray(value)) return value.map((v) => focusErrorsForVoice(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (['stderr', 'erro', 'error'].includes(key) && typeof raw === 'string' && raw.trim()) {
      out[key] = rootCauseError(raw)
    } else {
      out[key] = focusErrorsForVoice(raw, depth + 1)
    }
  }
  return out
}

export function toolResultsPrompt(results: unknown[], voice: boolean, codeMode: boolean): string {
  const base = 'Resultados das ferramentas (responda ao usuario em pt-BR, curto e falavel, sem inventar nada alem disto):'
  const voiceCode =
    'MODO VOZ PARA CODIGO: responda em ate 2 frases; nao leia codigo, diff, JSON, stdout ou stderr; diga apenas o que foi feito, arquivos principais, status de validacao, a saude do projeto e se precisa de autorizacao. Ao reportar erro, fale so a causa raiz.'
  const instruction = voice && codeMode ? `${base}\n${voiceCode}` : base
  const focused = voice && codeMode ? results.map((r) => focusErrorsForVoice(r)) : results
  const payload = voice && codeMode ? truncateForVoice(focused) : focused
  return `${instruction}\n${JSON.stringify(payload)}`
}
