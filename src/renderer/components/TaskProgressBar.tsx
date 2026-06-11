import { AnimatePresence, motion } from 'framer-motion'
import type { TaskProgressEvent } from '../../shared/types'

interface TaskProgressBarProps {
  task: TaskProgressEvent | null
}

/**
 * HUD de progresso da tarefa atual. Aparece quando o backend emite 'start' e some
 * automaticamente em 'end'. Texto + barra opcional (com `percent`) + spinner para
 * casos sem percentual. Estilo cyan/HUD para combinar com o resto do app.
 */
export default function TaskProgressBar({ task }: TaskProgressBarProps): JSX.Element {
  return (
    <AnimatePresence>
      {task && task.status !== 'end' && (
        <motion.div
          key={task.id}
          layout
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="glass pointer-events-none flex w-full max-w-[480px] items-center gap-3 rounded-full border border-cyan-300/30 bg-black/35 px-4 py-1.5 text-[11px] title-track text-cyan-100"
          role="status"
          aria-live="polite"
        >
          <motion.span
            className="h-2 w-2 rounded-full bg-cyan-300 shadow-glow"
            animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.3, 1] }}
            transition={{ duration: 1.1, repeat: Infinity }}
          />
          <span className="min-w-0 flex-1 truncate" title={task.label}>
            {task.label}
          </span>
          {typeof task.percent === 'number' && (
            <span className="shrink-0 text-cyan-200/80">{Math.round(task.percent)}%</span>
          )}
          <div className="relative h-1 w-24 shrink-0 overflow-hidden rounded-full bg-cyan-300/15">
            {typeof task.percent === 'number' ? (
              <motion.div
                className="absolute inset-y-0 left-0 bg-cyan-300"
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(0, Math.min(100, task.percent))}%` }}
                transition={{ duration: 0.25 }}
              />
            ) : (
              <motion.div
                className="absolute inset-y-0 w-1/3 bg-cyan-300"
                animate={{ x: ['-100%', '300%'] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
