import { useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAres } from '../lib/store'
import Select from '../components/Select'
import type { MemoryCategory, MemoryContradictionAction, MemoryFact, ConsolidationEvent } from '../../shared/types'
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABEL } from '../../shared/types'

const CATEGORY_OPTIONS = MEMORY_CATEGORIES.map((c) => ({ value: c, label: MEMORY_CATEGORY_LABEL[c] }))

const CAT_CLASS: Record<MemoryCategory, string> = {
  perfil: 'border-cyan-300/35 text-cyan-200',
  preferencias: 'border-blue-300/35 text-blue-200',
  rotina: 'border-emerald-300/35 text-emerald-200',
  trabalho: 'border-amber-300/35 text-amber-200',
  projetos: 'border-indigo-300/35 text-indigo-200',
  restricoes: 'border-red-300/40 text-red-200',
  interesses: 'border-pink-300/35 text-pink-200',
  outros: 'border-cyan-300/20 text-cyan-200/70'
}

export default function Memory(): JSX.Element {
  const {
    memory,
    addMemory,
    updateMemory,
    resolveMemory,
    removeMemory,
    consolidateMemory,
    sessions,
    currentSessionId,
    openSession,
    createSession,
    renameSession,
    deleteSession
  } = useAres()
  const [fact, setFact] = useState('')
  const [newCat, setNewCat] = useState<MemoryCategory>('outros')
  const [filter, setFilter] = useState<'todas' | MemoryCategory>('todas')
  const [activeTab, setActiveTab] = useState<'facts' | 'timeline'>('facts')
  const [logEvents, setLogEvents] = useState<ConsolidationEvent[]>([])
  const [consolidating, setConsolidating] = useState(false)

  // Carregar timeline logs de consolidação
  useEffect(() => {
    window.ares.memory.log().then((events) => {
      setLogEvents([...events].reverse())
    }).catch(() => {})
  }, [memory])

  // Fatos que possuem contradição e aguardam resposta manual
  const conflicts = useMemo(() => memory.filter((m) => m.review === 'possible_conflict' && m.conflictQuestion), [memory])

  // Fatos ativos, probatórios ou anti-fatos para a listagem (excluindo os arquivados)
  const listableFacts = useMemo(() => {
    return memory.filter(
      (m) =>
        m.status !== 'archived' &&
        m.review !== 'possible_conflict' && // oculta contradições pendentes da lista geral até serem resolvidas
        (filter === 'todas' || m.category === filter)
    )
  }, [memory, filter])

  // Orçamento rígido de 2000 caracteres
  const totalChars = useMemo(() => {
    const activeOrProb = memory.filter((m) => (m.status === 'active' || m.status === 'probationary') && !m.antiFact)
    const entries = activeOrProb.map((f) => f.text)
    return entries.length ? entries.join('\n§\n').length : 0
  }, [memory])

  const budgetPct = Math.min(100, Math.round((totalChars / 2000) * 100))

  const submitFact = () => {
    const t = fact.trim()
    if (!t) return
    void addMemory(t, newCat)
    setFact('')
  }

  const triggerConsolidation = async () => {
    setConsolidating(true)
    try {
      await consolidateMemory()
    } catch {
      /* best-effort */
    } finally {
      setConsolidating(false)
    }
  }

  return (
    <motion.div
      key="memory"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="grid h-full min-h-[680px] gap-4 p-5 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]"
    >
      {/* Coluna da esquerda: Conversas */}
      <section className="glass flex min-h-0 flex-col rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm title-track text-cyan-100">CONVERSAS</h2>
          <button onClick={() => createSession()} className="btn-ghost px-3 py-1 text-[11px]">
            NOVA
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              active={s.id === currentSessionId}
              title={s.title}
              updatedAt={s.updatedAt}
              onOpen={() => openSession(s.id)}
              onRename={(title) => renameSession(s.id, title)}
              onDelete={() => deleteSession(s.id)}
            />
          ))}
        </div>
      </section>

      {/* Coluna da direita: Memória */}
      <section className="glass flex min-h-0 flex-col rounded-2xl p-4">
        <div className="flex items-center justify-between border-b border-cyan-300/10 pb-2">
          <h2 className="font-display text-sm title-track text-cyan-100">MEMÓRIA DE LONGO PRAZO</h2>
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setActiveTab('facts')}
              className={`px-3 py-1.5 rounded-lg border transition-all ${
                activeTab === 'facts'
                  ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-100 shadow-glow-sm'
                  : 'border-cyan-300/10 text-cyan-200/60 hover:text-cyan-200'
              }`}
            >
              Fatos ({listableFacts.length})
            </button>
            <button
              onClick={() => setActiveTab('timeline')}
              className={`px-3 py-1.5 rounded-lg border transition-all ${
                activeTab === 'timeline'
                  ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-100 shadow-glow-sm'
                  : 'border-cyan-300/10 text-cyan-200/60 hover:text-cyan-200'
              }`}
            >
              Timeline de Sono
            </button>
          </div>
        </div>

        {activeTab === 'facts' ? (
          <div className="flex min-h-0 flex-1 flex-col mt-4">
            {/* Indicador de Orçamento de Caracteres */}
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 mb-4">
              <div className="flex justify-between items-center text-[11px] mb-1.5">
                <span className="text-cyan-200/70 font-medium">Orçamento de Memória Autônoma</span>
                <span className="text-cyan-100 font-semibold">{totalChars} / 2000 caracteres ({budgetPct}%)</span>
              </div>
              <div className="w-full bg-cyan-950/40 rounded-full h-1.5 overflow-hidden border border-cyan-500/10">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    budgetPct > 90 ? 'bg-red-400 shadow-glow-red' : budgetPct > 75 ? 'bg-amber-400' : 'bg-cyan-400 shadow-glow'
                  }`}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
            </div>

            {/* Formulário de adicionar memória */}
            <div className="flex flex-wrap gap-2">
              <input
                className="input min-w-[180px] flex-1"
                placeholder="Adicionar fato (Ex.: trabalha das 9h às 18h)"
                value={fact}
                onChange={(e) => setFact(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitFact()}
              />
              <Select
                ariaLabel="Categoria da nova memória"
                className="w-[150px] border-cyan-300/45 hover:border-cyan-200/70 focus:border-cyan-200/80"
                value={newCat}
                onChange={(v) => setNewCat(v as MemoryCategory)}
                options={CATEGORY_OPTIONS}
              />
              <button onClick={submitFact} disabled={!fact.trim()} className="btn-ghost disabled:opacity-40">
                ADICIONAR
              </button>
            </div>

            {/* Contradições que requerem revisão humana */}
            {conflicts.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-400/5 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-300" />
                  <h3 className="text-[11px] title-track text-amber-200/80 font-semibold">CONFLITOS DETECTADOS ({conflicts.length})</h3>
                  <span className="text-[10px] text-amber-200/50">requer ação verbal</span>
                </div>
                <div className="grid gap-2 max-h-[200px] overflow-y-auto pr-1">
                  {conflicts.map((m) => (
                    <PendingRow
                      key={m.id}
                      fact={m}
                      onResolve={(action) => resolveMemory(m.id, action)}
                      onCategory={(c) => updateMemory(m.id, { category: c })}
                      onDelete={() => removeMemory(m.id, false)} // remove sem anti-fato se descartado na revisão
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Filtro por categoria */}
            <div className="mt-4 flex items-center gap-2">
              <span className="text-[11px] text-cyan-200/45 font-medium">Filtrar:</span>
              <Select
                ariaLabel="Filtrar por categoria"
                className="w-[170px] border-cyan-300/45 py-1 hover:border-cyan-200/70 focus:border-cyan-200/80"
                value={filter}
                onChange={(v) => setFilter(v as MemoryCategory | 'todas')}
                options={[{ value: 'todas', label: 'todas categorias' }, ...CATEGORY_OPTIONS]}
              />
            </div>

            {/* Lista principal de fatos */}
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              {listableFacts.length === 0 ? (
                <div className="grid h-full place-items-center text-sm text-cyan-200/40">Nenhum fato nesta categoria.</div>
              ) : (
                <div className="grid gap-2">
                  {listableFacts.map((m) => (
                    <FactRow
                      key={m.id}
                      fact={m}
                      onCategory={(c) => updateMemory(m.id, { category: c })}
                      onText={(t) => updateMemory(m.id, { text: t })}
                      onDelete={() => removeMemory(m.id, !m.antiFact)} // gera anti-fato se remover um fato regular
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col mt-4">
            {/* Cabeçalho da timeline */}
            <div className="flex items-center justify-between bg-black/10 border border-cyan-300/10 rounded-xl p-3 mb-4">
              <div className="text-xs text-cyan-200/70 max-w-[70%]">
                Ciclo de Consolidação ("Sono") roda em background a cada 7 dias ou quando o app fica idle.
                Ele funde duplicatas, promove fatos corroborados e arquiva memórias antigas esquecidas.
              </div>
              <button
                onClick={triggerConsolidation}
                disabled={consolidating}
                className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 active:scale-95 transition-transform"
              >
                {consolidating ? 'CONSOLIDANDO...' : '🔬 CONSOLIDAR AGORA'}
              </button>
            </div>

            {/* Lista da timeline */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              {logEvents.length === 0 ? (
                <div className="grid h-full place-items-center text-sm text-cyan-200/40">Nenhum evento registrado ainda.</div>
              ) : (
                <div className="relative border-l border-cyan-400/20 ml-2.5 pl-4 py-2 grid gap-4">
                  {logEvents.map((e, idx) => (
                    <TimelineEventRow key={idx} event={e} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </motion.div>
  )
}

function CategoryPill({ fact, onCategory }: { fact: MemoryFact; onCategory: (c: MemoryCategory) => void }): JSX.Element {
  return (
    <Select
      ariaLabel="Categoria"
      value={fact.category}
      onChange={(v) => onCategory(v as MemoryCategory)}
      options={CATEGORY_OPTIONS}
      className={`inline-flex w-auto min-w-[110px] rounded-full !py-0.5 !pl-2.5 !pr-2 text-[10px] hover:border-cyan-200/70 focus:border-cyan-200/80 ${CAT_CLASS[fact.category]}`}
    />
  )
}

function FactRow({
  fact,
  onCategory,
  onText,
  onDelete
}: {
  fact: MemoryFact
  onCategory: (c: MemoryCategory) => void
  onText: (t: string) => void
  onDelete: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(fact.text)
  const commit = () => {
    if (draft.trim() && draft.trim() !== fact.text) onText(draft.trim())
    setEditing(false)
  }

  // Mapeia score (de 0 a ~1.2) para uma escala de progresso de barra
  const scoreVal = typeof fact.score === 'number' ? Math.max(0, Math.min(1, fact.score)) : 0
  const scorePct = Math.round(scoreVal * 100)

  return (
    <article className="rounded-xl border border-cyan-300/15 bg-black/20 p-3 hover:border-cyan-300/25 transition-colors">
      <div className="flex items-start gap-3">
        {editing ? (
          <input
            className="input min-w-0 flex-1 py-1"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <p className="min-w-0 flex-1 text-sm text-cyan-50" onDoubleClick={() => setEditing(true)}>
            {fact.text}
            {fact.source === 'auto' && <span className="ml-2 text-[10px] text-cyan-200/40">(auto)</span>}
          </p>
        )}
        <button onClick={() => setEditing(true)} className="text-cyan-200/50 hover:text-cyan-100 p-0.5 rounded hover:bg-white/5" title="Editar">
          ✎
        </button>
        <button onClick={onDelete} className="text-cyan-200/50 hover:text-red-300 p-0.5 rounded hover:bg-white/5" title="Remover">
          ✕
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <CategoryPill fact={fact} onCategory={onCategory} />

        {fact.antiFact ? (
          <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[9px] font-medium text-red-200">
            anti-fato
          </span>
        ) : fact.status === 'probationary' ? (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-200 animate-pulse">
            probatório
          </span>
        ) : (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium text-emerald-200">
            ativo
          </span>
        )}

        {typeof fact.corroborations === 'number' && fact.corroborations > 0 && (
          <span className="text-[9px] text-cyan-300/70 border border-cyan-500/10 rounded-full px-2 py-0.5">
            🔄 {fact.corroborations} {fact.corroborations === 1 ? 'corroboração' : 'corroborações'}
          </span>
        )}

        {typeof fact.score === 'number' && fact.score > -Infinity && (
          <div className="flex items-center gap-1.5 ml-auto text-[9px] text-cyan-200/40 min-w-[100px]">
            <span>Score:</span>
            <div className="flex-1 bg-cyan-950/40 rounded-full h-1 overflow-hidden border border-cyan-500/10">
              <div className="bg-cyan-400 h-full rounded-full" style={{ width: `${scorePct}%` }} />
            </div>
            <span className="font-mono text-[9px]">{fact.score.toFixed(2)}</span>
          </div>
        )}
      </div>
      <MemoryMeta fact={fact} />
    </article>
  )
}

function PendingRow({
  fact,
  onResolve,
  onCategory,
  onDelete
}: {
  fact: MemoryFact
  onResolve: (action: MemoryContradictionAction) => void
  onCategory: (c: MemoryCategory) => void
  onDelete: () => void
}): JSX.Element {
  return (
    <article className="rounded-lg border border-amber-300/15 bg-black/20 p-2.5">
      <p className="mb-2 rounded-lg border border-amber-300/20 bg-amber-400/5 px-2 py-1.5 text-xs text-amber-100/90 font-medium">
        {fact.conflictQuestion}
      </p>
      <p className="text-sm text-cyan-50">{fact.text}</p>
      <MemoryMeta fact={fact} />
      <div className="mt-2 flex items-center gap-2">
        <CategoryPill fact={fact} onCategory={onCategory} />
        <button onClick={() => onResolve('keep_old')} className="ml-auto rounded-full border border-cyan-300/30 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-400/10">
          MANTER ANTIGO
        </button>
        <button onClick={() => onResolve('update_to_new')} className="rounded-full border border-emerald-300/40 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-400/10">
          USAR NOVO
        </button>
        <button onClick={() => onResolve('merge')} className="rounded-full border border-blue-300/35 px-2 py-0.5 text-[10px] text-blue-200 hover:bg-blue-400/10">
          MESCLAR
        </button>
        <button onClick={onDelete} className="rounded-full border border-red-300/30 px-2 py-0.5 text-[10px] text-red-200/80 hover:bg-red-400/10">
          DESCARTAR
        </button>
      </div>
    </article>
  )
}

function MemoryMeta({ fact }: { fact: MemoryFact }): JSX.Element {
  const target = fact.target === 'memory' ? 'notas do agente' : 'perfil do usuário'
  const confidence = typeof fact.confidence === 'number' ? ` · ${(fact.confidence * 100).toFixed(0)}%` : ''
  const review =
    fact.review === 'possible_conflict'
      ? ' · possível conflito'
      : fact.review === 'low_confidence'
        ? ' · baixa confiança'
        : ''
  return (
    <div className="mt-1 text-[10px] text-cyan-200/40">
      {target}
      {confidence}
      {review}
      {fact.evidence?.[0] ? <span className="block truncate font-mono text-cyan-200/35 mt-0.5">evidência: {fact.evidence[0]}</span> : null}
    </div>
  )
}

function SessionRow({
  active,
  title,
  updatedAt,
  onOpen,
  onRename,
  onDelete
}: {
  active: boolean
  title: string
  updatedAt: number
  onOpen: () => void
  onRename: (title: string) => void
  onDelete: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const commit = () => {
    onRename(draft.trim() || title)
    setEditing(false)
  }
  return (
    <div className={`mb-2 rounded-xl border p-3 ${active ? 'border-cyan-300/45 bg-cyan-400/10' : 'border-cyan-300/15 bg-black/20'}`}>
      <div className="flex items-start gap-2">
        {editing ? (
          <input
            className="input min-w-0 flex-1 py-1"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <button onClick={onOpen} className="min-w-0 flex-1 text-left text-sm text-cyan-50">
            <span className="block truncate">{title}</span>
            <span className="mt-1 block text-[11px] text-cyan-200/45">{new Date(updatedAt).toLocaleString('pt-BR')}</span>
          </button>
        )}
        <button onClick={() => setEditing(true)} className="text-cyan-200/50 hover:text-cyan-100" title="Renomear">
          ✎
        </button>
        <button onClick={onDelete} className="text-cyan-200/50 hover:text-red-300" title="Apagar">
          ✕
        </button>
      </div>
    </div>
  )
}

// Linha do log de eventos da consolidação
function TimelineEventRow({ event }: { event: ConsolidationEvent }): JSX.Element {
  const meta = useMemo(() => {
    switch (event.kind) {
      case 'learned':
        return { label: 'Aprendido', icon: '🧠', color: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-200' }
      case 'promoted':
        return { label: 'Promovido', icon: '⬆️', color: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' }
      case 'merged':
        return { label: 'Fundido', icon: '🔗', color: 'bg-blue-500/10 border-blue-500/30 text-blue-200' }
      case 'forgotten':
        return { label: 'Esquecido', icon: '💤', color: 'bg-zinc-800/20 border-zinc-700/30 text-zinc-300/80' }
      case 'expired':
        return { label: 'Expirado', icon: '💤', color: 'bg-red-950/20 border-red-900/30 text-red-200/80' }
      case 'corroborated':
        return { label: 'Corroborado', icon: '🔄', color: 'bg-purple-500/10 border-purple-500/30 text-purple-200' }
      default:
        return { label: 'Evento', icon: '📝', color: 'bg-gray-500/10 border-gray-500/30 text-gray-200' }
    }
  }, [event.kind])

  return (
    <div className="relative">
      {/* Marcador na linha vertical */}
      <span className="absolute -left-[22px] top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-cyan-950 border border-cyan-400/30 text-[9px] shadow-glow-sm">
        {meta.icon}
      </span>
      <article className={`rounded-xl border p-3 ${meta.color} transition-colors`}>
        <div className="flex items-center justify-between text-[10px] opacity-70 mb-1">
          <span className="font-semibold title-track uppercase tracking-wider">{meta.label}</span>
          <span className="font-mono">{new Date(event.ts).toLocaleString('pt-BR')}</span>
        </div>
        <p className="text-sm leading-relaxed">{event.text}</p>
      </article>
    </div>
  )
}
