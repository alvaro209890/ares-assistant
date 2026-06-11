import type { EvidencePackage, EvidenceSection } from './types'

// Orçamento total padrão (em caracteres) do MATERIAL COLETADO de UM subagente.
// 18k chars ~ 4.5k tokens — espaço confortável dentro do contexto sem inflar.
const DEFAULT_BUDGET = 18000

/** Trunca preservando fronteira de linha quando possível, com marcador final. Pura. */
export function truncateSmart(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  const slice = text.slice(0, max)
  const nl = slice.lastIndexOf('\n')
  // Se temos uma quebra de linha na segunda metade do corte, prefere terminar lá.
  const cut = nl > max * 0.6 ? slice.slice(0, nl) : slice
  return `${cut}\n…[${text.length - cut.length} caracteres omitidos]`
}

/**
 * Renderiza o pacote num texto único. Aloca orçamento por seção em duas fases:
 * 1) Mínimos garantidos por prioridade (essenciais primeiro).
 * 2) Distribuição da sobra em passos limitados, com peso por prioridade.
 * Pura e determinística para o mesmo input.
 */
export function renderEvidencePackage(pkg: EvidencePackage, budget = DEFAULT_BUDGET): string {
  const sections = (pkg.sections || []).filter((s) => s && s.body && s.body.trim())
  if (!sections.length && !pkg.notes?.length) return ''
  const used: number[] = sections.map(() => 0)
  let remaining = Math.max(0, budget)

  const order = sections.map((s, i) => ({ s, i, priority: s.priority ?? 2 }))
  const byPriority = [...order].sort((a, b) => a.priority - b.priority)

  // 1) Mínimos por seção: tenta dar pelo menos `minChars` (default 600), ou o corpo inteiro se for menor.
  for (const { s, i } of byPriority) {
    if (remaining <= 0) break
    const want = Math.max(s.minChars ?? 600, 0)
    const grant = Math.min(want, s.body.length, remaining)
    used[i] = grant
    remaining -= grant
  }
  // 2) Distribui sobra: round-robin priorizado, com passos máximos por prioridade.
  while (remaining > 0) {
    let progressed = false
    for (const { s, i, priority } of byPriority) {
      const space = s.body.length - used[i]
      if (space <= 0) continue
      const stepMax = priority === 1 ? 800 : priority === 2 ? 400 : 200
      const step = Math.min(space, remaining, stepMax)
      if (step <= 0) continue
      used[i] += step
      remaining -= step
      progressed = true
      if (remaining <= 0) break
    }
    if (!progressed) break
  }

  const parts: string[] = []
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const txt = truncateSmart(s.body, used[i])
    if (txt.trim()) parts.push(`## ${s.title}\n${txt}`)
  }
  if (pkg.notes?.length) parts.push(`## Observações da coleta\n- ${pkg.notes.join('\n- ')}`)
  return parts.join('\n\n')
}

/** Helper para construir pacote filtrando seções nulas/vazias. */
export function evidenceOf(
  sections: Array<EvidenceSection | null | undefined>,
  notes: string[] = []
): EvidencePackage {
  const clean = sections.filter((s): s is EvidenceSection => !!s && !!s.body && !!s.body.trim())
  return { sections: clean, notes: notes.filter(Boolean) }
}

/**
 * Ranking simples por tokens (>=3 chars) do objetivo contra caminhos de arquivos.
 * Devolve até `max` arquivos com score > 0; se nada bate, devolve os primeiros
 * `max` arquivos da lista original como fallback (visão geral do projeto).
 * Pura e testável.
 */
export function pickRelevantFiles(files: string[], goal: string, max = 8): string[] {
  const tokens = String(goal || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((t) => t.length >= 3)
  if (!files.length) return []
  if (!tokens.length) return files.slice(0, max)
  const score = (f: string): number => {
    const s = f.toLowerCase()
    let n = 0
    for (const t of tokens) if (s.includes(t)) n += t.length >= 5 ? 2 : 1
    return n
  }
  const ranked = files
    .map((f) => ({ f, n: score(f) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.f.localeCompare(b.f))
    .slice(0, max)
    .map((x) => x.f)
  return ranked.length ? ranked : files.slice(0, max)
}

/**
 * Extrai paths reais da saída de `git status --short`. Lida com renames
 * (`R  old -> new`) e remove o status XY (2 chars + espaço) à esquerda.
 * Pura e testável.
 */
export function parseGitStatusFiles(status: string): string[] {
  if (!status) return []
  const out: string[] = []
  for (const raw of status.split(/\r?\n/)) {
    if (!raw) continue
    // Formato porcelain: "XY path" (2 chars + 1 espaço + path). Aceita também sem espaço inicial.
    const m = raw.match(/^.{1,3}\s+(.+)$/)
    const path = (m ? m[1] : raw).trim()
    if (!path) continue
    const rename = path.match(/^(.+?)\s*->\s*(.+)$/)
    const file = (rename ? rename[2] : path).replace(/^"|"$/g, '')
    if (file) out.push(file)
  }
  return out
}
