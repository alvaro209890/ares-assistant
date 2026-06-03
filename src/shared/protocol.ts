import type { AgentEnvelope, Acao } from './types'

// Protocolo do agente: o LLM devolve, a cada turno, um JSON no formato:
//   { "fala": "texto falável", "acoes": [ { "tipo": "...", ... } ] }
// "acoes" vazio = só conversa. Ver lista de tipos em buildSystemPrompt (main/agent.ts)
// e a documentação no README.

// Ferramentas de CONSULTA (precisam buscar dados e voltar ao LLM para verbalizar).
export const QUERY_TOOLS = new Set(['clima.consultar', 'web.buscar', 'noticias.listar', 'agenda.listar', 'tarefa.listar'])

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
