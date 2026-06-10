import { motion } from 'framer-motion'
import { useAres } from '../lib/store'
import HiveDashboard from '../components/HiveDashboard'
import Conversation from '../components/Conversation'
import Controls from '../components/Controls'
import StateIndicator from '../components/StateIndicator'

// Aba "Escritório": a Colmeia em ação. O Ares (Manager) no topo orquestrando os
// subagentes especialistas, com o mesmo chat (texto + voz) da aba principal —
// quem fala com o usuário continua sendo só o Ares.
export default function Office(): JSX.Element {
  const { aresState, conversation, status, hiveWorkers } = useAres()

  return (
    <motion.div
      key="office"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full min-h-[680px] flex-col gap-4 p-5"
    >
      <header className="flex items-center justify-between px-1">
        <div>
          <h2 className="font-display text-xl text-cyan-100 neon-text">ESCRITÓRIO</h2>
          <p className="text-xs text-cyan-200/50">
            A equipe do Ares: ele delega tarefas grandes ao Investigador, ao Construtor e ao Crítico, e sintetiza os
            relatórios para você.
          </p>
        </div>
        <StateIndicator state={aresState} />
      </header>

      <section className="glass rounded-2xl p-4">
        <HiveDashboard workers={hiveWorkers} aresState={aresState} />
      </section>

      {status && (
        <div className="mx-auto max-w-[560px] truncate rounded-full border border-amber-300/20 bg-black/25 px-3 py-1 text-xs text-amber-200/85 backdrop-blur-md">
          {status}
        </div>
      )}

      <section className="glass flex min-h-0 flex-1 flex-col rounded-2xl p-4">
        <h3 className="mb-3 px-1 text-xs title-track text-cyan-300/60">CONVERSA</h3>
        <div className="min-h-0 flex-1">
          <Conversation messages={conversation} />
        </div>
        <div className="mt-3">
          <Controls />
        </div>
      </section>
    </motion.div>
  )
}
