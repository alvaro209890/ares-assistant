// Descoberta de aplicativos instalados no Windows via atalhos do Menu Iniciar.
// "Abra o Spotify" funciona para QUALQUER app instalado, não só para a allowlist de
// binários no PATH: o Menu Iniciar (.lnk/.url) é o catálogo canônico do que o usuário
// vê como "aplicativo". A varredura é cacheada; o casamento de nomes falados é
// tolerante (acentos, maiúsculas, palavras parciais e pequenos erros de transcrição).
// Este módulo NÃO importa electron — toda a lógica de matching é pura e testável.

import { readdirSync, type Dirent } from 'fs'
import { join, basename, extname } from 'path'

export interface StartMenuApp {
  /** Nome "humano" do atalho (basename sem extensão), ex.: "Visual Studio Code". */
  name: string
  /** Caminho completo do .lnk/.url (abrível com `start ""`). */
  path: string
}

/** Pastas padrão do Menu Iniciar (máquina + usuário). */
export function startMenuDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = []
  const tail = join('Microsoft', 'Windows', 'Start Menu', 'Programs')
  if (env.ProgramData) dirs.push(join(env.ProgramData, tail))
  if (env.APPDATA) dirs.push(join(env.APPDATA, tail))
  return dirs
}

// Atalhos que não são "o app" (desinstalador, site, manual) — não devem ganhar de
// um nome de app de verdade no casamento.
const NOISE_NAME_RE = /\b(uninstall|desinstalar|remove|website|web site|site|help|ajuda|manual|documentation|readme|license|changelog|report|updater?)\b/i

/** Varre as pastas (recursivo, raso) e devolve os atalhos encontrados, sem ruído. */
export function scanShortcuts(dirs: string[], maxDepth = 3): StartMenuApp[] {
  const out: StartMenuApp[] = []
  const seen = new Set<string>()
  const walk = (dir: string, depth: number): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < maxDepth) walk(full, depth + 1)
        continue
      }
      const ext = extname(e.name).toLowerCase()
      if (ext !== '.lnk' && ext !== '.url') continue
      const name = basename(e.name, ext).trim()
      if (!name || NOISE_NAME_RE.test(name)) continue
      const key = normalizeAppName(name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push({ name, path: full })
    }
  }
  for (const d of dirs) walk(d, 0)
  return out
}

/** Normaliza um nome para casamento: minúsculas, sem acentos/pontuação/espaços extras. */
export function normalizeAppName(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Distância de edição pequena (tolera erros de transcrição de voz). */
function lev(a: string, b: string): number {
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
 * Pontua o quão bem um nome falado casa com um nome de atalho (ambos já
 * normalizados). 0 = não casa. Quanto mais específico o casamento, maior a nota;
 * empates são desfeitos preferindo o nome MAIS CURTO (ex.: "Word" > "Word Viewer").
 */
export function scoreAppMatch(spoken: string, candidate: string): number {
  if (!spoken || !candidate) return 0
  if (candidate === spoken) return 100
  if (candidate.startsWith(spoken + ' ')) return 86
  const candTokens = candidate.split(' ')
  const spokenTokens = spoken.split(' ')
  // Todas as palavras faladas aparecem como palavras do candidato ("studio code" -> "visual studio code").
  if (spokenTokens.every((t) => candTokens.includes(t))) return 78
  // Falado é substring do candidato ("spoti" -> "spotify").
  if (spoken.length >= 4 && candidate.includes(spoken)) return 66
  // Alguma palavra do candidato é quase igual ao falado (erro de transcrição: "spotifai").
  if (spoken.length >= 5) {
    const best = Math.min(...candTokens.map((t) => lev(t, spoken)), lev(candidate, spoken))
    if (best === 1) return 58
    if (best === 2 && spoken.length >= 7) return 46
  }
  return 0
}

/** Acha o melhor atalho para um nome falado; null se nada casar com confiança. */
export function matchShortcut(spoken: string, apps: StartMenuApp[]): StartMenuApp | null {
  const q = normalizeAppName(spoken)
  if (!q) return null
  let best: StartMenuApp | null = null
  let bestScore = 0
  let bestLen = Infinity
  for (const app of apps) {
    const cand = normalizeAppName(app.name)
    const score = scoreAppMatch(q, cand)
    if (score > bestScore || (score === bestScore && score > 0 && cand.length < bestLen)) {
      best = app
      bestScore = score
      bestLen = cand.length
    }
  }
  return bestScore >= 46 ? best : null
}

// Cache da varredura (a lista de apps muda raramente; 283 atalhos ~ alguns ms).
let cache: { ts: number; apps: StartMenuApp[] } | null = null
const CACHE_TTL_MS = 60_000

/** Lista (cacheada) dos apps do Menu Iniciar. Vazio fora do Windows. */
export function listStartMenuApps(): StartMenuApp[] {
  if (process.platform !== 'win32') return []
  const now = Date.now()
  if (cache && now - cache.ts < CACHE_TTL_MS) return cache.apps
  cache = { ts: now, apps: scanShortcuts(startMenuDirs()) }
  return cache.apps
}

/** Resolve um nome falado para um atalho instalado (Windows). */
export function findStartMenuApp(spoken: string): StartMenuApp | null {
  return matchShortcut(spoken, listStartMenuApps())
}

/** Apenas para testes: zera o cache da varredura. */
export function resetStartMenuCache(): void {
  cache = null
}
