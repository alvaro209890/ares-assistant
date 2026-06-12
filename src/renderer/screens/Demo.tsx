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

  const hasCode = !!slide?.codeSnippet && slide.codeSnippet.trim().length > 0
  const points = (slide?.points ?? []).filter((p) => p && p.trim().length > 0)
  const hasPoints = points.length > 0

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
          <h1 className="text-sm font-semibold uppercase tracking-wide text-cyan-100">Ares Demo Mode</h1>
        </div>
        {slide && (
          <div className="font-mono text-xs text-cyan-400/60">SLIDE ID: {slide.id.split('-')[1] || slide.id}</div>
        )}
      </header>

      {/* Área Principal (Palco) */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {slide ? (
            <motion.div
              key={slide.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
              className="flex h-full w-full min-h-0 gap-6 p-6"
            >
              {/* Painel de código — só aparece quando o slide tem código */}
              {hasCode && (
                <div className="flex min-w-0 flex-[1.4] flex-col overflow-hidden rounded-xl border border-cyan-500/15 bg-cyan-950/25 shadow-inner">
                  <div className="flex h-10 flex-shrink-0 items-center border-b border-cyan-500/10 bg-cyan-950/40 px-4">
                    <span className="truncate font-mono text-xs text-cyan-300/70">
                      {slide.filePath ? slide.filePath : 'CÓDIGO'}
                      {slide.lineRange ? ` [${slide.lineRange[0]}-${slide.lineRange[1]}]` : ''}
                    </span>
                  </div>
                  <div className="custom-scrollbar min-h-0 flex-1 overflow-auto p-5">
                    <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-cyan-50">
                      <code>{slide.codeSnippet}</code>
                    </pre>
                  </div>
                </div>
              )}

              {/* Pontos — protagonistas quando não há código, sidebar quando há */}
              {hasPoints && (
                <div
                  className={
                    hasCode
                      ? 'custom-scrollbar flex w-[38%] min-w-0 flex-col gap-3 overflow-y-auto'
                      : 'custom-scrollbar mx-auto flex h-full w-full max-w-3xl min-w-0 flex-col justify-center gap-4 overflow-y-auto py-2'
                  }
                >
                  {points.map((pt, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.12 + 0.25 }}
                      className={`rounded-xl border border-cyan-500/20 bg-cyan-900/10 shadow-[0_0_18px_rgba(34,211,238,0.06)] ${
                        hasCode ? 'p-4' : 'p-5'
                      }`}
                    >
                      <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-cyan-400/60">
                        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-cyan-400/40 text-[11px] text-cyan-300">
                          {i + 1}
                        </span>
                        Ponto {i + 1}
                      </div>
                      <p className={`break-words leading-relaxed text-cyan-50 ${hasCode ? 'text-sm' : 'text-lg'}`}>{pt}</p>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Slide só com título — mostra o título grande e centralizado em vez de palco vazio */}
              {!hasCode && !hasPoints && (
                <div className="flex h-full w-full items-center justify-center">
                  <motion.h2
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="max-w-3xl break-words bg-gradient-to-r from-cyan-200 via-cyan-50 to-cyan-200 bg-clip-text px-6 text-center text-4xl font-light text-transparent"
                  >
                    {slide.title}
                  </motion.h2>
                </div>
              )}
            </motion.div>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-cyan-500/30">[ PALCO VAZIO ]</div>
          )}
        </AnimatePresence>
      </div>

      {/* Teleprompter na base — só quando há conteúdo acima (evita título duplicado) */}
      <AnimatePresence>
        {slide?.title && (hasCode || hasPoints) && (
          <motion.div
            key={`title-${slide.id}`}
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="flex-shrink-0 border-t-2 border-cyan-400/50 bg-gradient-to-t from-cyan-950 to-[#0A0D14] px-6 py-5 shadow-[0_-10px_40px_rgba(34,211,238,0.1)]"
          >
            <div className="mx-auto max-w-4xl text-center">
              <h2 className="break-words bg-gradient-to-r from-cyan-200 via-cyan-50 to-cyan-200 bg-clip-text text-2xl font-light text-transparent md:text-3xl">
                {slide.title}
              </h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
