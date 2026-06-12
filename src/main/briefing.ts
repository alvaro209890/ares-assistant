import type { AppConfig, BriefingData, BriefingTask } from '../shared/types'
import { loadBoard } from './tasks'
import { loadEvents } from './data'
import { getWeather, getWeatherAt, getNews } from './tools'
import { getWorklog } from './worklog'
import { basename } from 'path'

// Monta o "briefing do dia": clima, eventos de hoje, tarefas vencidas/próximas,
// lembretes, notícias e sugestões proativas (discretas). Usado pelo painel de
// briefing e pela ferramenta de voz "faça meu briefing".

const DAY = 86400_000
const sameDay = (iso: string, ref = new Date()): boolean => {
  const d = new Date(iso)
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
}
const timeLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

function greetingFor(now: Date): string {
  const h = now.getHours()
  if (h < 6) return 'Boa madrugada, senhor.'
  if (h < 12) return 'Bom dia, senhor.'
  if (h < 18) return 'Boa tarde, senhor.'
  return 'Boa noite, senhor.'
}

export async function buildBriefing(cfg: AppConfig): Promise<BriefingData> {
  const now = new Date()
  const board = loadBoard()
  const events = loadEvents()
  const cards = Object.values(board.cards)

  // Clima (preferindo localização aproximada).
  let weather: BriefingData['weather'] = null
  let weatherError: string | undefined
  try {
    const loc = cfg.integrations.location
    weather =
      loc.enabled && typeof loc.latitude === 'number' && typeof loc.longitude === 'number'
        ? await getWeatherAt(loc)
        : await getWeather(cfg.integrations.weatherCity)
  } catch (e) {
    weatherError = e instanceof Error ? e.message : 'Clima indisponível.'
  }

  // Notícias principais (tolerante a falha — briefing não pode quebrar).
  let news: BriefingData['news'] = []
  try {
    news = (await getNews(cfg.integrations.newsTopic, 4)).slice(0, 4)
  } catch {
    news = []
  }

  const todayEvents = events
    .filter((e) => sameDay(e.whenISO))
    .map((e) => ({ id: e.id, title: e.title, whenISO: e.whenISO, description: e.description }))

  const toTask = (c: (typeof cards)[number]): BriefingTask => ({
    id: c.id,
    title: c.title,
    due: c.due,
    priority: c.priority
  })

  const overdueTasks = cards
    .filter((c) => !c.done && c.due && new Date(c.due).getTime() < now.getTime())
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))
    .map(toTask)

  const upcomingTasks = cards
    .filter((c) => {
      if (c.done || !c.due) return false
      const t = new Date(c.due).getTime()
      return t >= now.getTime() && t <= now.getTime() + 7 * DAY
    })
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))
    .slice(0, 6)
    .map(toTask)

  const reminders = cards
    .filter((c) => !c.done && !c.reminded && c.reminderAt && new Date(c.reminderAt).getTime() >= now.getTime() - DAY)
    .sort((a, b) => String(a.reminderAt).localeCompare(String(b.reminderAt)))
    .slice(0, 6)
    .map((c) => ({ id: c.id, title: c.title, reminderAt: c.reminderAt }))

  // Sugestões proativas, discretas e baseadas no contexto.
  const suggestions: string[] = []
  if (cfg.ui.proactiveSuggestions) {
    if (overdueTasks.length)
      suggestions.push(
        overdueTasks.length === 1
          ? `A tarefa "${overdueTasks[0].title}" está vencida — quer reagendar ou concluir?`
          : `Você tem ${overdueTasks.length} tarefas vencidas. Quer revisá-las?`
      )
    const soon = todayEvents.find((e) => {
      const t = new Date(e.whenISO).getTime()
      return t >= now.getTime() && t <= now.getTime() + 2 * 3600_000
    })
    if (soon) suggestions.push(`"${soon.title}" começa às ${timeLabel(soon.whenISO)} — quer um lembrete?`)
    // Conflito de agenda: dois eventos de hoje a menos de 30 min um do outro.
    for (let i = 1; i < todayEvents.length; i++) {
      const gap = new Date(todayEvents[i].whenISO).getTime() - new Date(todayEvents[i - 1].whenISO).getTime()
      if (gap >= 0 && gap < 30 * 60_000) {
        suggestions.push(`Possível conflito de agenda entre "${todayEvents[i - 1].title}" e "${todayEvents[i].title}".`)
        break
      }
    }
    const rain = Math.max(weather?.today.precipProb ?? 0, ...(weather?.periods.map((p) => p.precipProb) ?? [0]))
    if (rain >= 60) suggestions.push('Boa chance de chuva hoje — vale levar guarda-chuva.')

    if (cfg.integrations.code.workspaceRoot) {
      const wlog = getWorklog(cfg.integrations.code.workspaceRoot)
      if (wlog.entries.length > 0) {
        const last = wlog.entries[0]
        if (now.getTime() - last.timestamp < 48 * 3600_000) {
          const projName = basename(cfg.integrations.code.workspaceRoot)
          suggestions.push(`Você tem trabalho recente no projeto ${projName}. Diga "continuar de onde paramos" para retomar.`)
        }
      }
    }
  }

  return {
    generatedAt: now.getTime(),
    greeting: greetingFor(now),
    dateLabel: now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }),
    weather,
    weatherError,
    todayEvents,
    overdueTasks,
    upcomingTasks,
    reminders,
    news,
    suggestions
  }
}

/** Versão curta e falável do briefing, para o Ares verbalizar. */
export function briefingToSpeech(b: BriefingData): string {
  const bits: string[] = [b.greeting]
  if (b.weather)
    bits.push(
      `Em ${b.weather.city}, ${b.weather.current.temp} graus, ${b.weather.current.desc}.` +
        (b.weather.alert ? ` ${b.weather.alert}` : '')
    )
  if (b.todayEvents.length) {
    const first = b.todayEvents[0]
    bits.push(
      b.todayEvents.length === 1
        ? `Hoje você tem ${first.title} às ${timeLabel(first.whenISO)}.`
        : `Hoje você tem ${b.todayEvents.length} compromissos, o primeiro às ${timeLabel(first.whenISO)}.`
    )
  } else {
    bits.push('Sua agenda de hoje está livre.')
  }
  if (b.overdueTasks.length) bits.push(`Há ${b.overdueTasks.length} tarefa(s) vencida(s).`)
  else if (b.upcomingTasks.length) bits.push(`${b.upcomingTasks.length} tarefa(s) nos próximos dias.`)
  if (b.news.length) bits.push(`Nas notícias: ${b.news[0].title}.`)
  return bits.join(' ')
}
