import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Motor de proatividade (camada "ambiente" do JARVIS).
//
// Além dos lembretes/eventos AGENDADOS (que o notify.ts já dispara na hora exata),
// o Ares observa o ambiente e fala primeiro no momento certo: bateria fraca,
// evento chegando (heads-up) e tarefas vencidas. Tudo priorizado, com cooldown,
// horário de silêncio e um intervalo mínimo para não tagarelar.
//
// A decisão (`buildNudges`/`pickProactiveNudge`) é PURA e testável; o estado
// (último mostrado, último global) vive no notify.ts.
// ---------------------------------------------------------------------------

export interface BatteryInfo {
  present: boolean
  percent: number
  status: string
  charging: boolean
  discharging: boolean
  full: boolean
}

/** Lê uma bateria a partir de um diretório /sys/class/power_supply/BATx. Pura (fs). */
export function readBatteryFrom(dir: string): BatteryInfo {
  try {
    const percent = parseInt(readFileSync(join(dir, 'capacity'), 'utf8').trim(), 10)
    const status = readFileSync(join(dir, 'status'), 'utf8').trim()
    if (!Number.isFinite(percent)) return absent()
    return {
      present: true,
      percent: Math.max(0, Math.min(100, percent)),
      status,
      charging: /^charging/i.test(status),
      discharging: /discharging/i.test(status),
      full: /full/i.test(status)
    }
  } catch {
    return absent()
  }
}

function absent(): BatteryInfo {
  return { present: false, percent: 0, status: '', charging: false, discharging: false, full: false }
}

/** Detecta e lê a primeira bateria do sistema (desktop sem bateria -> present:false). */
export function readBattery(base = '/sys/class/power_supply'): BatteryInfo {
  try {
    const bats = readdirSync(base)
      .filter((n) => /^BAT/i.test(n))
      .sort()
    for (const b of bats) {
      const info = readBatteryFrom(join(base, b))
      if (info.present) return info
    }
  } catch {
    /* sem /sys (não-Linux) ou sem bateria */
  }
  return absent()
}

export interface ProactiveEvent {
  id: string
  title: string
  whenISO: string
  remindMinutes?: number
}

export interface ProactiveState {
  now: number
  battery: BatteryInfo
  events: ProactiveEvent[]
  overdueCount: number
  eventHeadsUpMin: number
}

export interface ProactiveNudge {
  id: string // id estável para o cooldown
  kind: 'battery' | 'event' | 'tasks'
  text: string // falável
  priority: number // maior = mais importante
  cooldownMs: number
}

export const CRITICAL_PRIORITY = 100

/** Monta os avisos candidatos a partir do estado (sem decidir cooldown/silêncio). Pura. */
export function buildNudges(s: ProactiveState): ProactiveNudge[] {
  const out: ProactiveNudge[] = []
  const b = s.battery

  if (b.present && b.discharging) {
    if (b.percent <= 10) {
      out.push({
        id: 'battery-critical',
        kind: 'battery',
        text: `Senhor, a bateria está crítica, em ${b.percent}%. Conecte o carregador.`,
        priority: CRITICAL_PRIORITY,
        cooldownMs: 5 * 60_000
      })
    } else if (b.percent <= 20) {
      out.push({
        id: 'battery-low',
        kind: 'battery',
        text: `A bateria está em ${b.percent}%. Talvez seja bom conectar o carregador.`,
        priority: 60,
        cooldownMs: 20 * 60_000
      })
    }
  }
  if (b.present && b.charging && b.percent >= 97) {
    out.push({
      id: 'battery-full',
      kind: 'battery',
      text: 'A bateria já está quase cheia, pode desconectar o carregador quando quiser.',
      priority: 30,
      cooldownMs: 60 * 60_000
    })
  }

  // Heads-up de eventos SEM lembrete configurado (os com lead já são avisados pelo notify).
  for (const e of s.events) {
    if (e.remindMinutes) continue
    const t = new Date(e.whenISO).getTime()
    if (!Number.isFinite(t)) continue
    const mins = Math.round((t - s.now) / 60_000)
    if (mins >= 0 && mins <= s.eventHeadsUpMin) {
      const quando = mins <= 1 ? 'já já' : `em ${mins} minutos`
      out.push({
        id: `event-${e.id}`,
        kind: 'event',
        text: `Senhor, ${quando}: ${e.title}.`,
        priority: 70,
        cooldownMs: 6 * 60 * 60_000
      })
    }
  }

  if (s.overdueCount > 0) {
    out.push({
      id: 'overdue',
      kind: 'tasks',
      text: `Você tem ${s.overdueCount} ${s.overdueCount === 1 ? 'tarefa vencida' : 'tarefas vencidas'}.`,
      priority: 20,
      cooldownMs: 4 * 60 * 60_000
    })
  }

  return out
}

function isQuietHour(now: number): boolean {
  const h = new Date(now).getHours()
  return h >= 22 || h < 7
}

/**
 * Escolhe O aviso a falar agora (ou null). Respeita cooldown por id, horário de
 * silêncio (22h–7h só passa crítico) e um intervalo mínimo entre avisos (idem).
 */
export function pickProactiveNudge(
  s: ProactiveState,
  lastShown: Record<string, number>,
  lastAny: number,
  minIntervalMs: number
): ProactiveNudge | null {
  const candidates = buildNudges(s)
    .filter((n) => !(lastShown[n.id] && s.now - lastShown[n.id] < n.cooldownMs))
    .sort((a, b) => b.priority - a.priority)

  for (const n of candidates) {
    const critical = n.priority >= CRITICAL_PRIORITY
    if (isQuietHour(s.now) && !critical) continue
    if (s.now - lastAny < minIntervalMs && !critical) continue
    return n
  }
  return null
}
