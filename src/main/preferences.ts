import type { MemoryFact } from '../shared/types'

// "Pílulas de Contexto": preferências de CODIFICAÇÃO do usuário extraídas da memória
// de longo prazo (ex.: "sempre use aspas simples", "prefira funções nomeadas"). Mantido
// puro (sem Electron) para ser testável; o data.ts apenas conecta com a memória salva.

// Sinais de que um fato é uma preferência de estilo/código (e não algo genérico).
const CODING_PREF_RE =
  /\b(aspas|aspa simples|aspa dupla|ponto e v[ií]rgula|semicolons?|sem ponto e v[ií]rgula|indenta[cç][aã]o|indent|tabs?|espa[cç]os|2 espa[cç]os|4 espa[cç]os|camelcase|snake_?case|kebab|pascalcase|fun[cç][aã]o nomeada|fun[cç][oõ]es nomeadas|arrow function|async\/?await|prettier|eslint|tipagem|typescript|interface|type alias|nomes? de vari[aá]ve(l|is)|imports?|barril|default export|named export|tailwind|css modules|componentes funcionais|hooks)\b/i

// Verbos típicos de preferência, para captar frases como "prefiro X", "sempre use Y".
const PREF_VERB_RE = /\b(prefir|prefer[eê]|sempre us|nunca us|gosto de|costumo|padr[aã]o[:]?|use\b|evite\b|adote)/i

/** Filtra, da memória, os fatos que são preferências de codificação. Puro. */
export function filterCodingPreferences(facts: MemoryFact[]): MemoryFact[] {
  return (facts || []).filter((f) => {
    if (!f || f.status !== 'active') return false
    const t = String(f.text || '')
    const looksLikeCode = CODING_PREF_RE.test(t)
    const looksLikePref = PREF_VERB_RE.test(t)
    // Em projetos/preferências, basta o sinal de código; em outras categorias exige
    // também um verbo de preferência para reduzir falso-positivo.
    if (f.category === 'preferencias' || f.category === 'projetos' || f.category === 'trabalho') {
      return looksLikeCode || (looksLikePref && /\b(c[oó]digo|programa|fun[cç]|vari[aá]vel|arquivo|component)\b/i.test(t))
    }
    return looksLikeCode && looksLikePref
  })
}

/** Resumo curto e falável das preferências de código, para injetar no prompt. */
export function formatCodingPreferences(facts: MemoryFact[], maxChars = 600): string {
  const prefs = filterCodingPreferences(facts)
  if (!prefs.length) return ''
  let out = ''
  for (const p of prefs) {
    const line = `- ${p.text.replace(/\s+/g, ' ').trim()}`
    if (out.length + line.length > maxChars) break
    out += (out ? '\n' : '') + line
  }
  return out
}
