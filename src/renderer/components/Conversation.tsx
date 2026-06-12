import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ConvMsg } from '../lib/store'
import type { AgentActivityEvent } from '../../shared/types'

// Mostra a transcrição: o que eu disse + o que o Ares respondeu.
export default function Conversation({ messages }: { messages: ConvMsg[] }): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="selectable flex h-full flex-col gap-3 overflow-y-auto pr-2">
      {messages.length === 0 && (
        <div className="m-auto text-center text-cyan-200/40">
          <p className="text-sm title-track">AGUARDANDO COMANDO</p>
          <p className="mt-2 text-xs">Segure o botão para falar ou digite abaixo.</p>
        </div>
      )}
      <AnimatePresence initial={false}>
        {messages.map((m) => {
          const mine = m.role === 'user'
          return (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed glass ${
                  mine
                    ? 'border-cyan-300/30 text-cyan-50'
                    : 'border-indigo-300/20 text-cyan-100/95 shadow-glow'
                }`}
              >
                <div className="mb-0.5 text-[10px] title-track opacity-50">{mine ? 'VOCÊ' : 'ARES'}</div>
                {m.activities?.length ? <ActivityTimeline activities={m.activities} /> : null}
                {m.content ? <div className={`whitespace-pre-wrap break-words ${m.activities?.length ? 'mt-2' : ''}`}>{m.content}</div> : m.pending ? <ThinkingDots /> : ''}
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  )
}

function ActivityTimeline({ activities }: { activities: AgentActivityEvent[] }): JSX.Element {
  return (
    <div className="mb-1 space-y-1.5 border-l border-cyan-300/15 pl-3">
      {activities.map((a, idx) => (
        <div key={`${a.id}-${a.status}-${idx}`} className="relative text-[12px] leading-snug text-cyan-100/75">
          <span className={`absolute -left-[17px] top-1 h-2 w-2 rounded-full ${activityDot(a)}`} />
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[10px] title-track text-cyan-300/45">{activityStatus(a)}</span>
            <span className="min-w-0 truncate">{a.title}</span>
          </div>
          {(a.command || a.target || a.detail) && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-cyan-200/45">
              {a.command || a.target || a.detail}
            </div>
          )}
          {a.output && <TerminalLog activity={a} />}
        </div>
      ))}
    </div>
  )
}

/**
 * Mini-terminal ao vivo embutido no chat: a saída de comandos (npm test, build...)
 * é transmitida de forma incremental e renderizada linha a linha, com rolagem
 * automática, cursor pulsante enquanto roda e tinta âmbar quando o último fluxo
 * foi stderr. Estilo HUD/console futurista, sem libs extras.
 */
function TerminalLog({ activity }: { activity: AgentActivityEvent }): JSX.Element {
  const bodyRef = useRef<HTMLPreElement>(null)
  const live = activity.status === 'running' || activity.status === 'output'
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [activity.output, activity.status])

  const headDot = live
    ? 'animate-pulse bg-emerald-300 shadow-glow'
    : activity.status === 'error' || activity.ok === false
      ? 'bg-rose-300'
      : 'bg-cyan-300/50'
  const bodyTint =
    activity.stream === 'stderr' && live
      ? 'text-amber-100/85'
      : activity.status === 'error' || activity.ok === false
        ? 'text-rose-100/80'
        : 'text-emerald-100/80'

  return (
    <div className="mt-1 overflow-hidden rounded-md border border-cyan-300/15 bg-black/45">
      <div className="flex items-center gap-2 border-b border-cyan-300/10 bg-cyan-400/5 px-2 py-1">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${headDot}`} />
        <span className="min-w-0 truncate font-mono text-[10px] text-cyan-200/60">
          {activity.command || activity.title}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wider text-cyan-300/40">
          {live ? 'ao vivo' : activity.ok === false ? 'falhou' : 'concluído'}
        </span>
      </div>
      <pre
        ref={bodyRef}
        className={`max-h-44 overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-[11px] leading-relaxed ${bodyTint}`}
      >
        {activity.output}
        {live && (
          <motion.span
            className="ml-0.5 inline-block h-3 w-1.5 translate-y-[2px] bg-emerald-300/90"
            animate={{ opacity: [1, 0.15, 1] }}
            transition={{ duration: 0.9, repeat: Infinity }}
          />
        )}
      </pre>
    </div>
  )
}

function activityStatus(a: AgentActivityEvent): string {
  if (a.status === 'running') return 'EXEC'
  if (a.status === 'output') return a.stream === 'stderr' ? 'ERR' : 'OUT'
  if (a.status === 'waiting') return 'AGUARDA'
  if (a.status === 'error') return 'ERRO'
  return a.ok === false ? 'FALHOU' : 'OK'
}

function activityDot(a: AgentActivityEvent): string {
  if (a.status === 'running') return 'animate-pulse bg-cyan-300 shadow-glow'
  if (a.status === 'waiting') return 'bg-amber-300'
  if (a.status === 'error' || a.ok === false) return 'bg-rose-300'
  if (a.status === 'output') return a.stream === 'stderr' ? 'bg-amber-300/80' : 'bg-cyan-300/60'
  return 'bg-emerald-300'
}

function ThinkingDots(): JSX.Element {
  return (
    <span className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-cyan-300"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </span>
  )
}
