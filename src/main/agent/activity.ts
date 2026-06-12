// Emissão e modelagem de "atividades do agente" (workspace, write, command,
// terminal, hive...). Mantido isolado para que o router e o orquestrador se
// preocupem só com a lógica do turno e deleguem a observabilidade do passo aqui.

import type { Acao, AgentActivityEvent, AgentActivityKind } from '../../shared/types'
import type { ActivityFn, ProgressFn } from './types'

export const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export type ActivityMeta = {
  id: string
  kind: AgentActivityKind
  title: string
  detail?: string
  target?: string
  command?: string
}

// Cap por EVENTO de output (o renderer agrega os eventos num terminal ao vivo
// com cap próprio). Grande o bastante para não picotar stack traces.
const OUTPUT_EVENT_MAX_CHARS = 2000

export function emitActivity(
  onActivity: ActivityFn | undefined,
  meta: ActivityMeta | null,
  patch: Omit<AgentActivityEvent, 'id' | 'kind' | 'title' | 'phase' | 'ts'>
): void {
  if (!onActivity || !meta) return
  onActivity({
    id: meta.id,
    kind: meta.kind,
    title: meta.title,
    phase: 1,
    ts: Date.now(),
    detail: meta.detail,
    target: meta.target,
    command: meta.command,
    ...patch
  })
}

export function codeActivityMeta(a: Acao): ActivityMeta | null {
  const tipo = String(a.tipo || '')
  if (tipo.startsWith('subagente.')) {
    const goal = String(a.objetivo || a.tarefa || a.consulta || '').slice(0, 120) || undefined
    const title =
      tipo === 'subagente.pesquisar'
        ? 'Atena investigando'
        : tipo === 'subagente.construir'
          ? 'Hefesto projetando'
          : tipo === 'subagente.depurar'
            ? 'Prometeu depurando'
            : 'Têmis auditando'
    return { id: uid('act'), kind: 'hive', title, detail: goal }
  }
  if (!tipo.startsWith('codigo.')) return null
  const path = String(a.path || a.raiz || a.workspace || a.destino || a.onde || '').trim()
  const file = String(a.arquivo || a.file || '').trim()
  const command = String(a.comando || a.command || '').trim()
  const query = String(a.consulta || a.query || a.simbolo || '').trim()
  const target = file || path || undefined
  const base = { id: uid('act'), target }
  switch (tipo) {
    case 'codigo.workspace':
      return { ...base, kind: 'workspace', title: 'Analisando workspace', detail: path || undefined }
    case 'codigo.buscar':
      return { ...base, kind: 'search', title: 'Buscando no código', detail: query || undefined }
    case 'codigo.listar':
      return { ...base, kind: 'search', title: 'Listando arquivos', detail: String(a.padrao || a.pattern || a.filtro || '') || undefined }
    case 'codigo.esboco':
      return { ...base, kind: 'read', title: 'Mapeando arquivo', detail: file || undefined }
    case 'codigo.referencias':
      return { ...base, kind: 'search', title: 'Procurando referências', detail: String(a.simbolo || a.symbol || a.nome || '') || undefined }
    case 'codigo.substituir':
      return {
        ...base,
        kind: 'write',
        title: a.confirmado === true || a.aplicar === true ? 'Substituindo no projeto' : 'Prévia de substituição',
        detail: `${String(a.de ?? a.find ?? a.antigo ?? '')} -> ${String(a.para ?? a.replace ?? a.novo ?? '')}`.slice(0, 120)
      }
    case 'codigo.ler':
      return { ...base, kind: 'read', title: 'Lendo arquivo', detail: file || undefined }
    case 'codigo.explicar':
      return { ...base, kind: 'read', title: 'Analisando trecho', detail: file || undefined }
    case 'codigo.comando':
      return { ...base, kind: 'command', title: 'Rodando comando', command }
    case 'codigo.terminal':
      return { ...base, kind: 'terminal', title: 'Terminal', command }
    case 'codigo.confirmar':
      return { ...base, kind: 'terminal', title: 'Executando comando autorizado' }
    case 'codigo.cancelar':
      return { ...base, kind: 'terminal', title: 'Cancelando comando pendente' }
    case 'codigo.git':
      return { ...base, kind: 'git', title: 'Consultando Git', detail: String(a.operacao || a.operation || 'status') }
    case 'codigo.indexar':
      return { ...base, kind: 'index', title: 'Indexando projeto', detail: path || undefined }
    case 'codigo.scaffold':
      return { ...base, kind: 'scaffold', title: 'Criando projeto', detail: String(a.nome || a.name || a.projeto || '') || undefined }
    case 'codigo.criar':
      return { ...base, kind: 'write', title: 'Escrevendo arquivo', detail: file || undefined }
    case 'codigo.editar':
      return { ...base, kind: 'write', title: 'Editando arquivo', detail: file || undefined }
    case 'codigo.diagnostico':
      return { ...base, kind: 'diagnostic', title: 'Rodando diagnóstico', detail: path || undefined }
    case 'codigo.testar':
      return { ...base, kind: 'command', title: 'Rodando testes', detail: path || undefined }
    case 'codigo.lint':
      return { ...base, kind: 'command', title: 'Rodando lint', detail: path || undefined }
    case 'codigo.formatar':
      return { ...base, kind: 'command', title: 'Formatando projeto', detail: path || undefined }
    case 'codigo.typecheck':
      return { ...base, kind: 'command', title: 'Checando tipos', detail: path || undefined }
    case 'codigo.deps':
      return { ...base, kind: 'command', title: 'Checando dependências', detail: path || undefined }
    case 'codigo.todo':
      return { ...base, kind: 'search', title: 'Procurando pendências', detail: path || undefined }
    case 'codigo.projeto':
      return { ...base, kind: 'write', title: 'Executando coder autônomo', detail: String(a.objetivo || a.tarefa || '') || undefined }
    case 'codigo.patch.preview':
      return { ...base, kind: 'patch', title: 'Validando patch', detail: path || undefined }
    case 'codigo.patch.aplicar':
      return { ...base, kind: 'patch', title: 'Aplicando patch', detail: path || undefined }
    default:
      return { ...base, kind: 'tool', title: tipo.replace('codigo.', 'Código: ') }
  }
}

export function activityDetail(result: unknown): string | undefined {
  const r = result as { resultado?: Record<string, unknown>; erro?: string }
  if (r.erro) return r.erro
  const o = r.resultado || {}
  if (typeof o.summary === 'string' && o.summary) return o.summary
  if (typeof o.file === 'string') return o.file
  if (Array.isArray(o.files) && o.files.length) return `${o.files.length} arquivo(s)`
  if (Array.isArray(o.created) && o.created.length) return `${o.created.length} arquivo(s) criados`
  if (typeof o.command === 'string' && Object.prototype.hasOwnProperty.call(o, 'code')) return `código ${String(o.code)}`
  if (typeof o.root === 'string') return o.root
  return undefined
}

export function activityOk(result: unknown): boolean | undefined {
  const r = result as { resultado?: Record<string, unknown>; erro?: string }
  if (r.erro) return false
  const o = r.resultado || {}
  if (typeof o.ok === 'boolean') return o.ok
  if (typeof o.applied === 'boolean') return o.applied
  if (typeof o.ran === 'boolean' && typeof o.requiresApproval === 'boolean') return o.ran ? o.ok === true : undefined
  return true
}

/**
 * Pipe de stdout/stderr para a UI em STREAMING INCREMENTAL: os pedaços são
 * acumulados entre emissões e enviados CRUS (o renderer concatena e renderiza
 * um mini-terminal ao vivo, linha a linha). Throttle leve (120 ms) segura o
 * IPC sem perder conteúdo — antes, só as últimas 4 linhas de cada chunk
 * sobreviviam e a saída "pulava" em blocos no fim.
 */
export function createProgressActivity(onActivity: ActivityFn | undefined, meta: ActivityMeta | null): ProgressFn {
  let pending = ''
  let pendingStream: 'stdout' | 'stderr' = 'stdout'
  let last = 0
  const flush = (): void => {
    const output = pending.slice(-OUTPUT_EVENT_MAX_CHARS)
    pending = ''
    if (output) emitActivity(onActivity, meta, { status: 'output', stream: pendingStream, output })
  }
  return ({ stream, chunk }) => {
    if (!chunk) return
    // Troca de fluxo (stdout <-> stderr): emite o acumulado antes para o
    // renderer poder colorir o erro separadamente.
    if (pending && stream !== pendingStream) flush()
    pendingStream = stream
    pending += chunk
    const now = Date.now()
    if (now - last < 120 && !chunk.includes('\n')) return
    last = now
    flush()
  }
}

// Frases variadas (rotação) para não soar robótico repetindo sempre o mesmo aviso.
const LONG_TASK_ANNOUNCES = [
  ' Iniciando a tarefa, senhor. Um momento.',
  ' Certo, executando agora. Isso pode levar um instante.',
  ' Em andamento. Aviso assim que terminar.'
]
let announceIdx = 0

/**
 * Avisa em voz "iniciando a tarefa" ANTES de bloquear num comando de longa duração
 * (build/install/test), para não deixar o usuário no vácuo. Só fala quando o comando
 * realmente vai rodar (já autorizado ou seguro) — nunca antes de pedir o "sim".
 * `phase` deve ser a fase de streaming ATUAL (com o loop de rodadas, não é sempre 1).
 */
export function announceLongTask(
  onDelta: ((chunk: string, phase: number, kind?: 'both' | 'display' | 'speak', done?: boolean) => void) | undefined,
  isLongRunning: (cmd: string) => boolean,
  command: string,
  willRun: boolean,
  phase: number
): void {
  if (!onDelta || !willRun || !isLongRunning(command)) return
  onDelta(LONG_TASK_ANNOUNCES[announceIdx++ % LONG_TASK_ANNOUNCES.length], phase, 'both', true)
}
