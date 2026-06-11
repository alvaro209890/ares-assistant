import { motion, AnimatePresence } from 'framer-motion'
import type { AresState, HiveWorkerStatus, SubagentId, WorkerPhase } from '../../shared/types'

// Dashboard da Colmeia: o Ares (gerente) no topo e os três especialistas em
// fileira vertical, cada um com avatar, cor própria e um BALÃO de fala que
// mostra o que está fazendo agora. CSS/SVG puro — sem canvas.

const PHASE_LABEL: Record<WorkerPhase, string> = {
  idle: 'em prontidão',
  thinking: 'trabalhando',
  done: 'relatório entregue',
  error: 'falha'
}

// Identidade visual de cada especialista (classes Tailwind estáticas).
const AGENT_META: Record<
  SubagentId,
  {
    name: string
    role: string
    initial: string
    ring: string // anel do avatar
    avatarBg: string
    accentText: string
    activeCard: string
    bubble: string
    bubbleTail: string
    idleBubble: string
  }
> = {
  researcher: {
    name: 'Atena',
    role: 'Investigadora · pesquisa e fatos',
    initial: 'A',
    ring: 'border-violet-300/60',
    avatarBg: 'from-violet-400/30 to-fuchsia-500/10 text-violet-100',
    accentText: 'text-violet-200',
    activeCard: 'border-violet-300/50 bg-violet-400/10 shadow-glow',
    bubble: 'border-violet-300/35 bg-violet-400/12 text-violet-100',
    bubbleTail: 'border-violet-300/35 bg-[#120b22]',
    idleBubble: 'Aguardando uma investigação, senhor.'
  },
  engineer: {
    name: 'Hefesto',
    role: 'Construtor · forja o código',
    initial: 'H',
    ring: 'border-amber-300/60',
    avatarBg: 'from-amber-400/30 to-orange-500/10 text-amber-100',
    accentText: 'text-amber-200',
    activeCard: 'border-amber-300/50 bg-amber-400/10 shadow-glow',
    bubble: 'border-amber-300/35 bg-amber-400/12 text-amber-100',
    bubbleTail: 'border-amber-300/35 bg-[#1c1208]',
    idleBubble: 'Forja acesa. Pronto para construir.'
  },
  auditor: {
    name: 'Têmis',
    role: 'Auditora · qualidade e veredito',
    initial: 'T',
    ring: 'border-emerald-300/60',
    avatarBg: 'from-emerald-400/30 to-teal-500/10 text-emerald-100',
    accentText: 'text-emerald-200',
    activeCard: 'border-emerald-300/50 bg-emerald-400/10 shadow-glow',
    bubble: 'border-emerald-300/35 bg-emerald-400/12 text-emerald-100',
    bubbleTail: 'border-emerald-300/35 bg-[#081a14]',
    idleBubble: 'A balança está calibrada.'
  },
  debugger: {
    name: 'Prometeu',
    role: 'Depurador · erros e causa raiz',
    initial: 'P',
    ring: 'border-rose-300/60',
    avatarBg: 'from-rose-400/30 to-red-500/10 text-rose-100',
    accentText: 'text-rose-200',
    activeCard: 'border-rose-300/50 bg-rose-400/10 shadow-glow',
    bubble: 'border-rose-300/35 bg-rose-400/12 text-rose-100',
    bubbleTail: 'border-rose-300/35 bg-[#1c0a10]',
    idleBubble: 'A tocha está acesa. Traga o erro.'
  }
}

const PHASE_DOT: Record<WorkerPhase, string> = {
  idle: 'bg-cyan-200/30',
  thinking: 'bg-amber-300',
  done: 'bg-emerald-300',
  error: 'bg-red-400'
}

/** Texto do balão conforme a fase: detalhe real do trabalho ou frase de prontidão. */
export function bubbleText(w: HiveWorkerStatus): string {
  if (w.phase === 'idle') return AGENT_META[w.id]?.idleBubble ?? 'Em prontidão.'
  if (w.detail) return w.detail
  if (w.phase === 'thinking') return 'Trabalhando nisso agora...'
  if (w.phase === 'done') return 'Relatório entregue ao Ares.'
  return 'Algo deu errado nesta tarefa.'
}

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
      {/* Ares — o gerente */}
      <div
        className={`relative z-10 flex items-center gap-3 rounded-2xl border px-4 py-3 backdrop-blur transition ${
          busy ? 'border-cyan-300/50 bg-cyan-400/12 shadow-glow' : 'border-cyan-300/20 bg-white/[0.04]'
        }`}
      >
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
          <span className={`absolute inset-0 rounded-full border border-cyan-300/55 ${busy ? 'animate-ping' : 'animate-pulse-ring'}`} />
          <span className="absolute inset-[7px] rounded-full bg-cyan-300 shadow-glow" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg text-cyan-100 neon-text">ARES</span>
          <span className="block truncate text-[11px] text-cyan-200/55">Gerente · delega, acompanha e sintetiza</span>
        </span>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] title-track ${
            anyActive
              ? 'border-amber-300/45 bg-amber-400/10 text-amber-200'
              : busy
                ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100'
                : 'border-cyan-300/15 text-cyan-200/45'
          }`}
        >
          {anyActive ? 'ORQUESTRANDO' : busy ? 'TRABALHANDO' : 'PRONTIDÃO'}
        </span>
      </div>

      {/* A equipe, ligada ao Ares por um trilho com fluxo animado */}
      <div className="relative mt-4 space-y-4 pl-7">
        <span className="pointer-events-none absolute bottom-10 left-[13px] top-[-10px] w-px bg-gradient-to-b from-cyan-300/45 via-cyan-300/15 to-transparent" />
        {workers.map((w) => {
          const meta = AGENT_META[w.id] ?? AGENT_META.researcher
          const active = w.phase === 'thinking'
          return (
            <div key={w.id} className="relative">
              {/* Conector cotovelo: anima quando a informação está fluindo */}
              <svg className="pointer-events-none absolute left-[-15px] top-7 h-2 w-4 overflow-visible" viewBox="0 0 16 8">
                <path
                  d="M 1 0 Q 1 7, 15 7"
                  fill="none"
                  stroke={active ? 'rgba(251,191,36,0.8)' : 'rgba(103,232,249,0.22)'}
                  strokeWidth={active ? 1.6 : 1}
                  strokeDasharray={active ? '3 2.4' : undefined}
                  className={active ? 'hive-flow' : undefined}
                />
              </svg>

              <div className={`rounded-2xl border px-3.5 py-3 transition ${active ? meta.activeCard : 'border-cyan-300/12 bg-white/[0.03]'}`}>
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
                    <motion.span
                      className={`absolute inset-0 rounded-full border ${meta.ring}`}
                      animate={active ? { scale: [1, 1.12, 1], opacity: [0.9, 0.5, 0.9] } : { scale: 1, opacity: 0.55 }}
                      transition={active ? { duration: 1.4, repeat: Infinity } : undefined}
                    />
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br font-display text-base ${meta.avatarBg}`}>
                      {meta.initial}
                    </span>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="font-display text-base text-cyan-50">{meta.name}</span>
                      <span className={`flex items-center gap-1.5 text-[10px] ${w.phase === 'error' ? 'text-red-300' : meta.accentText}`}>
                        <motion.span
                          className={`h-1.5 w-1.5 rounded-full ${PHASE_DOT[w.phase]}`}
                          animate={active ? { opacity: [1, 0.25, 1] } : { opacity: 1 }}
                          transition={active ? { duration: 1, repeat: Infinity } : undefined}
                        />
                        {PHASE_LABEL[w.phase]}
                      </span>
                    </span>
                    <span className="block truncate text-[11px] text-cyan-200/45">{meta.role}</span>
                  </span>
                </div>

                {/* Balão de fala */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${w.phase}-${w.detail ?? ''}`}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 2 }}
                    transition={{ duration: 0.18 }}
                    className="relative ml-12 mt-2.5"
                  >
                    <span
                      className={`absolute -top-[5px] left-4 h-2.5 w-2.5 rotate-45 border-l border-t ${
                        w.phase === 'error'
                          ? 'border-red-400/40 bg-[#1a0a10]'
                          : w.phase === 'idle'
                            ? 'border-cyan-300/15 bg-[#070d1a]'
                            : meta.bubbleTail
                      }`}
                    />
                    <div
                      className={`rounded-xl border px-3 py-1.5 text-[11.5px] leading-snug ${
                        w.phase === 'error'
                          ? 'border-red-400/40 bg-red-500/10 text-red-200'
                          : w.phase === 'idle'
                            ? 'border-cyan-300/15 bg-black/25 text-cyan-200/45 italic'
                            : meta.bubble
                      }`}
                      title={w.detail || undefined}
                    >
                      <span className="line-clamp-2">{bubbleText(w)}</span>
                      {active && <ThinkingDots />}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ThinkingDots(): JSX.Element {
  return (
    <span className="ml-1 inline-flex gap-0.5 align-baseline">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block h-1 w-1 rounded-full bg-current"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.22 }}
        />
      ))}
    </span>
  )
}
