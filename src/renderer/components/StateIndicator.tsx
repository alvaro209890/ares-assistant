import { motion } from 'framer-motion'
import type { AresState } from '../../shared/types'

const LABEL: Record<AresState, string> = {
  idle: 'OCIOSO',
  listening: 'OUVINDO',
  thinking: 'PENSANDO',
  speaking: 'FALANDO'
}

const COLOR: Record<AresState, string> = {
  idle: 'text-cyan-300/70 border-cyan-300/30',
  listening: 'text-emerald-300 border-emerald-300/50',
  thinking: 'text-indigo-300 border-indigo-300/50',
  speaking: 'text-cyan-200 border-cyan-200/60'
}

export default function StateIndicator({ state }: { state: AresState }): JSX.Element {
  return (
    <motion.div
      layout
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs title-track ${COLOR[state]} glass`}
    >
      <motion.span
        className="h-2 w-2 rounded-full bg-current"
        animate={{ opacity: state === 'idle' ? [0.4, 1, 0.4] : [1, 0.5, 1], scale: state === 'thinking' ? [1, 1.4, 1] : 1 }}
        transition={{ duration: state === 'thinking' ? 0.7 : 1.6, repeat: Infinity }}
      />
      {LABEL[state]}
    </motion.div>
  )
}
