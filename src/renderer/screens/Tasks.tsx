import { motion } from 'framer-motion'
import KanbanBoard from '../components/KanbanBoard'

export default function Tasks(): JSX.Element {
  return (
    <motion.div
      key="tasks"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="flex h-full min-h-[680px] flex-col p-5"
    >
      <div className="pb-3">
        <h2 className="font-display text-sm title-track text-cyan-300/60">QUADRO DE TAREFAS</h2>
        <p className="mt-1 text-xs text-cyan-200/40">
          Arraste cartões entre as colunas — ou peça ao Ares por voz/texto.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <KanbanBoard />
      </div>
    </motion.div>
  )
}
