import { spawn, spawnSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import { findStartMenuApp, type StartMenuApp } from './apps'
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
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    return spawnSync(cmd, [tool], { encoding: 'utf8', timeout: 4000 }).status === 0
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

const APP_ALIASES_LINUX: Record<string, string[]> = {
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

const APP_ALIASES_WIN: Record<string, string[]> = {
  firefox: ['firefox'],
  chrome: ['chrome'],
  'google chrome': ['chrome'],
  edge: ['msedge'],
  'microsoft edge': ['msedge'],
  navegador: ['chrome', 'firefox', 'msedge'],
  vscode: ['code'],
  'vs code': ['code'],
  code: ['code'],
  editor: ['code', 'notepad'],
  'bloco de notas': ['notepad'],
  notepad: ['notepad'],
  paint: ['mspaint'],
  calculadora: ['calc'],
  arquivos: ['explorer'],
  explorador: ['explorer'],
  'gerenciador de tarefas': ['taskmgr'],
  'prompt de comando': ['cmd'],
  terminal: ['wt', 'powershell', 'cmd'],
  // Apps de loja/instalados: raramente estão no PATH — o casamento cai no Menu
  // Iniciar (ver resolveOpenTarget); o apelido garante o nome canônico da busca.
  word: ['winword'],
  excel: ['excel'],
  powerpoint: ['powerpnt'],
  spotify: ['spotify'],
  whatsapp: ['whatsapp'],
  discord: ['discord'],
  telegram: ['telegram'],
  steam: ['steam'],
  vlc: ['vlc']
}

// "Abra as configurações" -> painel moderno do Windows (URL ms-settings:).
const SETTINGS_ALIASES = new Set(['configuracoes', 'configurações', 'ajustes', 'configuracao', 'configuração'])

const APP_ALIASES: Record<string, string[]> =
  process.platform === 'win32' ? APP_ALIASES_WIN : APP_ALIASES_LINUX

export interface OpenPlan {
  kind: 'url' | 'app' | 'path' | 'error'
  cmd?: string
  args?: string[]
  label?: string
  detail?: string
}

type FindAppFn = (name: string) => StartMenuApp | null

const realFindApp: FindAppFn = (name) => (process.platform === 'win32' ? findStartMenuApp(name) : null)

/** Decide COMO abrir o alvo (sem executar). Pura: testável com `which`/`findApp` injetados. */
export function resolveOpenTarget(
  target: string,
  which: WhichFn = realWhich,
  findApp: FindAppFn = realFindApp,
  workspaceRoot?: string
): OpenPlan {
  const raw = String(target || '').trim()
  if (!raw) return { kind: 'error', detail: 'diga o que devo abrir' }

  const opener = process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const openArgs = (target: string): string[] =>
    process.platform === 'win32' ? ['/c', 'start', '', target] : [target]

  // Esquema explícito (algo:...): só permite navegação/arquivo seguros.
  // Esquema explícito (algo:...): só permite navegação/arquivo seguros.
  // Evitamos confundir letra de unidade do Windows (C:\...) como esquema de URL.
  const isWindowsDrive = /^[a-zA-Z]:[\\/]/u.test(raw)
  const scheme = !isWindowsDrive && raw.match(/^([a-zA-Z][\w+.-]*):/)
  if (scheme) {
    const s = scheme[1].toLowerCase()
    if (/^(https?|file|mailto|ftp|ms-settings)$/.test(s))
      return { kind: 'url', cmd: opener, args: openArgs(raw), label: raw }
    return { kind: 'error', detail: `esquema não permitido: ${s}:` }
  }

  const lower = raw.toLowerCase()

  // "Configurações" no Windows abre o painel moderno via ms-settings:.
  if (process.platform === 'win32' && SETTINGS_ALIASES.has(lower)) {
    return { kind: 'url', cmd: opener, args: openArgs('ms-settings:'), label: 'configurações' }
  }

  // Domínio sem esquema (youtube.com, github.com/x) -> https://
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw)) {
    const url = `https://${raw}`
    return { kind: 'url', cmd: opener, args: openArgs(url), label: url }
  }

  // Atalho do Menu Iniciar (Windows): abre via `start "" caminho.lnk`.
  const fromMenu = (name: string): OpenPlan | null => {
    const app = findApp(name)
    return app ? { kind: 'app', cmd: opener, args: openArgs(app.path), label: app.name } : null
  }

  // Aplicativo por apelido conhecido: binário no PATH primeiro; senão, Menu Iniciar
  // (cobre Word/Spotify/WhatsApp etc., que não ficam no PATH).
  const alias = APP_ALIASES[lower]
  if (alias) {
    const bin = alias.find((b) => which(b))
    if (bin) return { kind: 'app', cmd: bin, args: [], label: lower }
    const viaMenu = fromMenu(lower) || alias.map(fromMenu).find(Boolean)
    if (viaMenu) return viaMenu
    return { kind: 'error', detail: `nenhum aplicativo encontrado para "${lower}"` }
  }

  // Caminho existente (absoluto ou relativo ao workspace/HOME).
  let path = raw
  if (!isAbsolute(raw)) {
    if (workspaceRoot && existsSync(resolve(workspaceRoot, raw))) {
      path = resolve(workspaceRoot, raw)
    } else if (existsSync(resolve(process.cwd(), raw))) {
      path = resolve(process.cwd(), raw)
    } else {
      path = resolve(homedir(), raw)
    }
  }
  if (existsSync(path)) return { kind: 'path', cmd: opener, args: openArgs(path), label: path }

  // Binário direto no PATH.
  if (/^[\w.+-]+$/.test(raw) && which(raw)) return { kind: 'app', cmd: raw, args: [], label: raw }

  // Qualquer app instalado, pelo nome falado (Menu Iniciar, com tolerância a erros).
  const viaMenu = fromMenu(raw)
  if (viaMenu) return viaMenu

  // Último recurso: deixa o sistema tentar resolver (App Paths no Windows).
  if (/^[\w.+ -]+$/.test(raw)) return { kind: 'app', cmd: opener, args: openArgs(raw), label: raw }

  return { kind: 'error', detail: `não consegui interpretar "${raw}"` }
}

export function runOpen(cfg: AppConfig, target: string): DesktopActionResult {
  ensureEnabled(cfg)
  const workspaceRoot = cfg.integrations.code?.workspaceRoot
  const plan = resolveOpenTarget(target, realWhich, realFindApp, workspaceRoot)
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

export type VolumeBackend = 'wpctl' | 'pactl' | 'amixer' | 'powershell'
export type VolumeAction = 'set' | 'up' | 'down' | 'mute' | 'unmute' | 'toggle'

export function audioBackend(which: WhichFn = realWhich): VolumeBackend | null {
  if (process.platform === 'win32') return 'powershell'
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
  if (backend === 'powershell') {
    const ps = (script: string): VolumePlan => ({
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', script]
    })
    const sendKey = (key: string): VolumePlan => ps(
      `$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]${key})`
    )
    switch (opts.action) {
      case 'set': return ps(
        `$v = (New-Object -ComObject MMDeviceEnumerator.MMDeviceEnumerator).GetDefaultAudioEndpoint(0,1).AudioEndpointVolume; $v.MasterVolumeLevelScalar = ${lvl / 100}; if($v.Mute){$v.Mute = $false}`
      )
      case 'up': return sendKey('0xAF')
      case 'down': return sendKey('0xAE')
      case 'mute': case 'unmute': case 'toggle': return sendKey('0xAD')
    }
  }
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
    if (backend === 'powershell') {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '(New-Object -ComObject MMDeviceEnumerator.MMDeviceEnumerator).GetDefaultAudioEndpoint(0,1).AudioEndpointVolume.MasterVolumeLevelScalar * 100'
      ], { encoding: 'utf8', timeout: 4000 })
      const m = String(r.stdout).match(/([0-9.]+)/)
      if (m) return clampPct(parseFloat(m[1]))
    } else if (backend === 'wpctl') {
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
  if (process.platform === 'win32') {
    const r = spawnSync('rundll32.exe', ['user32.dll,LockWorkStation'], { encoding: 'utf8', timeout: 5000 })
    return r.status === 0
      ? { ok: true, action: 'bloquear', detail: 'tela bloqueada' }
      : { ok: false, action: 'bloquear', detail: 'falha ao bloquear a tela' }
  }
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
  const dir = controlConfig(cfg).screenshotDir || join(homedir(), process.platform === 'win32' ? 'Pictures' : 'Pictures')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* segue: se falhar, o comando reporta */
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `ares-${stamp}.png`)
  if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${file.replace(/'/g, "''")}'); $g.Dispose(); $bmp.Dispose()`
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 15000 })
    if (r.status === 0 && existsSync(file)) return { ok: true, action: 'captura', detail: `captura salva em ${file}`, target: file }
    return { ok: false, action: 'captura', detail: String(r.stderr || r.error?.message || 'falha na captura de tela') }
  }
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

// --- Mídia (play/pause/próxima/anterior) -----------------------------------

export type MediaBackend = 'playerctl' | 'dbus' | 'winkeys'
export type MediaAction = 'playpause' | 'play' | 'pause' | 'next' | 'previous' | 'stop'

export function mediaBackend(which: WhichFn = realWhich): MediaBackend | null {
  if (process.platform === 'win32') return 'winkeys'
  if (which('playerctl')) return 'playerctl'
  if (which('dbus-send')) return 'dbus'
  return null
}

const PLAYERCTL_VERB: Record<MediaAction, string> = {
  playpause: 'play-pause',
  play: 'play',
  pause: 'pause',
  next: 'next',
  previous: 'previous',
  stop: 'stop'
}
const MPRIS_METHOD: Record<MediaAction, string> = {
  playpause: 'PlayPause',
  play: 'Play',
  pause: 'Pause',
  next: 'Next',
  previous: 'Previous',
  stop: 'Stop'
}

export interface MediaPlan {
  cmd: string
  args: string[]
}

/** Monta o comando de mídia (sem executar). Para dbus precisa do bus name do player. Pura. */
export function buildMedia(backend: MediaBackend, action: MediaAction, player = ''): MediaPlan {
  if (backend === 'playerctl') return { cmd: 'playerctl', args: [PLAYERCTL_VERB[action]] }
  return {
    cmd: 'dbus-send',
    args: [
      '--type=method_call',
      `--dest=${player}`,
      '/org/mpris/MediaPlayer2',
      `org.mpris.MediaPlayer2.Player.${MPRIS_METHOD[action]}`
    ]
  }
}

/** Lista players MPRIS ativos no barramento (executor). */
export function mprisPlayers(): string[] {
  try {
    const r = spawnSync(
      'dbus-send',
      ['--print-reply', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.ListNames'],
      { encoding: 'utf8', timeout: 4000 }
    )
    const out = String(r.stdout || '')
    const found = out.match(/org\.mpris\.MediaPlayer2\.[\w.-]+/g) || []
    return Array.from(new Set(found))
  } catch {
    return []
  }
}

export function runMedia(cfg: AppConfig, action: MediaAction): DesktopActionResult {
  ensureEnabled(cfg)
  const backend = mediaBackend()
  if (!backend) return { ok: false, action: 'midia', detail: 'não encontrei controle de mídia (playerctl/dbus)' }
  const label: Record<MediaAction, string> = {
    playpause: 'play/pause',
    play: 'tocando',
    pause: 'pausado',
    next: 'próxima faixa',
    previous: 'faixa anterior',
    stop: 'parado'
  }
  if (backend === 'winkeys') {
    const keyMap: Record<MediaAction, string> = {
      playpause: '0xB3', play: '0xB3', pause: '0xB3',
      next: '0xB0', previous: '0xB1', stop: '0xB2'
    }
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]${keyMap[action]})`
    ], { encoding: 'utf8', timeout: 5000 })
    const ok = r.status === 0
    return { ok, action: 'midia', detail: ok ? label[action] : String(r.stderr || r.error?.message || 'falha na mídia') }
  }
  let plan: MediaPlan
  if (backend === 'dbus') {
    const players = mprisPlayers()
    if (!players.length) return { ok: false, action: 'midia', detail: 'nenhum player de mídia ativo no momento' }
    plan = buildMedia('dbus', action, players[0])
  } else {
    plan = buildMedia('playerctl', action)
  }
  const r = spawnSync(plan.cmd, plan.args, { encoding: 'utf8', timeout: 5000 })
  const ok = r.status === 0
  return { ok, action: 'midia', detail: ok ? label[action] : String(r.stderr || r.error?.message || 'falha na mídia') }
}

// --- Brilho da tela (xrandr, brilho de software no X11) ---------------------

export type BrightnessAction = 'set' | 'up' | 'down'
const BR_STEP = 0.1
const clampBrightness = (n: number): number => Math.max(0.1, Math.min(1, Math.round(n * 100) / 100))

export function xrandrOutputs(): string[] {
  try {
    const r = spawnSync('xrandr', ['--current'], { encoding: 'utf8', timeout: 4000 })
    return (String(r.stdout || '').match(/^(\S+) connected/gm) || []).map((l) => l.split(' ')[0])
  } catch {
    return []
  }
}

export function readBrightness(): number | null {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness'
      ], { encoding: 'utf8', timeout: 4000 })
      const m = String(r.stdout || '').match(/(\d+)/)
      if (m) return clampPct(parseInt(m[1], 10))
      return null
    }
    const r = spawnSync('xrandr', ['--verbose'], { encoding: 'utf8', timeout: 4000 })
    const m = String(r.stdout || '').match(/Brightness:\s*([0-9.]+)/i)
    if (m) return clampBrightness(parseFloat(m[1]))
  } catch {
    /* opcional */
  }
  return null
}

export interface BrightnessPlan {
  cmd: string
  args: string[]
  fraction: number
}

/** Monta o comando de brilho (sem executar). Para up/down usa `current`. Pura. */
export function buildBrightness(output: string, opts: { action: BrightnessAction; level?: number; current?: number }): BrightnessPlan {
  const cur = Number.isFinite(opts.current as number) ? (opts.current as number) : 1
  let frac: number
  if (opts.action === 'set') frac = clampBrightness((Number(opts.level) || 0) / 100)
  else if (opts.action === 'up') frac = clampBrightness(cur + BR_STEP)
  else frac = clampBrightness(cur - BR_STEP)
  return { cmd: 'xrandr', args: ['--output', output, '--brightness', frac.toFixed(2)], fraction: frac }
}

export function runBrightness(cfg: AppConfig, opts: { action: BrightnessAction; level?: number }): DesktopActionResult {
  ensureEnabled(cfg)
  if (process.platform === 'win32') {
    const cur = opts.action === 'set' ? undefined : readBrightness() ?? 100
    let pct: number
    if (opts.action === 'set') pct = clampPct(Number(opts.level) || 0)
    else if (opts.action === 'up') pct = clampPct((cur ?? 100) + 10)
    else pct = clampPct((cur ?? 100) - 10)
    const ps = `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${pct})`
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 5000 })
    const ok = r.status === 0
    return { ok, action: 'brilho', detail: ok ? `brilho em ${pct}%` : 'controle de brilho indisponível (apenas notebooks)', value: pct }
  }
  if (!realWhich('xrandr')) return { ok: false, action: 'brilho', detail: 'controle de brilho indisponível (sem xrandr)' }
  const output = xrandrOutputs()[0]
  if (!output) return { ok: false, action: 'brilho', detail: 'não encontrei a saída de vídeo' }
  const current = opts.action === 'set' ? undefined : readBrightness() ?? 1
  const plan = buildBrightness(output, { ...opts, current })
  const r = spawnSync(plan.cmd, plan.args, { encoding: 'utf8', timeout: 5000 })
  const ok = r.status === 0
  const pct = Math.round(plan.fraction * 100)
  return { ok, action: 'brilho', detail: ok ? `brilho em ${pct}%` : String(r.stderr || r.error?.message || 'falha no brilho'), value: pct }
}

export function controlPromptContext(cfg: AppConfig): string {
  if (controlConfig(cfg).enabled === false) return 'Controle do computador: desativado nas Configurações.'
  const audio = audioBackend()
  const media = mediaBackend()
  const openScope = process.platform === 'win32' ? 'abrir QUALQUER app instalado (Menu Iniciar) e sites' : 'abrir apps/sites'
  return `Controle do computador: ativado (${process.platform === 'win32' ? 'Windows' : 'Linux'}) — ${openScope}, volume (${audio || 'sem áudio'}), mídia (${media ? 'play/pause/próxima' : 'indisponível'}), brilho da tela, bloquear tela, captura de tela e escrever na área de transferência.`
}
