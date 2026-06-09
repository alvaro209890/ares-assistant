import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

// Select moderno do Ares (tema HUD ciano/escuro). Substitui o <select> nativo, cujo
// dropdown era renderizado pelo SO (fundo branco, bugado, fora do tema escuro). Aqui o
// trigger é um botão estilizado e a lista é um painel React renderizado em PORTAL
// (position: fixed) — assim nunca é cortado por containers com overflow nem cai no widget
// nativo. Tem navegação por teclado, ARIA e fecha ao clicar fora / Esc.

export interface SelectOption {
  value: string
  label: string
  /** Emoji/glyph opcional exibido antes do rótulo. */
  icon?: string
  /** Linha secundária menor (dica). */
  hint?: string
  disabled?: boolean
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /** Classes extras no trigger (ex.: borda/brilho por provedor). */
  className?: string
  /** Largura do trigger (ex.: 'w-[150px]'); padrão ocupa a largura do container. */
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
}

interface MenuRect {
  left: number
  top: number
  width: number
  /** Quando true, o menu abre para cima (não cabia embaixo). */
  up: boolean
  maxHeight: number
}

const MENU_GAP = 6
const MENU_MAX = 280

export default function Select({
  value,
  onChange,
  options,
  className = '',
  placeholder = 'Selecionar…',
  ariaLabel,
  disabled = false
}: SelectProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<MenuRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  const computeRect = useCallback((): void => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - MENU_GAP
    const above = r.top - MENU_GAP
    const up = below < Math.min(MENU_MAX, options.length * 40 + 12) && above > below
    const maxHeight = Math.min(MENU_MAX, (up ? above : below) - 4)
    setRect({ left: r.left, top: up ? r.top - MENU_GAP : r.bottom + MENU_GAP, width: r.width, up, maxHeight })
  }, [options.length])

  const openMenu = useCallback((): void => {
    if (disabled) return
    computeRect()
    setActive(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }, [computeRect, disabled, selectedIndex])

  const close = useCallback((): void => setOpen(false), [])

  const choose = useCallback(
    (opt: SelectOption): void => {
      if (opt.disabled) return
      onChange(opt.value)
      setOpen(false)
      triggerRef.current?.focus()
    },
    [onChange]
  )

  // Reposiciona enquanto aberto (scroll/resize) e fecha ao clicar fora.
  useEffect(() => {
    if (!open) return
    const onScroll = (): void => computeRect()
    const onResize = (): void => computeRect()
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [open, computeRect])

  // Mantém a opção ativa visível.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    const el = menuRef.current.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onTriggerKey = (e: React.KeyboardEvent): void => {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => nextEnabled(options, i, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => nextEnabled(options, i, -1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(nextEnabled(options, -1, 1))
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(nextEnabled(options, options.length, -1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const opt = options[active]
      if (opt) choose(opt)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
        className={`input flex items-center gap-2 text-left ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}
      >
        {selected?.icon && <span className="text-base leading-none">{selected.icon}</span>}
        <span className={`flex-1 truncate ${selected ? '' : 'text-cyan-200/40'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-cyan-300/70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              ref={menuRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              initial={{ opacity: 0, y: rect.up ? 6 : -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: rect.up ? 6 : -6, scale: 0.98 }}
              transition={{ duration: 0.13, ease: 'easeOut' }}
              style={{
                position: 'fixed',
                left: rect.left,
                width: rect.width,
                maxHeight: rect.maxHeight,
                ...(rect.up ? { bottom: window.innerHeight - rect.top } : { top: rect.top }),
                zIndex: 1000
              }}
              className="overflow-y-auto rounded-lg border border-cyan-300/30 bg-[#060b16]/95 p-1 shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_18px_rgba(56,225,255,0.12)] backdrop-blur-md"
            >
              {options.map((opt, i) => {
                const isSel = opt.value === value
                const isActive = i === active
                return (
                  <div
                    key={opt.value}
                    data-idx={i}
                    role="option"
                    aria-selected={isSel}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(opt)}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                      opt.disabled
                        ? 'cursor-not-allowed text-cyan-200/30'
                        : isActive
                          ? 'bg-cyan-400/15 text-cyan-50'
                          : 'text-cyan-100/85'
                    }`}
                  >
                    {opt.icon && <span className="text-base leading-none">{opt.icon}</span>}
                    <span className="flex-1 truncate">
                      {opt.label}
                      {opt.hint && <span className="ml-1 text-[11px] text-cyan-200/40">{opt.hint}</span>}
                    </span>
                    {isSel && (
                      <svg className="h-3.5 w-3.5 shrink-0 text-cyan-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

/** Próximo índice habilitado na direção dada (com wrap). */
function nextEnabled(options: SelectOption[], from: number, dir: 1 | -1): number {
  const n = options.length
  if (n === 0) return 0
  let i = from
  for (let step = 0; step < n; step++) {
    i = (i + dir + n) % n
    if (!options[i]?.disabled) return i
  }
  return Math.max(0, Math.min(n - 1, from))
}
