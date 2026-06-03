import { AnimatePresence, motion } from 'framer-motion'
import { useAres } from './lib/store'
import Background from './components/Background'
import TopBar from './components/TopBar'
import SettingsPanel from './components/SettingsPanel'
import BriefingPanel from './components/BriefingPanel'
import Assistant from './screens/Assistant'
import Tasks from './screens/Tasks'
import Calendar from './screens/Calendar'
import Memory from './screens/Memory'
import System from './screens/System'

export default function App(): JSX.Element {
  const { ready, screen, error, clearError, actionToast } = useAres()

  return (
    <div className="relative h-full w-full text-cyan-50">
      <Background />

      {!ready ? (
        <Boot />
      ) : (
        <div className="relative z-10 flex h-full min-h-0">
          <TopBar />
          <main className="main-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <AnimatePresence mode="wait">
              {screen === 'assistant' && <Assistant key="a" />}
              {screen === 'tasks' && <Tasks key="t" />}
              {screen === 'calendar' && <Calendar key="c" />}
              {screen === 'memory' && <Memory key="m" />}
              {screen === 'system' && <System key="s" />}
            </AnimatePresence>
          </main>
        </div>
      )}

      <SettingsPanel />
      <BriefingPanel />

      {/* Toast de ação de tarefas */}
      <AnimatePresence>
        {actionToast && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            className="glass-strong fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-5 py-2 text-sm text-cyan-100 shadow-glow"
          >
            {actionToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Erros amigáveis */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed left-1/2 top-4 z-50 flex max-w-[640px] -translate-x-1/2 items-center gap-3 rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-2.5 text-sm text-red-100 backdrop-blur"
          >
            <span className="flex-1">{error}</span>
            <button onClick={clearError} className="text-red-200/70 hover:text-white">
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Boot(): JSX.Element {
  return (
    <div className="relative z-10 flex h-full items-center justify-center">
      <motion.div
        className="font-display text-3xl title-track text-cyan-100 neon-text"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.6, repeat: Infinity }}
      >
        INICIANDO ARES…
      </motion.div>
    </div>
  )
}
