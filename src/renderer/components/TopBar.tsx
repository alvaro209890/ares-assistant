import { useEffect, useMemo, useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { useAres, type ConvMsg } from '../lib/store'
import type { AgentActivityEvent } from '../../shared/types'
import AresOffice from './AresOffice'

function CloseIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  )
}

function SentinelLogPre({ buffer }: { buffer: string }): JSX.Element {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [buffer])

  return (
    <pre
      ref={ref}
      className="flex-1 font-mono text-xs text-left bg-black/40 p-4 rounded-xl border border-cyan-300/10 overflow-y-auto select-text text-cyan-300 scrollbar-thin whitespace-pre-wrap break-all"
    >
      {buffer || 'Aguardando saída do processo...'}
    </pre>
  )
}

type Screen = 'assistant' | 'office' | 'tasks' | 'calendar' | 'reminders' | 'lists' | 'memory' | 'models' | 'system' | 'demo'

const tabs: { id: Screen; label: string; hint: string; icon: JSX.Element }[] = [
  { id: 'assistant', label: 'Assistente', hint: 'Alt+1', icon: <AssistantIcon /> },
  { id: 'tasks', label: 'Tarefas', hint: 'Alt+2', icon: <TasksIcon /> },
  { id: 'calendar', label: 'Calendário', hint: 'Alt+3', icon: <CalendarIcon /> },
  { id: 'reminders', label: 'Lembretes', hint: 'Alt+4', icon: <BellIcon /> },
  { id: 'lists', label: 'Listas', hint: 'Alt+5', icon: <ListIcon /> },
  { id: 'memory', label: 'Memória', hint: 'Alt+6', icon: <MemoryIcon /> },
  { id: 'models', label: 'Modelos de IA', hint: 'Alt+7', icon: <ChipIcon /> },
  { id: 'system', label: 'Sistema', hint: 'Alt+8', icon: <SystemIcon /> },
  { id: 'office', label: 'Escritório', hint: 'Alt+9', icon: <HiveIcon /> },
  { id: 'demo', label: 'Apresentação', hint: 'Alt+0', icon: <PlayIcon /> }
]

function latestOfficeActivity(conversation: ConvMsg[]): AgentActivityEvent | null {
  let outputFallback: AgentActivityEvent | null = null
  for (let i = conversation.length - 1; i >= 0; i--) {
    const activities = conversation[i].activities
    if (!activities?.length) continue
    for (let j = activities.length - 1; j >= 0; j--) {
      const activity = activities[j]
      if (activity.status !== 'output') return activity
      if (!outputFallback) outputFallback = activity
    }
  }
  return outputFallback
}

export default function TopBar(): JSX.Element {
  const {
    screen,
    navigate,
    openSettings,
    openHelp,
    openPalette,
    config,
    saveConfig,
    aresState,
    metrics,
    conversation,
    status,
    sentinels,
    stopSentinel
  } = useAres()
  const muted = !config?.tts.enabled
  const officeActivity = useMemo(() => latestOfficeActivity(conversation), [conversation])
  const [activeModalSentinelId, setActiveModalSentinelId] = useState<string | null>(null)
  const modalSentinel = useMemo(() => sentinels?.find((s) => s.id === activeModalSentinelId), [sentinels, activeModalSentinelId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (editing || !event.altKey) return
      const index = Number(event.key) - 1
      const tab = tabs[index]
      if (!tab) return
      event.preventDefault()
      navigate(tab.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <aside className="relative z-20 flex h-full w-[224px] shrink-0 flex-col border-r border-cyan-300/10 bg-[#030814]/70 px-4 py-5 backdrop-blur-xl">
      <div className="mb-6 flex items-center gap-3 px-1">
        <div className="relative h-9 w-9">
          <span className="absolute inset-0 rounded-full border border-cyan-300/55 animate-pulse-ring" />
          <span className="absolute inset-2 rounded-full bg-cyan-300 shadow-glow" />
        </div>
        <div className="min-w-0">
          <div className="font-display text-xl text-cyan-100 neon-text">ARES</div>
          <div className="text-[11px] text-cyan-200/45">LOCAL CORE</div>
        </div>
      </div>

      <nav className="grid gap-2" aria-label="Navegação principal">
        {tabs.map((t) => {
          const active = screen === t.id
          return (
            <button
              key={t.id}
              onClick={() => navigate(t.id)}
              className={`relative flex min-h-[48px] items-center gap-3 overflow-hidden rounded-xl border px-3 text-left transition ${
                active
                  ? 'border-cyan-300/45 bg-cyan-400/12 text-cyan-50 shadow-glow'
                  : 'border-cyan-300/10 bg-white/[0.03] text-cyan-200/62 hover:border-cyan-300/28 hover:text-cyan-50'
              }`}
              title={`${t.label} (${t.hint})`}
            >
              {active && (
                <motion.span
                  layoutId="side-nav-active"
                  className="absolute inset-0 bg-gradient-to-r from-cyan-400/16 to-blue-500/5"
                />
              )}
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/15 bg-black/24">
                {t.icon}
              </span>
              <span className="relative min-w-0 flex-1">
                <span className="block truncate text-sm">{t.label}</span>
                <span className="block text-[10px] text-cyan-200/35">{t.hint}</span>
              </span>
            </button>
          )
        })}
      </nav>

      {/* Sentinelas de Execução vigiando */}
      {sentinels && sentinels.length > 0 && (
        <div className="mt-4 px-1 flex flex-col gap-1.5 border-t border-cyan-300/10 pt-4">
          <div className="text-[10px] text-cyan-200/40 uppercase tracking-widest font-mono mb-1">Sentinelas</div>
          {sentinels.map((s) => {
            const hasError = s.status === 'error'
            const isRec = s.status === 'recovered'
            return (
              <button
                key={s.id}
                onClick={() => setActiveModalSentinelId(s.id)}
                className={`relative flex items-center gap-2 overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition ${
                  hasError
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15'
                    : isRec
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15'
                      : 'border-cyan-300/15 bg-white/[0.02] text-cyan-200/80 hover:border-cyan-300/30 hover:text-cyan-50'
                }`}
              >
                <span className="relative flex h-2 w-2">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      hasError ? 'bg-rose-400' : isRec ? 'bg-emerald-400' : 'bg-cyan-400'
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      hasError ? 'bg-rose-500' : isRec ? 'bg-emerald-500' : 'bg-cyan-500'
                    }`}
                  />
                </span>
                <span className="font-mono text-xs truncate flex-1">{s.command}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Escritório do Ares — cenário interativo */}
      <div className="my-2 flex min-h-0 flex-1 items-end justify-center overflow-hidden px-1">
        <AresOffice
          state={aresState}
          userName={config?.ui.userName}
          metrics={metrics ?? undefined}
          activity={officeActivity ?? undefined}
          statusText={status}
          muted={muted}
        />
      </div>

      <div className="mt-auto grid gap-2">
        {config && (
          <button
            onClick={() => saveConfig({ tts: { ...config.tts, enabled: muted } })}
            className={`flex min-h-[42px] items-center gap-3 rounded-xl border px-3 text-sm transition ${
              muted
                ? 'border-amber-300/30 bg-amber-400/8 text-amber-100'
                : 'border-cyan-300/12 bg-white/[0.03] text-cyan-200/70 hover:text-cyan-50'
            }`}
            title={muted ? 'Ativar fala' : 'Silenciar Ares'}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-current/20">
              {muted ? <SpeakerOffIcon /> : <SpeakerIcon />}
            </span>
            <span>{muted ? 'Fala muda' : 'Fala ativa'}</span>
          </button>
        )}
        <button
          onClick={() => openPalette(true)}
          className="flex min-h-[42px] items-center gap-3 rounded-xl border border-cyan-300/12 bg-white/[0.03] px-3 text-sm text-cyan-200/70 transition hover:text-cyan-50"
          title="Busca global (Ctrl+K)"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-300/15">
            <SearchIcon />
          </span>
          <span className="flex-1">Buscar</span>
          <kbd className="rounded border border-cyan-300/15 px-1 py-0.5 text-[9px] text-cyan-200/40">⌘K</kbd>
        </button>
        <button
          onClick={() => openHelp(true)}
          className="flex min-h-[42px] items-center gap-3 rounded-xl border border-cyan-300/12 bg-white/[0.03] px-3 text-sm text-cyan-200/70 transition hover:text-cyan-50"
          title="O que o Ares sabe fazer"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-300/15">
            <HelpIcon />
          </span>
          <span>Ajuda</span>
        </button>
        <button
          onClick={() => openSettings(true)}
          className="flex min-h-[42px] items-center gap-3 rounded-xl border border-cyan-300/12 bg-white/[0.03] px-3 text-sm text-cyan-200/70 transition hover:text-cyan-50"
          title="Configurações"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-300/15">
            <GearIcon />
          </span>
          <span>Configurações</span>
        </button>
      </div>

      {/* Cyberpunk Terminal Modal */}
      {modalSentinel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="glass-strong flex flex-col w-full max-w-3xl h-[80vh] rounded-2xl border border-cyan-500/20 overflow-hidden shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-cyan-300/10 bg-[#071124]/80 px-6 py-4">
              <div>
                <div className="text-[10px] text-cyan-400/60 uppercase tracking-widest font-mono">Sentinela de Execução</div>
                <div className="text-md font-display font-semibold text-cyan-100">{modalSentinel.command}</div>
              </div>
              <button
                onClick={() => setActiveModalSentinelId(null)}
                className="text-cyan-200/60 hover:text-cyan-100 transition"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="flex-1 bg-[#020712] p-5 overflow-hidden flex flex-col">
              <div className="flex items-center gap-4 text-xs font-mono mb-3 text-cyan-200/50">
                <div>
                  Status:{' '}
                  <span
                    className={
                      modalSentinel.status === 'error'
                        ? 'text-rose-400 animate-pulse font-bold'
                        : modalSentinel.status === 'recovered'
                          ? 'text-emerald-400'
                          : 'text-cyan-400'
                    }
                  >
                    {modalSentinel.status.toUpperCase()}
                  </span>
                </div>
                <div>•</div>
                <div className="truncate">Caminho: {modalSentinel.path}</div>
              </div>

              <SentinelLogPre buffer={modalSentinel.buffer} />
            </div>

            <div className="flex justify-end gap-3 border-t border-cyan-300/10 bg-[#071124]/50 px-6 py-4">
              <button
                onClick={() => {
                  stopSentinel(modalSentinel.id)
                  setActiveModalSentinelId(null)
                }}
                className="px-4 py-2 text-xs font-mono font-medium rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition duration-150"
              >
                PARAR SENTINELA
              </button>
              <button
                onClick={() => setActiveModalSentinelId(null)}
                className="px-4 py-2 text-xs font-mono font-medium rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 transition duration-150"
              >
                FECHAR
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

function AssistantIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" strokeLinecap="round" />
    </svg>
  )
}

function TasksIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" />
    </svg>
  )
}

function CalendarIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M7 3v4M17 3v4M4 9h16M5 5h14v15H5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MemoryIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M8 8h8v8H8zM4 10h4M16 10h4M4 14h4M16 14h4M10 4v4M14 4v4M10 16v4M14 16v4" strokeLinecap="round" />
    </svg>
  )
}

function BellIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ListIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round" />
    </svg>
  )
}

function SystemIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 2a3 3 0 0 1 3 3v1.2a6 6 0 0 1 1.8 1l1-.6 2 3.4-1 .6a6 6 0 0 1 0 2l1 .6-2 3.4-1-.6a6 6 0 0 1-1.8 1V19a3 3 0 0 1-6 0v-1.2a6 6 0 0 1-1.8-1l-1 .6-2-3.4 1-.6a6 6 0 0 1 0-2l-1-.6 2-3.4 1 .6a6 6 0 0 1 1.8-1V5a3 3 0 0 1 3-3z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  )
}

function HiveIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 2.8l3.6 2.1v4.2L12 11.2 8.4 9.1V4.9L12 2.8z" strokeLinejoin="round" />
      <path d="M5.8 12.6l3.6 2.1v4.2l-3.6 2.1-3.6-2.1v-4.2l3.6-2.1zM18.2 12.6l3.6 2.1v4.2l-3.6 2.1-3.6-2.1v-4.2l3.6-2.1z" strokeLinejoin="round" />
      <path d="M12 11.2v3M9.4 14.7l-1.2.7M14.6 14.7l1.2.7" strokeLinecap="round" />
    </svg>
  )
}

function ChipIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M10 10h4v4h-4zM9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" strokeLinecap="round" />
    </svg>
  )
}

function SpeakerIcon(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" />
      <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" strokeLinecap="round" />
    </svg>
  )
}

function SpeakerOffIcon(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 9v6h4l5 4V5L9 8" strokeLinejoin="round" />
      <path d="M3 3l18 18M17 9l4 4M21 9l-4 4" strokeLinecap="round" />
    </svg>
  )
}

function PlayIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <polygon points="5 3 19 12 5 21 5 3" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  )
}

function HelpIcon(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3.5M12 17h.01" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GearIcon(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
