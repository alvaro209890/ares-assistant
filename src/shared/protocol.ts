import type { AgentEnvelope, Acao } from './types'

// Protocolo do agente: o LLM devolve, a cada turno, um JSON no formato:
//   { "fala": "texto falável", "acoes": [ { "tipo": "...", ... } ] }
// "acoes" vazio = só conversa. Ver lista de tipos em buildSystemPrompt (main/agent.ts)
// e a documentação no README.

// Ferramentas de CONSULTA (precisam buscar dados e voltar ao LLM para verbalizar).
export const QUERY_TOOLS = new Set([
  'clima.consultar',
  'web.buscar',
  'noticias.listar',
  'agenda.listar',
  'tarefa.listar',
  'briefing.consultar',
  'calcular',
  'converter.moeda',
  'converter.unidade',
  'pagina.ler',
  'sistema.status',
  'area.ler',
  'area.escrever',
  'sistema.abrir',
  'sistema.volume',
  'sistema.midia',
  'sistema.brilho',
  'sistema.bloquear',
  'sistema.captura',
  'ia.raciocinio',
  'ia.modelo',
  'desfazer',
  'codigo.workspace',
  'codigo.buscar',
  'codigo.ler',
  'codigo.comando',
  'codigo.terminal',
  'codigo.confirmar',
  'codigo.cancelar',
  'codigo.git',
  'codigo.indexar',
  'codigo.scaffold',
  'codigo.criar',
  'codigo.diagnostico',
  'codigo.projeto',
  'codigo.patch.preview',
  'codigo.patch.aplicar'
])

// Ações de mutação conhecidas e os campos obrigatórios de cada uma. Usado para
// validar o JSON do LLM e descartar ações inválidas/incompletas com segurança.
export const MUTATION_REQUIRED: Record<string, string[]> = {
  'tarefa.criar': ['titulo'],
  'tarefa.mover': ['titulo'],
  'tarefa.concluir': ['titulo'],
  'tarefa.reabrir': ['titulo'],
  'tarefa.remover': ['titulo'],
  'tarefa.editar': ['titulo'],
  'tarefa.subtarefa.adicionar': ['titulo'],
  'tarefa.subtarefa.concluir': ['titulo'],
  'tarefa.lembrete.definir': ['titulo', 'quando'],
  'coluna.criar': ['titulo'],
  'coluna.renomear': ['titulo', 'novoTitulo'],
  'coluna.remover': ['titulo'],
  'memoria.salvar': ['fato'],
  'memoria.remover': ['fato'],
  'evento.criar': ['titulo', 'quando'],
  'evento.remover': ['titulo'],
  'lista.criar': ['titulo'],
  'lista.adicionar': ['item'],
  'lista.marcar': ['item'],
  'lista.removerItem': ['item'],
  'lista.limpar': ['lista'],
  'nota.salvar': ['texto'],
  'lembrete.criar': ['texto'],
  'lembrete.remover': ['texto']
}

/** Valida uma ação: tipo conhecido (consulta ou mutação) e campos obrigatórios presentes. */
export function validateAction(a: Acao): { ok: boolean; error?: string } {
  if (!a || typeof a.tipo !== 'string') return { ok: false, error: 'ação sem tipo' }
  if (QUERY_TOOLS.has(a.tipo)) return { ok: true }
  const required = MUTATION_REQUIRED[a.tipo]
  if (!required) return { ok: false, error: `tipo desconhecido: ${a.tipo}` }
  for (const field of required) {
    const v = (a as Record<string, unknown>)[field]
    if (v === undefined || v === null || String(v).trim() === '') {
      return { ok: false, error: `${a.tipo} sem campo "${field}"` }
    }
  }
  return { ok: true }
}

/**
 * Extrai, de um JSON ainda em construção (streaming), o valor parcial do campo
 * "fala" já decodificado. Monotônico: o texto só cresce conforme chegam tokens,
 * até a aspa de fechamento. Usado para falar/exibir a resposta enquanto o LLM gera.
 */
export function extractFalaPrefix(raw: string): { text: string; closed: boolean } {
  const keyIdx = raw.indexOf('"fala"')
  if (keyIdx === -1) return { text: '', closed: false }
  let i = keyIdx + 6
  while (i < raw.length && raw[i] !== ':') i++
  i++ // passa do ':'
  while (i < raw.length && /\s/.test(raw[i])) i++
  if (raw[i] !== '"') return { text: '', closed: false }
  i++ // passa da aspa de abertura
  let out = ''
  let esc = false
  for (; i < raw.length; i++) {
    const ch = raw[i]
    if (esc) {
      if (ch === 'n') out += '\n'
      else if (ch === 't') out += '\t'
      else if (ch === 'r') out += '\r'
      else if (ch === '"') out += '"'
      else if (ch === '\\') out += '\\'
      else if (ch === '/') out += '/'
      else if (ch === 'u') {
        const hex = raw.slice(i + 1, i + 5)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16))
          i += 4
        } else {
          return { text: out, closed: false } // \u incompleto: espera mais tokens
        }
      } else out += ch
      esc = false
      continue
    }
    if (ch === '\\') {
      esc = true
      continue
    }
    if (ch === '"') return { text: out, closed: true }
    out += ch
  }
  return { text: out, closed: false }
}

/** Tenta extrair o primeiro objeto JSON balanceado de um texto. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else {
      if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return text.slice(start, i + 1)
      }
    }
  }
  return null
}

/**
 * Faz o parse robusto da resposta do LLM no envelope {fala, acoes}.
 * Aceita JSON puro, JSON dentro de crases, ou texto solto (vira só fala).
 */
export function parseEnvelope(raw: string): AgentEnvelope {
  const text = (raw || '').trim()
  const tryParse = (s: string): AgentEnvelope | null => {
    try {
      const obj = JSON.parse(s)
      if (obj && typeof obj === 'object') {
        const fala = typeof obj.fala === 'string' ? obj.fala : ''
        const acoes: Acao[] = Array.isArray(obj.acoes)
          ? obj.acoes.filter((a: unknown) => a && typeof (a as Acao).tipo === 'string')
          : []
        if (fala || acoes.length) return { fala, acoes }
      }
    } catch {
      /* tenta o próximo método */
    }
    return null
  }

  // 1) JSON direto
  const direct = tryParse(text)
  if (direct) return direct

  // 2) JSON cercado por crases ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    const r = tryParse(fenced[1].trim())
    if (r) return r
  }

  // 3) Primeiro objeto {...} balanceado
  const obj = extractJsonObject(text)
  if (obj) {
    const r = tryParse(obj)
    if (r) return r
  }

  // 4) Fallback: trata tudo como fala
  return { fala: text, acoes: [] }
}
