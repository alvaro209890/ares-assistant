import type { Acao } from '../shared/types'
import { parseReportTags } from './subagents'

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
  [/\b(fun[cç][aã]o\s+an[oô]nima|lambda)\b/gi, 'arrow function'],
  [/\binterface\s+de\s+tipos?\b/gi, 'interface'],
  [/\b(use\s*efeito|use\s*effect)\b/gi, 'useEffect'],
  [/\b(use\s*estado|use\s*state)\b/gi, 'useState'],
  [/\b(tipo\s+gen[eé]rico|generics?)\b/gi, 'generic'],
  [/\b(la[cç]o\s+for|loop\s+for)\b/gi, 'for'],
  [/\b(guit|git)\s+(comite|commit|comit)\b/gi, 'git commit'],
  [/\b(guit|git)\s+(push|puxe|pux)\b/gi, 'git push'],
  [/\b(guit|git)\s+(pull|pul)\b/gi, 'git pull'],
  [/\b(guit|git)\s+(diff|dife|difi)\b/gi, 'git diff']
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
  [/\bponto\s+(e\s*n\s*v|env)\b/gi, '.env'],
  [/\bponto\s+(t\s*x\s*t|txt)\b/gi, '.txt'],
  [/\bponto\s+(s\s*q\s*l|sql)\b/gi, '.sql'],
  [/\bponto\s+(t\s*o\s*m\s*l|toml)\b/gi, '.toml'],
  [/\bponto\s+(s\s*v\s*g|svg)\b/gi, '.svg'],
  [/\bponto\s+(s\s*h|sh)\b/gi, '.sh'],
  [/\bponto\s+(v\s*u\s*e|vue)\b/gi, '.vue'],
  [/\bponto\s+(p[ií]ton|python)\b/gi, '.py']
]

export function isCodeActionType(tipo: unknown): boolean {
  return typeof tipo === 'string' && (tipo.startsWith('codigo.') || tipo.startsWith('subagente.'))
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
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]{1,120})`/g, '$1')
    .replace(/`[^`]*$/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d{1,2}[.)]\s+/gm, '')
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

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function oneOrMany(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

function addPeriod(text: string): string {
  const t = text.trim()
  if (!t) return ''
  return /[.!?]$/.test(t) ? t : `${t}.`
}

function compactSpeech(parts: string[], maxLen = 360): string {
  let text = parts.map(addPeriod).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLen) return text
  text = text.slice(0, maxLen - 3).replace(/\s+\S*$/, '').trim()
  return addPeriod(`${text}...`)
}

function topLanguageText(languages: unknown): string {
  const entries = Object.entries(obj(languages))
    .map(([name, count]) => [name, num(count)] as const)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
  if (!entries.length) return ''
  return entries.map(([name]) => name).join(' e ')
}

function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || path
}

function firstFileLine(value: unknown): string {
  const first = obj(arr(value)[0])
  const file = str(first.file)
  const line = num(first.line)
  if (!file) return ''
  return line > 0 ? `${file}:${line}` : file
}

function commandOutcome(result: Record<string, unknown>): string {
  const command = str(result.command)
  const ok = result.ok === true
  const code = typeof result.code === 'number' && Number.isFinite(result.code) ? result.code : null
  const stderr = rootCauseError(str(result.stderr) || str(result.error) || str(result.erro))
  const label = command ? `Comando "${command}"` : 'Comando'
  if (ok) return `${label} concluido com sucesso`
  if (stderr) return `${label} falhou: ${stderr}`
  return code !== null ? `${label} falhou com codigo ${code}` : `${label} falhou`
}

function summarizeCodeResult(tipo: string, resultado: Record<string, unknown>, erro: string): string {
  if (erro) return `A ferramenta de codigo falhou: ${rootCauseError(erro) || erro}`

  switch (tipo) {
    case 'subagente.depurar': {
      const ok = resultado.ok === true
      if (!ok) return 'O depurador Prometeu falhou ao rodar.'
      const report = String(resultado.relatorio || '')
      const tags = parseReportTags(report)
      const cause = tags.rootCause || 'Diagnóstico concluído.'
      return `Prometeu identificou a causa raiz: ${cause}`
    }
    case 'subagente.pesquisar': {
      const ok = resultado.ok === true
      if (!ok) return 'A pesquisa da Atena falhou.'
      return 'Atena concluiu a pesquisa das fontes.'
    }
    case 'subagente.construir': {
      const ok = resultado.ok === true
      if (!ok) return 'O planejamento do Hefesto falhou.'
      const report = String(resultado.relatorio || '')
      const tags = parseReportTags(report)
      const scope = tags.scope || 'Planejamento concluído.'
      return `Hefesto elaborou o plano: ${scope}`
    }
    case 'subagente.auditar': {
      const ok = resultado.ok === true
      if (!ok) return 'A auditoria da Têmis falhou.'
      const report = String(resultado.relatorio || '')
      const tags = parseReportTags(report)
      const verdict = tags.verdict === 'APROVADO' ? 'aprovou as alterações' : 'reprovou as alterações'
      return `Têmis concluiu a auditoria e ${verdict}`
    }
    case 'codigo.workspace': {
      if (resultado.exists === false) return `Nao encontrei o workspace ${str(resultado.root) || 'solicitado'}`
      const name = str(resultado.name) || basename(str(resultado.root)) || 'workspace'
      const files = arr(resultado.files).length
      const langs = topLanguageText(resultado.languages)
      const health = str(obj(resultado.health).label)
      const hints = arr(resultado.hints).map(str).filter(Boolean)
      const first = `Analisei o diretório ${name}: ${oneOrMany(files, 'arquivo', 'arquivos')}${langs ? `, principalmente ${langs}` : ''}`
      const sig = hints.find((h) => /sig|geoespacial|shapefile|arcgis|qgis/i.test(h))
      return compactSpeech([first, sig || health || 'Detalhes completos estao na tela'], 340)
    }
    case 'codigo.listar': {
      const total = num(resultado.total) || arr(resultado.files).length
      const pattern = str(resultado.pattern)
      return `Listei ${oneOrMany(total, 'arquivo', 'arquivos')}${pattern ? ` para ${pattern}` : ''}; os principais estao na tela`
    }
    case 'codigo.buscar': {
      const matches = arr(resultado.matches)
      const query = str(resultado.query)
      const first = firstFileLine(matches)
      return `Busquei ${query ? `"${query}"` : 'no codigo'} e encontrei ${oneOrMany(matches.length, 'resultado', 'resultados')}${first ? `; primeiro em ${first}` : ''}`
    }
    case 'codigo.ler': {
      const file = str(resultado.file) || 'arquivo'
      const start = num(resultado.startLine)
      const end = num(resultado.endLine)
      return `Li ${file}${start && end ? `, linhas ${start} a ${end}` : ''}; o trecho completo esta na tela`
    }
    case 'codigo.esboco': {
      const file = str(resultado.file) || 'arquivo'
      const items = arr(resultado.items).map(obj)
      const names = items.map((i) => str(i.name)).filter(Boolean).slice(0, 2).join(' e ')
      return `Mapeei ${file}: ${oneOrMany(items.length, 'simbolo', 'simbolos')}${names ? `, incluindo ${names}` : ''}`
    }
    case 'codigo.referencias': {
      const symbol = str(resultado.symbol) || 'simbolo'
      const total = num(resultado.total)
      const files = arr(resultado.files)
      const first = firstFileLine(files)
      return `Encontrei ${oneOrMany(total, 'referencia', 'referencias')} de ${symbol} em ${oneOrMany(files.length, 'arquivo', 'arquivos')}${first ? `; principal em ${first}` : ''}`
    }
    case 'codigo.comando':
      return commandOutcome(resultado)
    case 'codigo.git': {
      // diffStruct devolve um summary pronto (arquivos, totais e commit sugerido).
      const summary = str(resultado.summary)
      return summary || commandOutcome(resultado)
    }
    case 'codigo.explicar': {
      const file = str(resultado.file) || 'arquivo'
      const items = arr(resultado.outline).length
      const hints = arr(resultado.hints).map(str).filter(Boolean)
      return compactSpeech([`Analisei ${file}: ${oneOrMany(items, 'simbolo', 'simbolos')}`, hints[0] || ''], 320)
    }
    case 'codigo.terminal': {
      if (resultado.requiresApproval === true) {
        const command = str(resultado.command)
        return command
          ? `O terminal precisa da sua autorizacao para rodar "${command}"`
          : 'O terminal precisa da sua autorizacao antes de executar'
      }
      return commandOutcome(resultado)
    }
    case 'codigo.diagnostico': {
      const health = str(obj(resultado.health).label)
      if (health) return `Diagnostico concluido: ${health}`
      return resultado.ok === true ? 'Diagnostico concluido: tudo verde' : 'Diagnostico concluido com pontos de atencao'
    }
    case 'codigo.testar':
    case 'codigo.lint':
    case 'codigo.formatar':
    case 'codigo.typecheck':
    case 'codigo.deps': {
      const summary = str(resultado.summary)
      if (summary) return summary
      return commandOutcome(resultado)
    }
    case 'codigo.todo': {
      const summary = str(resultado.summary)
      const first = firstFileLine(resultado.items)
      if (summary) return first ? `${addPeriod(summary)} A primeira está em ${first}` : summary
      return commandOutcome(resultado)
    }
    case 'codigo.criar':
    case 'codigo.editar': {
      const file = str(resultado.file)
      const changed = resultado.changed !== false
      return file ? `${changed ? 'Atualizei' : 'Verifiquei'} ${file}` : 'Arquivo atualizado'
    }
    case 'codigo.scaffold': {
      const created = arr(resultado.created).length
      return `Projeto criado com ${oneOrMany(created, 'arquivo', 'arquivos')}`
    }
    case 'codigo.substituir': {
      const total = num(resultado.totalMatches)
      const files = arr(resultado.files).length
      const applied = resultado.applied === true
      return `${applied ? 'Substituicao aplicada' : 'Previa de substituicao pronta'}: ${oneOrMany(total, 'ocorrencia', 'ocorrencias')} em ${oneOrMany(files, 'arquivo', 'arquivos')}`
    }
    case 'codigo.patch.preview':
    case 'codigo.patch.aplicar': {
      const files = arr(resultado.files).length
      const applied = resultado.applied === true
      if (resultado.reverted === true) {
        return `Patch revertido automaticamente: a sintaxe quebrou em ${oneOrMany(files, 'arquivo', 'arquivos')}. Nada foi alterado`
      }
      return `${applied ? 'Patch aplicado' : 'Patch validado'} em ${oneOrMany(files, 'arquivo', 'arquivos')}`
    }
    case 'codigo.indexar': {
      const count = num(resultado.fileCount)
      return `Indice do projeto atualizado com ${oneOrMany(count, 'arquivo', 'arquivos')}`
    }
    case 'codigo.projeto': {
      const ok = resultado.ok === true
      const done = resultado.done === true || resultado.ok === true
      const steps = num(resultado.steps)
      const summary = str(resultado.summary)
      const transcript = arr(resultado.transcript).map(obj)
      const failures = transcript.flatMap((t) => arr(t.ran).map(obj).filter((r) => r.ran && !r.ok))
      if (ok) {
        return summary || 'Coder autônomo concluiu o objetivo com sucesso.'
      }
      if (failures.length > 0) {
        const failedCmds = failures.map((r) => `"${str(r.command)}"`).join(', ')
        return `O coder autônomo falhou na verificação dos comandos: ${failedCmds}.`
      }
      if (!done) {
        return `O coder autônomo não conseguiu concluir o objetivo após rodar ${oneOrMany(steps, 'passo', 'passos')}.`
      }
      return 'O coder autônomo encontrou problemas durante a execução.'
    }
    default:
      return ''
  }
}

/**
 * Duas falas são "a mesma" quando, normalizadas (sem pontuação/acentos extras de
 * espaço, caixa baixa), uma contém a outra. Evita o Ares repetir em sequência o
 * resumo imediato da ferramenta e a conclusão do modelo quando dizem o mesmo.
 */
export function isDuplicateSpeech(a: string, b: string): boolean {
  const norm = (s: string): string =>
    String(s || '')
      .toLowerCase()
      .replace(/[.,;:!?…]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

/**
 * Anúncio falado de progresso ANTES de rodar as ferramentas de uma rodada: frase
 * curta dita EM PARALELO com a execução (voz assíncrona, não segura o turno).
 * Cobre o silêncio das rodadas intermediárias do modo voz+código, em que a
 * resposta crua do modelo vai só para a tela — sem isto, o usuário ficava no
 * vácuo até o heartbeat dos 15 s. A primeira ação reconhecida dita o anúncio.
 * Pura e testável.
 */
export function voiceToolAnnouncement(actions: Acao[]): string {
  for (const a of actions || []) {
    const tipo = String(a?.tipo || '')
    const file = basename(String(a?.arquivo || a?.file || ''))
    switch (tipo) {
      case 'codigo.testar':
        return 'Executando os testes, senhor.'
      case 'codigo.typecheck':
        return 'Checando os tipos do projeto.'
      case 'codigo.lint':
        return 'Passando o linter no projeto.'
      case 'codigo.formatar':
        return 'Formatando o código.'
      case 'codigo.diagnostico':
        return 'Rodando o diagnóstico do projeto.'
      case 'codigo.deps':
        return 'Verificando as dependências.'
      case 'codigo.editar':
        return file ? `Aplicando a correção em ${file}.` : 'Aplicando a edição.'
      case 'codigo.criar':
        return file ? `Criando ${file}.` : 'Criando o arquivo.'
      case 'codigo.patch.aplicar':
        return 'Aplicando o patch com validação de sintaxe.'
      case 'codigo.buscar':
        return 'Buscando no código.'
      case 'codigo.ler':
        return file ? `Lendo ${file}.` : 'Lendo o arquivo.'
      case 'codigo.explicar':
        return file ? `Analisando ${file}.` : 'Analisando o trecho.'
      case 'codigo.terminal':
      case 'codigo.comando':
      case 'codigo.confirmar': {
        const c = String(a?.comando || a?.command || '').trim().split(/\s+/).slice(0, 3).join(' ')
        return c ? `Executando ${c} no terminal.` : 'Executando o comando.'
      }
      case 'codigo.projeto':
        return 'Acionando o coder autônomo. Acompanho os passos.'
      case 'codigo.git':
        return 'Consultando o estado do Git.'
      case 'subagente.depurar':
        return 'Passando o erro ao Prometeu para depuração.'
      case 'subagente.pesquisar':
        return 'Acionando a Atena.'
      case 'subagente.construir':
        return 'Acionando o Hefesto.'
      case 'subagente.auditar':
        return 'Acionando a Têmis.'
    }
  }
  return ''
}

export function codeVoiceProgressSummary(results: unknown[]): string {
  const parts: string[] = []
  for (const raw of results) {
    const r = obj(raw)
    const tipo = str(r.tipo)
    if (!tipo.startsWith('codigo.') && !tipo.startsWith('subagente.')) continue
    const summary = summarizeCodeResult(tipo, obj(r.resultado), str(r.erro))
    if (summary) parts.push(summary)
    if (parts.length >= 2) break
  }
  return compactSpeech(parts, 360)
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

// ---------------------------------------------------------------------------
// "Batimento" de voz em tarefas longas: se um comando passa de ~15 s, o Ares fala
// uma atualização curta (e repete a cada ~30 s) no canal só-de-fala — o usuário
// nunca fica no silêncio sem saber se travou. Puro (sem electron) e testável.
// ---------------------------------------------------------------------------

export const HEARTBEAT_FIRST_MS = 15_000
export const HEARTBEAT_REPEAT_MS = 30_000
export const HEARTBEAT_PHRASES = [
  ' Ainda trabalhando nisso, senhor.',
  ' A tarefa continua em execução. Já trago o resultado.',
  ' Quase lá. Sigo acompanhando a saída.'
]

type HeartbeatDelta = (chunk: string, phase: number, kind?: 'both' | 'display' | 'speak', done?: boolean) => void

let activeHeartbeats = 0
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatIndex = 0

export function startHeartbeat(onDelta: HeartbeatDelta | undefined, phase: number): () => void {
  if (!onDelta) return () => {}
  activeHeartbeats++
  if (activeHeartbeats === 1) {
    heartbeatIndex = 0
    const tick = (): void => {
      onDelta(HEARTBEAT_PHRASES[heartbeatIndex++ % HEARTBEAT_PHRASES.length], phase, 'speak', true)
      heartbeatTimer = setTimeout(tick, HEARTBEAT_REPEAT_MS)
    }
    heartbeatTimer = setTimeout(tick, HEARTBEAT_FIRST_MS)
  }
  return () => {
    activeHeartbeats--
    if (activeHeartbeats <= 0) {
      activeHeartbeats = 0
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer)
        heartbeatTimer = null
      }
    }
  }
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
