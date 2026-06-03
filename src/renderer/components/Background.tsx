import { motion } from 'framer-motion'

// Fundo dinâmico do HUD: gradientes profundos, grade, linha de varredura e
// partículas flutuantes sutis (leve parallax).
export default function Background(): JSX.Element {
  const dots = Array.from({ length: 26 })
  return (
    <>
      <div className="ares-bg" />
      <div className="ares-grid" />
      {/* linha de varredura estilo scanner */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-cyan-400/5 to-transparent animate-scan" />
      </div>
      {/* partículas */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {dots.map((_, i) => {
          const left = (i * 37) % 100
          const dur = 9 + (i % 7)
          const delay = (i % 5) * 1.3
          const size = 1 + (i % 3)
          return (
            <motion.span
              key={i}
              className="absolute rounded-full bg-cyan-300/40"
              style={{ left: `${left}%`, width: size, height: size, bottom: -10 }}
              animate={{ y: [0, -window.innerHeight - 40], opacity: [0, 0.7, 0] }}
              transition={{ duration: dur, delay, repeat: Infinity, ease: 'linear' }}
            />
          )
        })}
      </div>
    </>
  )
}
