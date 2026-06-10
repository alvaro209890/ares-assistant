import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAres } from '../lib/store'
import { MEMORY_CATEGORY_LABEL } from '../../shared/types'

// Busca global (Ctrl+K): uma paleta de comandos que procura em tarefas, agenda,
// lembretes, notas, listas, memória e conversas, navega para a tela certa e
// também encaminha qualquer texto como pergunta ao Ares.

const norm = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

interface Entry {
  id: string
  group: string
  label: string
  sub?: string
  run: () => void
}

export default function CommandPalette(): JSX.Element {
  const store = useAres()
  const {
    paletteOpen,
    openPalette,
    navigate,
    sendText,
    board,
    events,
    reminders,
    quickNotes,
    lists,
    memory,
    sessions,
    openSession,
    openBriefing,
    openSettings,
    openHelp,
    createSession
  } = store

  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Ctrl/Cmd+K abre/fecha a paleta de qualquer lugar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openPalette(!paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, openPalette])

  useEffect(() => {
    if (paletteOpen) {
      setQuery('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [paletteOpen])

  const close = (): void => openPalette(false)

  // Índice base de comandos rápidos + navegação.
  const baseEntries = useMemo<Entry[]>(() => {
    const go = (s: Parameters<typeof navigate>[0], label: string, sub: string): Entry => ({
      id: `nav-${s}`,
      group: 'Ir para',
      label,
      sub,
      run: () => {
        navigate(s)
        close()
      }
    })
    return [
      go('assistant', 'Assistente', 'Alt+1'),
      go('tasks', 'Tarefas (Kanban)', 'Alt+2'),
      go('calendar', 'Calendário', 'Alt+3'),
      go('reminders', 'Lembretes', 'Alt+4'),
      go('lists', 'Listas e notas', 'Alt+5'),
      go('memory', 'Memória', 'Alt+6'),
      go('models', 'Modelos de IA', 'Alt+7'),
      go('system', 'Sistema / Diagnóstico', 'Alt+8'),
      go('office', 'Escritório (Colmeia de subagentes)', 'Alt+9'),
      {
        id: 'act-briefing',
        group: 'Ações',
        label: 'Briefing do dia',
        sub: 'clima, agenda, tarefas e notícias',
        run: () => {
          openBriefing(true)
          close()
        }
      },
      {
        id: 'act-new-session',
        group: 'Ações',
        label: 'Nova conversa',
        sub: 'começa um diálogo do zero',
        run: () => {
          void createSession()
          navigate('assistant')
          close()
        }
      },
      {
        id: 'act-settings',
        group: 'Ações',
        label: 'Configurações',
        sub: 'voz, microfone, acessibilidade…',
        run: () => {
          openSettings(true)
          close()
        }
      },
      {
        id: 'act-help',
        group: 'Ações',
        label: 'Ajuda — o que o Ares sabe fazer',
        sub: 'exemplos prontos',
        run: () => {
          openHelp(true)
          close()
        }
      }
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate])

  // Índice dos dados do usuário (limitado para a busca ficar leve).
  const dataEntries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    for (const c of Object.values(board.cards)) {
      out.push({
        id: `task-${c.id}`,
        group: 'Tarefas',
        label: c.title,
        sub: c.done ? 'concluída' : c.due ? `prazo ${new Date(c.due).toLocaleDateString('pt-BR')}` : 'tarefa',
        run: () => {
          navigate('tasks')
          close()
        }
      })
    }
    for (const e of events) {
      out.push({
        id: `ev-${e.id}`,
        group: 'Agenda',
        label: e.title,
        sub: new Date(e.whenISO).toLocaleString('pt-BR'),
        run: () => {
          navigate('calendar')
          close()
        }
      })
    }
    for (const r of reminders) {
      out.push({
        id: `rem-${r.id}`,
        group: 'Lembretes',
        label: r.text,
        sub: `${r.kind === 'timer' ? 'timer' : r.kind === 'alarm' ? 'despertador' : 'lembrete'} · ${new Date(r.whenISO).toLocaleString('pt-BR')}`,
        run: () => {
          navigate('reminders')
          close()
        }
      })
    }
    for (const n of quickNotes) {
      out.push({
        id: `note-${n.id}`,
        group: 'Notas',
        label: n.text.slice(0, 80),
        sub: 'nota rápida',
        run: () => {
          navigate('lists')
          close()
        }
      })
    }
    for (const l of lists) {
      for (const it of l.items) {
        out.push({
          id: `li-${it.id}`,
          group: 'Listas',
          label: it.text,
          sub: `${l.title}${it.done ? ' · ✓' : ''}`,
          run: () => {
            navigate('lists')
            close()
          }
        })
      }
    }
    for (const f of memory) {
      out.push({
        id: `mem-${f.id}`,
        group: 'Memória',
        label: f.text,
        sub: MEMORY_CATEGORY_LABEL[f.category] + (f.status === 'pending' ? ' · para revisar' : ''),
        run: () => {
          navigate('memory')
          close()
        }
      })
    }
    for (const s of sessions) {
      out.push({
        id: `sess-${s.id}`,
        group: 'Conversas',
        label: s.title,
        sub: new Date(s.updatedAt).toLocaleDateString('pt-BR'),
        run: () => {
          void openSession(s.id)
          navigate('assistant')
          close()
        }
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, events, reminders, quickNotes, lists, memory, sessions])

  const results = useMemo<Entry[]>(() => {
    const q = norm(query.trim())
    const askEntry: Entry | null = query.trim()
      ? {
          id: 'ask',
          group: 'Ares',
          label: `Perguntar ao Ares: “${query.trim()}”`,
          sub: 'envia para o assistente',
          run: () => {
            const t = query.trim()
            navigate('assistant')
            close()
            void sendText(t)
          }
        }
      : null

    if (!q) {
      return [...baseEntries].slice(0, 11)
    }
    const all = [...baseEntries, ...dataEntries]
    const matched = all
      .filter((e) => norm(e.label).includes(q) || (e.sub ? norm(e.sub).includes(q) : false))
      .slice(0, 40)
    return askEntry ? [askEntry, ...matched] : matched
  }, [query, baseEntries, dataEntries, sendText, navigate])

  useEffect(() => {
    if (sel >= results.length) setSel(0)
  }, [results, sel])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(results.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      results[sel]?.run()
    }
  }

  // Mantém o item selecionado visível ao navegar com o teclado.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  return (
    <AnimatePresence>
      {paletteOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <motion.div
            className="fixed left-1/2 top-[14vh] z-[61] w-[640px] max-w-[94vw] -translate-x-1/2"
            initial={{ opacity: 0, y: -18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            <div className="glass-strong overflow-hidden rounded-2xl border border-cyan-300/20 shadow-glow">
              <div className="flex items-center gap-3 border-b border-cyan-300/12 px-4">
                <SearchIcon />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Buscar tarefas, agenda, notas, memória… ou pergunte ao Ares"
                  className="h-14 flex-1 bg-transparent text-cyan-50 outline-none placeholder:text-cyan-200/35"
                />
                <kbd className="rounded border border-cyan-300/20 px-1.5 py-0.5 text-[10px] text-cyan-200/45">ESC</kbd>
              </div>

              <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
                {results.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-cyan-200/45">Nada encontrado.</div>
                )}
                {results.map((entry, i) => {
                  const active = i === sel
                  const showGroup = i === 0 || results[i - 1].group !== entry.group
                  return (
                    <div key={entry.id}>
                      {showGroup && (
                        <div className="px-3 pb-1 pt-2 text-[10px] title-track text-cyan-300/45">{entry.group}</div>
                      )}
                      <button
                        data-idx={i}
                        onMouseEnter={() => setSel(i)}
                        onClick={() => entry.run()}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                          active ? 'bg-cyan-400/15 text-cyan-50' : 'text-cyan-100/80 hover:bg-white/[0.04]'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span>
                        {entry.sub && <span className="shrink-0 text-[11px] text-cyan-200/40">{entry.sub}</span>}
                      </button>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center justify-between border-t border-cyan-300/12 px-4 py-2 text-[11px] text-cyan-200/40">
                <span>↑↓ navegar · ↵ abrir · esc fechar</span>
                <span>Ctrl+K</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function SearchIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="text-cyan-200/60">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  )
}
