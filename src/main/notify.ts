import { Notification, BrowserWindow } from 'electron'
import { loadBoard, saveBoard } from './tasks'
import { loadEvents, setEvents, loadReminders, setReminders } from './data'
import { advanceISO } from './board'
import { readConfig } from './config'
import { pickProactiveNudge, readBattery } from './proactive'

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

/** Camada proativa: escolhe no máximo um aviso de ambiente e o anuncia. */
function proactiveTick(now: number, board: ReturnType<typeof loadBoard>, events: ReturnType<typeof loadEvents>): void {
  if (readConfig().ui.proactiveAlerts === false) return
  const overdueCount = Object.values(board.cards).filter(
    (c) => !c.done && c.due && new Date(c.due).getTime() < now
  ).length
  const nudge = pickProactiveNudge(
    {
      now,
      battery: readBattery(),
      events: events.map((e) => ({ id: e.id, title: e.title, whenISO: e.whenISO, remindMinutes: e.remindMinutes })),
      overdueCount,
      eventHeadsUpMin: 10
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
