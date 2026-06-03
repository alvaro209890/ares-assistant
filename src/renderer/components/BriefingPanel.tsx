import { AnimatePresence, motion } from 'framer-motion'
import { useAres } from '../lib/store'

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

// Painel "briefing do dia": clima, agenda, tarefas vencidas/próximas, lembretes,
// notícias e sugestões proativas discretas. Abre por botão ou por voz.
export default function BriefingPanel(): JSX.Element {
  const { briefingOpen, openBriefing, briefing, briefingLoading, loadBriefing, navigate } = useAres()

  return (
    <AnimatePresence>
      {briefingOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => openBriefing(false)}
          />
          <motion.aside
            className="glass-strong fixed right-0 top-0 z-50 flex h-full w-[460px] max-w-[94vw] flex-col p-6"
            initial={{ x: 480 }}
            animate={{ x: 0 }}
            exit={{ x: 480 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-lg title-track text-cyan-100 neon-text">BRIEFING DO DIA</h2>
              <div className="flex items-center gap-3">
                <button onClick={() => void loadBriefing()} className="text-cyan-200/60 hover:text-cyan-100" title="Atualizar">
                  ↻
                </button>
                <button onClick={() => openBriefing(false)} className="text-cyan-200/60 hover:text-cyan-100" title="Fechar">
                  ✕
                </button>
              </div>
            </div>

            {briefing && <p className="mb-4 text-xs capitalize text-cyan-200/55">{briefing.dateLabel}</p>}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              {briefingLoading && !briefing ? (
                <div className="grid h-40 place-items-center text-sm text-cyan-200/40">Montando seu briefing…</div>
              ) : !briefing ? (
                <div className="grid h-40 place-items-center text-sm text-cyan-200/40">Sem dados.</div>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-cyan-50">{briefing.greeting}</p>

                  <Block title="CLIMA">
                    {briefing.weather ? (
                      <div>
                        <p className="text-sm text-cyan-50">
                          {briefing.weather.city} · {briefing.weather.current.temp}°C · {briefing.weather.current.desc}
                        </p>
                        {briefing.weather.periods.length > 0 && (
                          <div className="mt-2 flex gap-2">
                            {briefing.weather.periods.map((p) => (
                              <div key={p.key} className="flex-1 rounded-lg border border-cyan-300/15 bg-black/20 p-2 text-center">
                                <div className="text-[10px] text-cyan-200/50">{p.label}</div>
                                <div className="text-sm text-cyan-50">{p.temp}°</div>
                                <div className="text-[10px] text-cyan-200/50">💧{p.precipProb}%</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {briefing.weather.alert && <p className="mt-2 text-xs text-amber-200/85">⚠ {briefing.weather.alert}</p>}
                      </div>
                    ) : (
                      <Empty>{briefing.weatherError || 'Clima indisponível.'}</Empty>
                    )}
                  </Block>

                  <Block title="AGENDA DE HOJE" onClick={() => navigate('calendar')}>
                    {briefing.todayEvents.length ? (
                      briefing.todayEvents.map((e) => (
                        <Item key={e.id} primary={e.title} secondary={time(e.whenISO)} />
                      ))
                    ) : (
                      <Empty>Dia livre.</Empty>
                    )}
                  </Block>

                  {briefing.overdueTasks.length > 0 && (
                    <Block title="TAREFAS VENCIDAS" onClick={() => navigate('tasks')} tone="amber">
                      {briefing.overdueTasks.map((t) => (
                        <Item key={t.id} primary={t.title} secondary={t.due ? new Date(t.due).toLocaleDateString('pt-BR') : ''} />
                      ))}
                    </Block>
                  )}

                  <Block title="PRÓXIMAS TAREFAS" onClick={() => navigate('tasks')}>
                    {briefing.upcomingTasks.length ? (
                      briefing.upcomingTasks.map((t) => (
                        <Item key={t.id} primary={t.title} secondary={t.due ? new Date(t.due).toLocaleDateString('pt-BR') : ''} />
                      ))
                    ) : (
                      <Empty>Nada nos próximos dias.</Empty>
                    )}
                  </Block>

                  {briefing.reminders.length > 0 && (
                    <Block title="LEMBRETES">
                      {briefing.reminders.map((r) => (
                        <Item key={r.id} primary={r.title} secondary={r.reminderAt ? time(r.reminderAt) : ''} />
                      ))}
                    </Block>
                  )}

                  <Block title="NOTÍCIAS">
                    {briefing.news.length ? (
                      briefing.news.map((n, i) => <Item key={i} primary={n.title} secondary={n.source || ''} />)
                    ) : (
                      <Empty>Sem notícias agora.</Empty>
                    )}
                  </Block>

                  {briefing.suggestions.length > 0 && (
                    <Block title="SUGESTÕES" tone="cyan">
                      {briefing.suggestions.map((s, i) => (
                        <p key={i} className="text-xs text-cyan-100/85">• {s}</p>
                      ))}
                    </Block>
                  )}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function Block({
  title,
  children,
  onClick,
  tone = 'default'
}: {
  title: string
  children: React.ReactNode
  onClick?: () => void
  tone?: 'default' | 'amber' | 'cyan'
}): JSX.Element {
  const border = tone === 'amber' ? 'border-amber-300/25' : tone === 'cyan' ? 'border-cyan-300/30' : 'border-cyan-300/12'
  return (
    <section className={`rounded-xl border ${border} bg-black/20 p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] title-track text-cyan-300/55">{title}</h3>
        {onClick && (
          <button onClick={onClick} className="text-[10px] text-cyan-200/45 hover:text-cyan-100">
            ABRIR →
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

function Item({ primary, secondary }: { primary: string; secondary?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-cyan-50">{primary}</span>
      {secondary && <span className="shrink-0 text-[11px] text-amber-200/70">{secondary}</span>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="text-xs text-cyan-200/40">{children}</p>
}
