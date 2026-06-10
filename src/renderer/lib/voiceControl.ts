// Interpretação de voz "de controle": palavra de ativação e comandos ditos ENQUANTO
// o Ares está ocupado (programando, rodando build/testes ou falando). Tudo puro e
// testável — o store só conecta microfone/transcrição a estas decisões.

export const normWake = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.,!?;:]/g, '')

/** Distância de edição pequena (tolera erros de transcrição da palavra de ativação). */
export function lev(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/**
 * Verifica se a transcrição começa com a palavra de ativação (nas 2 primeiras
 * palavras, tolerando erros). Retorna o comando sem a palavra-chave, '' se só a
 * palavra foi dita, ou null se a palavra de ativação não apareceu.
 */
export function stripWakeWord(text: string, wakeWord: string): string | null {
  const w = normWake(wakeWord || 'ares')
  const variants = w === 'ares' ? ['ares', 'aris', 'aries', 'arez', 'aress', 'harris', 'ariz'] : [w]
  const tokens = text.trim().split(/\s+/)
  const firstTwo = tokens.slice(0, 2).map(normWake)
  let hit = -1
  for (let k = 0; k < firstTwo.length; k++) {
    if (variants.some((v) => firstTwo[k] === v || lev(firstTwo[k], v) <= 1)) {
      hit = k
      break
    }
  }
  if (hit === -1) return null
  return tokens
    .slice(hit + 1)
    .join(' ')
    .replace(/^[\s,.:;-]+/, '')
    .trim()
}

export type BusyVoiceIntent = { kind: 'cancel' } | { kind: 'command'; text: string } | { kind: 'ignore' }

// Verbos de interrupção no INÍCIO da fala ("para", "cancela isso", "pode parar").
const CANCEL_RE =
  /^(para|pare|pera|parar|cancela|cancelar|aborta|abortar|chega|esquece|interrompe|interromper|stop)\b/
const POLITE_CANCEL_RE = /^pode\s+(parar|cancelar|abortar)\b/

/**
 * Decide o que fazer com uma fala captada ENQUANTO o Ares trabalha:
 * - 'cancel': interrompe a execução atual. Aceito mesmo SEM a palavra de ativação
 *   quando a fala é curta e começa com o verbo ("para!", "cancela isso") — parar
 *   precisa ser fácil. Com a palavra ("Ares, pare"), sempre.
 * - 'command': um novo pedido — vai para a fila e roda quando a tarefa terminar.
 *   Respeita a exigência da palavra de ativação (wakeRequired).
 * - 'ignore': ruído, fala alheia ou curta demais para confiar.
 */
export function interpretBusySpeech(text: string, wakeWord: string, wakeRequired: boolean): BusyVoiceIntent {
  const raw = String(text || '').trim()
  if (!raw) return { kind: 'ignore' }
  const stripped = stripWakeWord(raw, wakeWord)
  const hasWake = stripped !== null
  const target = (hasWake ? stripped : raw).trim()
  if (!target) return { kind: 'ignore' } // só a palavra de ativação
  const norm = normWake(target)
  const tokens = norm.split(/\s+/).filter(Boolean)
  if ((CANCEL_RE.test(norm) || POLITE_CANCEL_RE.test(norm)) && (hasWake || tokens.length <= 4)) {
    return { kind: 'cancel' }
  }
  if (wakeRequired && !hasWake) return { kind: 'ignore' }
  if (tokens.length < 2) return { kind: 'ignore' } // 1 palavra solta: provável ruído
  return { kind: 'command', text: target }
}
