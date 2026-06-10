import { Notification, BrowserWindow } from 'electron'
import { loadBoard, saveBoard } from './tasks'
import { loadEvents, setEvents, loadReminders, setReminders } from './data'
import { advanceISO } from './board'
import { readConfig } from './config'
import { pickProactiveNudge, readBattery, type ProactiveWeather, type SystemHealthState } from './proactive'
import { getWeather, getWeatherAt } from './tools'
import { getSystemMetrics } from './system'
import { getRecentLogs } from './logger'
import type { AppConfig } from '../shared/types'

// Lembretes locais: varre periodicamente tarefas (reminderAt) e eventos (whenISO).
// Ao chegar a hora, mostra notificação nativa e avisa o renderer (que fala, se a
// voz estiver ativa). Marca como "reminded" para não repetir. Além disso, uma
// camada proativa observa o ambiente (bateria, evento chegando, tarefas vencidas).

let timer: ReturnType<typeof setInterval> | null = null
let getWindow: (() => BrowserWindow | null) | null = null

// Estado da camada proativa (cooldown por aviso + último aviso global).
const proactiveLastShown: Record<string, number> = {}
let proactiveLastAny = 0
const PROACTIVE_MIN_INTERVAL = 8 * 60_000

// Cache de clima para o heads-up matinal (atualizado no máximo a cada 30 min).
let weatherCache: ProactiveWeather | null = null
let weatherAt = 0
async function refreshWeather(cfg: AppConfig): Promise<void> {
  if (Date.now() - weatherAt < 30 * 60_000) return
  weatherAt = Date.now() // marca antes para não disparar várias buscas simultâneas
  try {
    const loc = cfg.integrations.location
    const w =
      loc.enabled && typeof loc.latitude === 'number'
        ? await getWeatherAt(loc)
        : await getWeather(cfg.integrations.weatherCity)
    weatherCache = { rainProbToday: w.today?.precipProb ?? 0, alert: w.alert }
  } catch {
    /* mantém o cache anterior em caso de falha de rede */
  }
}

/** Mostra uma notificação nativa e avisa o renderer (que fala, se a voz estiver ativa). */
function emit(body: string): void {
  try {
    if (Notification.isSupported()) new Notification({ title: 'ARES', body, silent: false }).show()
  } catch {
    /* ignora */
  }
  const win = getWindow?.()
  if (win && !win.isDestroyed()) win.webContents.send('reminder:fired', { prefix: '', title: body, body })
}

function fire(prefix: string, title: string): void {
  emit(`${prefix}: ${title}`)
}

// Monitor de saúde do sistema: CPU alta precisa ser SUSTENTADA (3 ticks ≈ 1,5 min)
// e só erros NOVOS no registro contam — senão o mesmo erro antigo alertaria sempre.
const CPU_HIGH_THRESHOLD = 85
let cpuHighStreak = 0
let lastLogErrorCount = -1 // -1 = primeira leitura (vira linha de base, sem alerta)

function readSystemHealth(): SystemHealthState {
  let cpuPercent = 0
  let memPercent = 0
  try {
    const m = getSystemMetrics()
    cpuPercent = m.cpuPercent
    memPercent = m.memPercent
  } catch {
    /* telemetria é opcional */
  }
  cpuHighStreak = cpuPercent >= CPU_HIGH_THRESHOLD ? cpuHighStreak + 1 : 0

  let newLogErrors = 0
  try {
    const errors = getRecentLogs(200).filter((l) => l.includes('[ERROR]')).length
    if (lastLogErrorCount >= 0 && errors > lastLogErrorCount) newLogErrors = errors - lastLogErrorCount
    lastLogErrorCount = errors
  } catch {
    /* sem registro disponível */
  }
  return { cpuPercent, cpuHighStreak, memPercent, newLogErrors }
}

/** Camada proativa: escolhe no máximo um aviso de ambiente e o anuncia. */
function proactiveTick(now: number, board: ReturnType<typeof loadBoard>, events: ReturnType<typeof loadEvents>): void {
  const cfg = readConfig()
  if (cfg.ui.proactiveAlerts === false) return
  void refreshWeather(cfg) // atualiza o clima em segundo plano (throttled)
  const overdueCount = Object.values(board.cards).filter(
    (c) => !c.done && c.due && new Date(c.due).getTime() < now
  ).length
  const nudge = pickProactiveNudge(
    {
      now,
      battery: readBattery(),
      events: events.map((e) => ({ id: e.id, title: e.title, whenISO: e.whenISO, remindMinutes: e.remindMinutes })),
      overdueCount,
      eventHeadsUpMin: 10,
      weather: weatherCache,
      health: readSystemHealth()
    },
    proactiveLastShown,
    proactiveLastAny,
    PROACTIVE_MIN_INTERVAL
  )
  if (nudge) {
    emit(nudge.text)
    proactiveLastShown[nudge.id] = now
    proactiveLastAny = now
  }
}

function tick(): void {
  const now = Date.now()

  const board = loadBoard()
  let changedBoard = false
  for (const id of Object.keys(board.cards)) {
    const c = board.cards[id]
    if (c.reminderAt && !c.reminded && !c.done && new Date(c.reminderAt).getTime() <= now) {
      fire('Lembrete de tarefa', c.title)
      c.reminded = true
      changedBoard = true
    }
  }
  if (changedBoard) saveBoard(board)

  const events = loadEvents()
  let changedEvents = false
  for (const e of events) {
    const lead = (e.remindMinutes || 0) * 60_000
    const fireAt = new Date(e.whenISO).getTime() - lead
    if (!e.reminded && fireAt <= now) {
      const when = new Date(e.whenISO).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      fire(e.remindMinutes ? `Evento em ${e.remindMinutes} min` : 'Evento', `${e.title} (${when})`)
      if (e.recurrence && e.recurrence !== 'none') {
        // Recorrente: reagenda para a próxima ocorrência em vez de silenciar.
        e.whenISO = advanceISO(e.whenISO, e.recurrence)
        e.reminded = false
      } else {
        e.reminded = true
      }
      changedEvents = true
    }
  }
  if (changedEvents) setEvents(events)

  // Lembretes (remédio/rotina, timers, despertadores)
  const reminders = loadReminders()
  let changedReminders = false
  for (const r of reminders) {
    if (!r.fired && new Date(r.whenISO).getTime() <= now) {
      const prefix = r.kind === 'timer' ? 'Timer' : r.kind === 'alarm' ? 'Despertador' : 'Lembrete'
      fire(prefix, r.text)
      if (r.recurrence && r.recurrence !== 'none') {
        r.whenISO = advanceISO(r.whenISO, r.recurrence)
        r.fired = false
      } else {
        r.fired = true
      }
      changedReminders = true
    }
  }
  if (changedReminders) {
    // Remove timers/despertadores de uma vez só que já dispararam (não recorrentes).
    setReminders(reminders.filter((r) => !(r.fired && r.kind !== 'reminder')))
  }

  // Camada proativa de ambiente (bateria, evento chegando, tarefas vencidas).
  proactiveTick(now, board, events)
}

export function startReminders(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  if (timer) clearInterval(timer)
  timer = setInterval(tick, 30_000)
  tick()
}
