// Briefing do dia: agrega clima + agenda + tarefas + lembretes + notícias.
// Demora alguns segundos (rede), por isso reportsProgress.

import { buildBriefing } from '../briefing'
import { toolOk } from '../agent/types'
import type { ToolCommand } from './types'

export const briefingCommands: ToolCommand[] = [
  {
    tipo: 'briefing.consultar',
    category: 'briefing',
    reportsProgress: true,
    progressLabel: () => 'Montando briefing do dia...',
    async run(a, { cfg, reportProgress }) {
      reportProgress('Coletando clima, agenda, tarefas e notícias...')
      const b = await buildBriefing(cfg)
      return toolOk(a.tipo, {
        data: b.dateLabel,
        clima: b.weather
          ? { local: b.weather.city, temp: b.weather.current.temp, desc: b.weather.current.desc, alerta: b.weather.alert }
          : b.weatherError || 'indisponível',
        eventosHoje: b.todayEvents.map((e) => ({ titulo: e.title, quando: e.whenISO })),
        tarefasVencidas: b.overdueTasks.map((t) => t.title),
        proximasTarefas: b.upcomingTasks.map((t) => t.title),
        lembretes: b.reminders.map((r) => r.title),
        noticias: b.news.map((n) => n.title),
        sugestoes: b.suggestions
      })
    }
  }
]
