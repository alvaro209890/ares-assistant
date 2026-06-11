import { motion } from 'framer-motion'
import { useAres } from '../lib/store'
import HiveDashboard from '../components/HiveDashboard'
import StateIndicator from '../components/StateIndicator'
import ChatPanel from '../components/ChatPanel'

// Aba "Escritório": a Colmeia em ação. Painel da equipe à esquerda (Ares +
// especialistas com balões do que estão fazendo) e o chat unificado (texto +
// voz) à direita — quem fala com o usuário continua sendo só o Ares.
export default function Office(): JSX.Element {
  const { aresState, status, hiveWorkers } = useAres()
  const activeCount = hiveWorkers.filter((w) => w.phase === 'thinking').length

  return (
    <motion.div
      key="office"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full min-h-[680px] flex-col gap-4 p-5"
    >
      <header className="flex items-center justify-between gap-4 px-1">
        <div className="min-w-0">
          <h2 className="font-display text-xl text-cyan-100 neon-text">ESCRITÓRIO</h2>
          <p className="truncate text-xs text-cyan-200/50">
            Atena investiga, Hefesto constrói, Têmis audita — e o Ares gerencia e responde a você.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {activeCount > 0 && (
            <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-3 py-1 text-[11px] text-amber-200">
              {activeCount === 1 ? '1 especialista em ação' : `${activeCount} especialistas em ação`}
            </span>
          )}
          <StateIndicator state={aresState} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        {/* Painel da equipe */}
        <section className="glass relative overflow-hidden rounded-2xl p-4 lg:overflow-y-auto">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-cyan-400/8 to-transparent" />
          <h3 className="relative mb-3 px-1 text-xs title-track text-cyan-300/60">A EQUIPE</h3>
          <div className="relative">
            <HiveDashboard workers={hiveWorkers} aresState={aresState} />
          </div>
        </section>

        {/* Chat unificado (texto + voz) */}
        <ChatPanel title="CONVERSA COM O ARES" status={status} controls />
      </div>
    </motion.div>
  )
}
