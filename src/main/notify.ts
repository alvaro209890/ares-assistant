import { Notification, BrowserWindow } from 'electron'
import { loadBoard, saveBoard } from './tasks'
import { loadEvents, setEvents } from './data'
import { advanceISO } from './board'

// Lembretes locais: varre periodicamente tarefas (reminderAt) e eventos (whenISO).
// Ao chegar a hora, mostra notificação nativa e avisa o renderer (que fala, se a
// voz estiver ativa). Marca como "reminded" para não repetir.

let timer: ReturnType<typeof setInterval> | null = null
let getWindow: (() => BrowserWindow | null) | null = null

function fire(prefix: string, title: string): void {
  const body = `${prefix}: ${title}`
  try {
    if (Notification.isSupported()) new Notification({ title: 'ARES', body, silent: false }).show()
  } catch {
    /* ignora */
  }
  const win = getWindow?.()
  if (win && !win.isDestroyed()) win.webContents.send('reminder:fired', { prefix, title, body })
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
}

export function startReminders(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  if (timer) clearInterval(timer)
  timer = setInterval(tick, 30_000)
  tick()
}
