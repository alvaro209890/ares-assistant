import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAres } from '../lib/store'

export default function Demo(): JSX.Element {
  const { demoState } = useAres()
  const slide = demoState?.currentSlide

  if (!demoState?.isActive) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-cyan-400/50">Aguardando início da apresentação...</p>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex h-full w-full flex-col overflow-hidden bg-[#0A0D14]"
    >
      {/* Barra Superior */}
      <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-cyan-500/20 bg-cyan-900/10 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse" />
          <h1 className="text-sm font-semibold tracking-wide text-cyan-100 uppercase">
            Ares Demo Mode
          </h1>
        </div>
        {slide && (
          <div className="text-xs font-mono text-cyan-400/60">
            SLIDE ID: {slide.id.split('-')[1] || slide.id}
          </div>
        )}
      </header>

      {/* Área Principal (Palco) */}
      <div className="flex flex-1 min-h-0">
        <AnimatePresence mode="wait">
          {slide ? (
            <motion.div
              key={slide.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
              className="flex h-full w-full p-6 gap-6"
            >
              {/* Código ou Conteúdo Principal */}
              <div className="flex flex-1 flex-col rounded-xl border border-cyan-500/10 bg-cyan-950/20 shadow-inner overflow-hidden">
                <div className="flex h-10 items-center border-b border-cyan-500/10 bg-cyan-950/40 px-4">
                  <span className="text-xs font-mono text-cyan-300/70">
                    {slide.filePath ? slide.filePath : 'VIEWPORT'}
                    {slide.lineRange ? ` [${slide.lineRange[0]}-${slide.lineRange[1]}]` : ''}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                  {slide.codeSnippet ? (
                    <pre className="font-mono text-sm leading-relaxed text-cyan-50">
                      <code>{slide.codeSnippet}</code>
                    </pre>
                  ) : (
                    <div className="flex h-full items-center justify-center text-cyan-200/40 italic">
                      Nenhum código para exibir.
                    </div>
                  )}
                </div>
              </div>

              {/* Sidebar de Pontos (Direita) */}
              {(slide.points && slide.points.length > 0) && (
                <div className="flex w-80 flex-col gap-4">
                  {slide.points.map((pt, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.15 + 0.3 }}
                      className="rounded-lg border border-cyan-500/20 bg-cyan-900/10 p-4 shadow-[0_0_15px_rgba(34,211,238,0.05)]"
                    >
                      <div className="mb-1 text-[10px] font-bold text-cyan-400/60 uppercase tracking-wider">
                        Ponto {i + 1}
                      </div>
                      <p className="text-sm text-cyan-100">{pt}</p>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-cyan-500/30">
              [ PALCO VAZIO ]
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Teleprompter Cyberpunk na Base */}
      <AnimatePresence>
        {slide?.title && (
          <motion.div
            key={`title-${slide.id}`}
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="flex-shrink-0 border-t-2 border-cyan-400/50 bg-gradient-to-t from-cyan-950 to-[#0A0D14] p-6 shadow-[0_-10px_40px_rgba(34,211,238,0.1)]"
          >
            <div className="mx-auto max-w-4xl text-center">
              <h2 className="bg-gradient-to-r from-cyan-200 via-cyan-50 to-cyan-200 bg-clip-text text-3xl font-light text-transparent">
                "{slide.title}"
              </h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
