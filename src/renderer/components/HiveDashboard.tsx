import { motion, AnimatePresence } from 'framer-motion'
import type { AresState, HiveWorkerStatus, SubagentId, WorkerPhase } from '../../shared/types'

// Dashboard da Colmeia: Ares (Manager) no topo orquestrando os três especialistas
// (Workers). Linhas de conexão animadas mostram a informação fluindo quando um
// subagente está trabalhando. CSS/SVG puro — sem canvas.

const PHASE_LABEL: Record<WorkerPhase, string> = {
  idle: 'Ocioso',
  thinking: 'Trabalhando',
  done: 'Relatório entregue',
  error: 'Falha'
}

const PHASE_STYLE: Record<WorkerPhase, { card: string; dot: string; text: string }> = {
  idle: { card: 'border-cyan-300/12 bg-white/[0.03]', dot: 'bg-cyan-200/30', text: 'text-cyan-200/45' },
  thinking: { card: 'border-amber-300/50 bg-amber-400/10 shadow-glow', dot: 'bg-amber-300', text: 'text-amber-200' },
  done: { card: 'border-emerald-300/40 bg-emerald-400/8', dot: 'bg-emerald-300', text: 'text-emerald-200' },
  error: { card: 'border-red-400/45 bg-red-500/10', dot: 'bg-red-400', text: 'text-red-200' }
}

// Posição horizontal (em %) do centro de cada card de worker, para as linhas SVG.
const WORKER_X: Record<SubagentId, number> = { researcher: 17, engineer: 50, auditor: 83 }

export default function HiveDashboard({
  workers,
  aresState
}: {
  workers: HiveWorkerStatus[]
  aresState: AresState
}): JSX.Element {
  const busy = aresState !== 'idle'
  const anyActive = workers.some((w) => w.phase === 'thinking')

  return (
    <div className="relative">
      {/* Ares — o gerente da colmeia */}
      <div className="relative z-10 flex justify-center">
        <div
          className={`flex items-center gap-3 rounded-2xl border px-5 py-3 backdrop-blur transition ${
            busy ? 'border-cyan-300/50 bg-cyan-400/12 shadow-glow' : 'border-cyan-300/20 bg-white/[0.04]'
          }`}
        >
          <span className="relative flex h-9 w-9 items-center justify-center">
            <span className={`absolute inset-0 rounded-full border border-cyan-300/55 ${busy ? 'animate-ping' : 'animate-pulse-ring'}`} />
            <span className="absolute inset-2 rounded-full bg-cyan-300 shadow-glow" />
          </span>
          <span>
            <span className="block font-display text-base text-cyan-100 neon-text">ARES</span>
            <span className="block text-[11px] text-cyan-200/55">
              {anyActive ? 'Orquestrando a equipe' : busy ? 'Trabalhando' : 'Gerente em prontidão'}
            </span>
          </span>
        </div>
      </div>

      {/* Linhas de conexão Ares -> workers (fluxo animado quando ativo) */}
      <svg className="pointer-events-none relative z-0 -my-1 h-12 w-full" viewBox="0 0 100 24" preserveAspectRatio="none">
        {workers.map((w) => {
          const active = w.phase === 'thinking'
          const x = WORKER_X[w.id] ?? 50
          return (
            <path
              key={w.id}
              d={`M 50 0 C 50 14, ${x} 8, ${x} 24`}
              fill="none"
              stroke={active ? 'rgba(251,191,36,0.75)' : 'rgba(103,232,249,0.16)'}
              strokeWidth={active ? 1.1 : 0.6}
              strokeDasharray={active ? '3 2.4' : '1 2.6'}
              className={active ? 'hive-flow' : undefined}
            />
          )
        })}
      </svg>

      {/* Os especialistas */}
      <div className="grid grid-cols-3 gap-3">
        {workers.map((w) => {
          const s = PHASE_STYLE[w.phase]
          return (
            <div key={w.id} className={`min-w-0 rounded-xl border px-3 py-2.5 transition ${s.card}`}>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-current/15 text-cyan-100">
                  <WorkerIcon id={w.id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-cyan-50">{w.label}</span>
                  <span className={`flex items-center gap-1.5 text-[10px] ${s.text}`}>
                    <motion.span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`}
                      animate={w.phase === 'thinking' ? { opacity: [1, 0.25, 1] } : { opacity: 1 }}
                      transition={w.phase === 'thinking' ? { duration: 1, repeat: Infinity } : undefined}
                    />
                    {PHASE_LABEL[w.phase]}
                  </span>
                </span>
              </div>
              <AnimatePresence>
                {w.detail && w.phase !== 'idle' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={`mt-1.5 truncate text-[11px] ${s.text}`}
                    title={w.detail}
                  >
                    {w.detail}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WorkerIcon({ id }: { id: SubagentId }): JSX.Element {
  if (id === 'researcher') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3M8 11h6M11 8v6" strokeLinecap="round" />
      </svg>
    )
  }
  if (id === 'engineer') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M8 6l-5 6 5 6M16 6l5 6-5 6M13 4l-2 16" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
