import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ConvMsg } from '../lib/store'

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
                {m.content || (m.pending ? <ThinkingDots /> : '')}
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  )
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
