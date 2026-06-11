import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useAres } from '../lib/store'
import Orb3D from '../components/Orb3D'
import StateIndicator from '../components/StateIndicator'
import Controls from '../components/Controls'
import ModelBar from '../components/ModelBar'
import ChatPanel from '../components/ChatPanel'

const sameDay = (iso: string, ref = new Date()) => {
  const d = new Date(iso)
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
}

// Tempo ligado do computador em formato curto (ex.: "3d 4h", "5h 12m", "8m").
function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function Assistant(): JSX.Element {
  const { aresState, status, weather, events, board, metrics, openBriefing } = useAres()
  const todayEvents = useMemo(() => events.filter((e) => sameDay(e.whenISO)).slice(0, 3), [events])
  const reminders = useMemo(
    () =>
      Object.values(board.cards)
        .filter((c) => c.reminderAt && !c.done && !c.reminded)
        .sort((a, b) => String(a.reminderAt).localeCompare(String(b.reminderAt)))
        .slice(0, 3),
    [board.cards]
  )
  const openTasks = useMemo(() => Object.values(board.cards).filter((c) => !c.done).length, [board.cards])

  return (
    <motion.div
      key="assistant"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full min-h-[760px] flex-col gap-3 p-5"
    >
      <ModelBar />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section className="ares-orb-stage glass relative min-h-[620px] min-w-0 overflow-hidden rounded-2xl">
        <div className="ares-stage-grid" />
        <div className="ares-stage-vignette" />
        <div className="ares-stage-scan" />

        <button
          onClick={() => openBriefing(true)}
          className="absolute right-5 top-[78px] z-30 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-[11px] title-track text-cyan-100 transition hover:bg-cyan-400/20"
          title="Briefing do dia (clima, agenda, tarefas, notícias)"
        >
          ☀ BRIEFING
        </button>

        <div className="absolute inset-x-5 top-5 z-20 grid grid-cols-3 gap-3">
          <Metric
            title="CLIMA"
            value={weather ? `${weather.current.temp}°C` : 'OFFLINE'}
            alert={weather?.alert}
          >
            {weather ? `${weather.city} · ${weather.current.desc} · 💧${weather.today.precipProb}%` : 'Sem dados externos'}
          </Metric>
          <Metric title="AGENDA" value={String(todayEvents.length).padStart(2, '0')}>
            {todayEvents[0]
              ? `${new Date(todayEvents[0].whenISO).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${todayEvents[0].title}`
              : 'Dia livre'}
          </Metric>
          <Metric title="TAREFAS" value={String(openTasks).padStart(2, '0')}>
            {reminders[0]
              ? `Lembrete ${new Date(String(reminders[0].reminderAt)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : 'Sem alertas'}
          </Metric>
        </div>

        <div className="ares-orb-reticle pointer-events-none absolute left-1/2 top-[51%] z-0 aspect-square -translate-x-1/2 -translate-y-1/2">
          <div className="ares-hud-disc ares-hud-disc-outer" />
          <div className="ares-hud-disc ares-hud-disc-mid" />
          <div className="ares-hud-disc ares-hud-disc-inner" />
          <div className="ares-hud-axis ares-hud-axis-x" />
          <div className="ares-hud-axis ares-hud-axis-y" />
        </div>

        <div className="absolute inset-0 z-10">
          <Orb3D state={aresState} />
        </div>

        <div className="absolute left-1/2 top-[118px] z-30 -translate-x-1/2">
          <StateIndicator state={aresState} />
        </div>

        {status && (
          <div className="absolute left-1/2 top-[158px] z-30 max-w-[520px] -translate-x-1/2 truncate rounded-full border border-amber-300/20 bg-black/25 px-3 py-1 text-xs text-amber-200/85 backdrop-blur-md">
            {status}
          </div>
        )}

        <div className="pointer-events-none absolute bottom-[112px] left-1/2 z-20 flex w-[min(74%,680px)] -translate-x-1/2 items-center justify-between text-[10px] text-cyan-200/45">
          {metrics ? (
            <>
              <span className={metrics.cpuPercent >= 85 ? 'text-amber-300/80' : undefined}>CPU {metrics.cpuPercent}%</span>
              <span className={metrics.memPercent >= 90 ? 'text-amber-300/80' : undefined}>
                RAM {metrics.memPercent}% · {metrics.memUsedGB}/{metrics.memTotalGB} GB
              </span>
              <span>UP {formatUptime(metrics.uptimeSec)}</span>
            </>
          ) : (
            <>
              <span>NEURAL CORE</span>
              <span>ARES ONLINE</span>
              <span>LOCAL MEMORY</span>
            </>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-[#04070f] via-[#04070f]/82 to-transparent p-6 pt-16">
          <Controls />
        </div>
      </section>

      <ChatPanel className="glass flex min-h-[420px] min-w-0 flex-col rounded-2xl p-4 lg:min-h-0" />
      </div>
    </motion.div>
  )
}

function Metric({
  title,
  value,
  alert,
  children
}: {
  title: string
  value: string
  alert?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="ares-metric-panel min-w-0 rounded-xl px-3 py-2.5" title={alert || undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-cyan-300/50">{title}</span>
        <span className={`h-1.5 w-1.5 rounded-full shadow-glow ${alert ? 'bg-amber-300' : 'bg-cyan-300'}`} />
      </div>
      <div className="mt-1 truncate font-display text-xl text-cyan-50 neon-text">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-cyan-200/50">{children}</div>
    </div>
  )
}
