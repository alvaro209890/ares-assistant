import { spawn, spawnSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import type { AppConfig, DesktopActionResult } from '../shared/types'

// ---------------------------------------------------------------------------
// Controle do computador (estilo JARVIS): abrir apps/sites, volume, bloquear a
// tela, captura de tela. São ações SEGURAS e instantâneas (sem autorização por
// voz, ao contrário do terminal) — feitas com binários conhecidos, sem shell.
// Lógica de construção de comando é pura (testável); a execução usa spawn.
// Este módulo NÃO importa electron (a escrita na área de transferência fica em
// system.ts), para poder ser testado fora do processo principal.
// ---------------------------------------------------------------------------

type WhichFn = (tool: string) => boolean

const realWhich: WhichFn = (tool) => {
  try {
    return spawnSync('which', [tool], { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
}

function controlConfig(cfg: AppConfig): AppConfig['integrations']['control'] {
  return cfg.integrations.control
}

function ensureEnabled(cfg: AppConfig): void {
  if (controlConfig(cfg).enabled === false) throw new Error('Controle do computador desativado nas Configurações.')
}

// --- Abrir app / site / arquivo -------------------------------------------

const APP_ALIASES: Record<string, string[]> = {
  firefox: ['firefox'],
  chrome: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
  'google chrome': ['google-chrome', 'google-chrome-stable'],
  chromium: ['chromium', 'chromium-browser'],
  navegador: ['firefox', 'google-chrome', 'chromium'],
  vscode: ['code'],
  'vs code': ['code'],
  code: ['code'],
  editor: ['code'],
  calculadora: ['gnome-calculator', 'kcalc', 'galculator'],
  arquivos: ['nemo', 'nautilus', 'dolphin', 'thunar'],
  explorador: ['nemo', 'nautilus', 'dolphin', 'thunar'],
  terminal: ['gnome-terminal', 'konsole', 'xterm', 'x-terminal-emulator']
}

export interface OpenPlan {
  kind: 'url' | 'app' | 'path' | 'error'
  cmd?: string
  args?: string[]
  label?: string
  detail?: string
}

/** Decide COMO abrir o alvo (sem executar). Pura: testável com um `which` injetado. */
export function resolveOpenTarget(target: string, which: WhichFn = realWhich): OpenPlan {
  const raw = String(target || '').trim()
  if (!raw) return { kind: 'error', detail: 'diga o que devo abrir' }

  // Esquema explícito (algo:...): só permite navegação/arquivo seguros.
  const scheme = raw.match(/^([a-zA-Z][\w+.-]*):/)
  if (scheme) {
    const s = scheme[1].toLowerCase()
    if (/^(https?|file|mailto|ftp)$/.test(s)) return { kind: 'url', cmd: 'xdg-open', args: [raw], label: raw }
    return { kind: 'error', detail: `esquema não permitido: ${s}:` }
  }

  const lower = raw.toLowerCase()

  // Domínio sem esquema (youtube.com, github.com/x) -> https://
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw)) {
    const url = `https://${raw}`
    return { kind: 'url', cmd: 'xdg-open', args: [url], label: url }
  }

  // Aplicativo por apelido conhecido.
  const alias = APP_ALIASES[lower]
  if (alias) {
    const bin = alias.find((b) => which(b))
    return bin
      ? { kind: 'app', cmd: bin, args: [], label: lower }
      : { kind: 'error', detail: `nenhum aplicativo encontrado para "${lower}"` }
  }

  // Caminho existente (absoluto ou relativo ao HOME).
  const path = isAbsolute(raw) ? raw : resolve(homedir(), raw)
  if (existsSync(path)) return { kind: 'path', cmd: 'xdg-open', args: [path], label: path }

  // Binário direto no PATH.
  if (/^[\w.+-]+$/.test(raw) && which(raw)) return { kind: 'app', cmd: raw, args: [], label: raw }

  // Último recurso: deixa o xdg-open tentar resolver (nome de .desktop, etc.).
  if (/^[\w.+ -]+$/.test(raw)) return { kind: 'app', cmd: 'xdg-open', args: [raw], label: raw }

  return { kind: 'error', detail: `não consegui interpretar "${raw}"` }
}

export function runOpen(cfg: AppConfig, target: string): DesktopActionResult {
  ensureEnabled(cfg)
  const plan = resolveOpenTarget(target)
  if (plan.kind === 'error') return { ok: false, action: 'abrir', detail: plan.detail || 'não foi possível abrir' }
  try {
    const child = spawn(plan.cmd as string, plan.args as string[], { detached: true, stdio: 'ignore' })
    child.on('error', () => {}) // não derruba o app se o binário falhar
    child.unref()
    return { ok: true, action: 'abrir', detail: `abrindo ${plan.label}`, target: plan.label }
  } catch (e) {
    return { ok: false, action: 'abrir', detail: e instanceof Error ? e.message : String(e) }
  }
}

// --- Volume ----------------------------------------------------------------

export type VolumeBackend = 'wpctl' | 'pactl' | 'amixer'
export type VolumeAction = 'set' | 'up' | 'down' | 'mute' | 'unmute' | 'toggle'

export function audioBackend(which: WhichFn = realWhich): VolumeBackend | null {
  if (which('wpctl')) return 'wpctl'
  if (which('pactl')) return 'pactl'
  if (which('amixer')) return 'amixer'
  return null
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)))
const STEP = 5

export interface VolumePlan {
  cmd: string
  args: string[]
}

/** Monta o comando de volume para o backend (sem executar). Pura: testável. */
export function buildVolume(backend: VolumeBackend, opts: { action: VolumeAction; level?: number }): VolumePlan {
  const lvl = clampPct(Number(opts.level))
  if (backend === 'wpctl') {
    const sink = '@DEFAULT_AUDIO_SINK@'
    switch (opts.action) {
      case 'set': return { cmd: 'wpctl', args: ['set-volume', '-l', '1.0', sink, `${lvl}%`] }
      case 'up': return { cmd: 'wpctl', args: ['set-volume', '-l', '1.0', sink, `${STEP}%+`] }
      case 'down': return { cmd: 'wpctl', args: ['set-volume', sink, `${STEP}%-`] }
      case 'mute': return { cmd: 'wpctl', args: ['set-mute', sink, '1'] }
      case 'unmute': return { cmd: 'wpctl', args: ['set-mute', sink, '0'] }
      case 'toggle': return { cmd: 'wpctl', args: ['set-mute', sink, 'toggle'] }
    }
  }
  if (backend === 'pactl') {
    const sink = '@DEFAULT_SINK@'
    switch (opts.action) {
      case 'set': return { cmd: 'pactl', args: ['set-sink-volume', sink, `${lvl}%`] }
      case 'up': return { cmd: 'pactl', args: ['set-sink-volume', sink, `+${STEP}%`] }
      case 'down': return { cmd: 'pactl', args: ['set-sink-volume', sink, `-${STEP}%`] }
      case 'mute': return { cmd: 'pactl', args: ['set-sink-mute', sink, '1'] }
      case 'unmute': return { cmd: 'pactl', args: ['set-sink-mute', sink, '0'] }
      case 'toggle': return { cmd: 'pactl', args: ['set-sink-mute', sink, 'toggle'] }
    }
  }
  // amixer (ALSA)
  switch (opts.action) {
    case 'set': return { cmd: 'amixer', args: ['-q', 'set', 'Master', `${lvl}%`] }
    case 'up': return { cmd: 'amixer', args: ['-q', 'set', 'Master', `${STEP}%+`] }
    case 'down': return { cmd: 'amixer', args: ['-q', 'set', 'Master', `${STEP}%-`] }
    case 'mute': return { cmd: 'amixer', args: ['-q', 'set', 'Master', 'mute'] }
    case 'unmute': return { cmd: 'amixer', args: ['-q', 'set', 'Master', 'unmute'] }
    case 'toggle': return { cmd: 'amixer', args: ['-q', 'set', 'Master', 'toggle'] }
  }
  throw new Error(`ação de volume inválida: ${opts.action}`)
}

/** Lê o volume atual (0..100) para confirmar a fala. Best-effort. */
export function readVolumePercent(backend: VolumeBackend): number | null {
  try {
    if (backend === 'wpctl') {
      const r = spawnSync('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@'], { encoding: 'utf8', timeout: 4000 })
      const m = String(r.stdout).match(/Volume:\s*([0-9.]+)/)
      if (m) return clampPct(parseFloat(m[1]) * 100)
    } else if (backend === 'pactl') {
      const r = spawnSync('pactl', ['get-sink-volume', '@DEFAULT_SINK@'], { encoding: 'utf8', timeout: 4000 })
      const m = String(r.stdout).match(/(\d+)%/)
      if (m) return clampPct(parseInt(m[1], 10))
    } else {
      const r = spawnSync('amixer', ['get', 'Master'], { encoding: 'utf8', timeout: 4000 })
      const m = String(r.stdout).match(/\[(\d+)%\]/)
      if (m) return clampPct(parseInt(m[1], 10))
    }
  } catch {
    /* leitura é opcional */
  }
  return null
}

export function runVolume(cfg: AppConfig, opts: { action: VolumeAction; level?: number }): DesktopActionResult {
  ensureEnabled(cfg)
  const backend = audioBackend()
  if (!backend) return { ok: false, action: 'volume', detail: 'não encontrei controle de áudio (pactl/wpctl/amixer)' }
  let plan: VolumePlan
  try {
    plan = buildVolume(backend, opts)
  } catch (e) {
    return { ok: false, action: 'volume', detail: e instanceof Error ? e.message : String(e) }
  }
  const r = spawnSync(plan.cmd, plan.args, { encoding: 'utf8', timeout: 5000 })
  const ok = r.status === 0
  if (!ok) return { ok, action: 'volume', detail: String(r.stderr || r.error?.message || 'falha ao ajustar volume') }
  if (opts.action === 'mute') return { ok, action: 'volume', detail: 'som mudo' }
  if (opts.action === 'unmute') return { ok, action: 'volume', detail: 'som religado' }
  const pct = readVolumePercent(backend)
  return { ok, action: 'volume', detail: pct != null ? `volume em ${pct}%` : 'volume ajustado', value: pct ?? undefined }
}

// --- Bloquear a tela -------------------------------------------------------

export function runLock(cfg: AppConfig): DesktopActionResult {
  ensureEnabled(cfg)
  const tries: Array<[string, string[]]> = [
    ['loginctl', ['lock-session']],
    ['cinnamon-screensaver-command', ['--lock']],
    ['xdg-screensaver', ['lock']],
    ['gnome-screensaver-command', ['--lock']]
  ]
  for (const [cmd, args] of tries) {
    if (!realWhich(cmd)) continue
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 })
    if (r.status === 0) return { ok: true, action: 'bloquear', detail: 'tela bloqueada' }
  }
  return { ok: false, action: 'bloquear', detail: 'não encontrei como bloquear a tela' }
}

// --- Captura de tela -------------------------------------------------------

export function runScreenshot(cfg: AppConfig): DesktopActionResult {
  ensureEnabled(cfg)
  const dir = controlConfig(cfg).screenshotDir || join(homedir(), 'Pictures')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* segue: se falhar, o comando reporta */
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `ares-${stamp}.png`)
  const tries: Array<[string, string[]]> = [
    ['gnome-screenshot', ['-f', file]],
    ['grim', [file]],
    ['spectacle', ['-b', '-n', '-o', file]],
    ['scrot', [file]]
  ]
  for (const [cmd, args] of tries) {
    if (!realWhich(cmd)) continue
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000 })
    if (r.status === 0 && existsSync(file)) return { ok: true, action: 'captura', detail: `captura salva em ${file}`, target: file }
  }
  return { ok: false, action: 'captura', detail: 'não encontrei ferramenta de captura (gnome-screenshot/grim/scrot)' }
}

export function controlPromptContext(cfg: AppConfig): string {
  if (controlConfig(cfg).enabled === false) return 'Controle do computador: desativado nas Configurações.'
  const backend = audioBackend()
  return `Controle do computador: ativado — abrir apps/sites, volume (${backend || 'sem backend de áudio'}), bloquear tela, captura de tela e escrever na área de transferência.`
}
