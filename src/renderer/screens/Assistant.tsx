import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useAres } from '../lib/store'
import Orb3D from '../components/Orb3D'
import StateIndicator from '../components/StateIndicator'
import Conversation from '../components/Conversation'
import Controls from '../components/Controls'

const sameDay = (iso: string, ref = new Date()) => {
  const d = new Date(iso)
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
}

export default function Assistant(): JSX.Element {
  const { aresState, conversation, status, weather, events, board, createSession } = useAres()
  const todayEvents = useMemo(() => events.filter((e) => sameDay(e.whenISO)).slice(0, 4), [events])
  const reminders = useMemo(
    () =>
      Object.values(board.cards)
        .filter((c) => c.reminderAt && !c.done && !c.reminded)
        .sort((a, b) => String(a.reminderAt).localeCompare(String(b.reminderAt)))
        .slice(0, 4),
    [board.cards]
  )

  return (
    <motion.div
      key="assistant"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full gap-4 px-7 pb-6"
    >
      <div className="glass relative flex-1 overflow-hidden rounded-2xl">
        <div className="pointer-events-none absolute left-1/2 top-[42%] h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/10 blur-[90px]" />

        <div className="absolute left-5 top-5 z-10 grid w-[260px] gap-3">
          <Widget title="CLIMA">
            {weather ? (
              <>
                <div className="text-lg text-cyan-50">{weather.current.temp}°C</div>
                <p className="text-xs text-cyan-200/60">
                  {weather.city} · {weather.current.desc}
                </p>
                <p className="mt-1 text-[11px] text-cyan-200/45">
                  Sensação {weather.current.feels}°C · chuva {weather.today.precipProb}%
                </p>
              </>
            ) : (
              <p className="text-xs text-cyan-200/45">Clima indisponível no momento.</p>
            )}
          </Widget>
          <Widget title="HOJE">
            {todayEvents.length ? (
              todayEvents.map((e) => (
                <p key={e.id} className="truncate text-xs text-cyan-100/85">
                  {new Date(e.whenISO).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {e.title}
                </p>
              ))
            ) : (
              <p className="text-xs text-cyan-200/45">Sem eventos para hoje.</p>
            )}
          </Widget>
        </div>

        <div className="absolute right-5 top-5 z-10 w-[260px]">
          <Widget title="LEMBRETES">
            {reminders.length ? (
              reminders.map((c) => (
                <p key={c.id} className="truncate text-xs text-cyan-100/85">
                  {new Date(String(c.reminderAt)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {c.title}
                </p>
              ))
            ) : (
              <p className="text-xs text-cyan-200/45">Nenhum lembrete pendente.</p>
            )}
          </Widget>
        </div>

        <div className="absolute inset-0">
          <Orb3D state={aresState} />
        </div>

        <div className="absolute left-1/2 top-6 -translate-x-1/2">
          <StateIndicator state={aresState} />
        </div>

        {status && <div className="absolute left-1/2 top-20 -translate-x-1/2 text-xs text-amber-200/80">{status}</div>}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-6">
          <Controls />
        </div>
      </div>

      <div className="glass flex w-[420px] flex-col rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between px-1">
          <h3 className="text-xs title-track text-cyan-300/60">CONVERSA</h3>
          <button onClick={() => createSession()} className="text-xs text-cyan-200/60 hover:text-cyan-100">
            NOVA
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <Conversation messages={conversation} />
        </div>
      </div>
    </motion.div>
  )
}

function Widget({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl border border-cyan-300/15 bg-black/25 p-3 backdrop-blur-md">
      <div className="mb-1 text-[10px] title-track text-cyan-300/45">{title}</div>
      {children}
    </div>
  )
}
