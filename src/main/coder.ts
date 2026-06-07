import type { AppConfig } from '../shared/types'
import { chatJSON } from './ninerouter'
import { classifyCommand, resolveCodeWorkspace, runCodeTerminal, summarizeCodeWorkspace, writeCodeFile } from './code'

// ---------------------------------------------------------------------------
// Coder autônomo do Ares.
//
// Dado um OBJETIVO, roda um pequeno laço de agente: planeja, escreve arquivos,
// roda checagens permitidas, vê o resultado e itera até concluir. Usa o mesmo
// cérebro (9Router) e as MESMAS barreiras de segurança das demais ferramentas de
// código: escrita só com `allowPatchApply`, sempre dentro de `allowedRoots`, e
// roda apenas comandos da camada "segura" (allowlist/seguros) — nada de instalar
// dependências ou comandos destrutivos sem o usuário.
//
// `parseCoderStep` é pura e `applyCoderStep` é IO testável (sem LLM); só
// `runCoderTask` chama o modelo.
// ---------------------------------------------------------------------------

const MAX_FILES_PER_STEP = 25
const MAX_FILE_BYTES = 200 * 1024

export interface CoderFile {
  path: string
  content: string
}

export interface CoderStep {
  thought?: string
  files: CoderFile[]
  run: string[]
  done: boolean
  summary: string
}

export interface CoderRun {
  command: string
  ok: boolean
  code: number | null
  summary: string
  ran: boolean
}

export interface CoderStepResult {
  written: string[]
  skipped: string[]
  ran: CoderRun[]
}

export interface CoderStepReport extends CoderStepResult {
  summary: string
  done: boolean
}

export interface CoderResult {
  root: string
  objective: string
  steps: number
  ok: boolean
  summary: string
  transcript: CoderStepReport[]
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Faz o parse robusto da resposta do modelo num passo do coder. Pura. */
export function parseCoderStep(raw: string): CoderStep {
  const text = String(raw || '').trim()
  let obj: Record<string, unknown> | null = null
  const candidates = [text]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1].trim())
  const balanced = extractJsonObject(text)
  if (balanced) candidates.push(balanced)
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c)
      if (parsed && typeof parsed === 'object') {
        obj = parsed as Record<string, unknown>
        break
      }
    } catch {
      /* tenta o próximo */
    }
  }

  const filesRaw = Array.isArray(obj?.files) ? (obj!.files as unknown[]) : []
  const files: CoderFile[] = filesRaw
    .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>) : null))
    .filter((f): f is Record<string, unknown> => !!f && typeof f.path === 'string' && typeof f.content === 'string')
    .slice(0, MAX_FILES_PER_STEP)
    .map((f) => ({ path: String(f.path), content: String(f.content).slice(0, MAX_FILE_BYTES) }))

  const run = (Array.isArray(obj?.run) ? (obj!.run as unknown[]) : [])
    .map((c) => String(c || '').trim())
    .filter(Boolean)
    .slice(0, 8)

  return {
    thought: typeof obj?.thought === 'string' ? obj.thought : undefined,
    files,
    run,
    done: obj?.done === true,
    summary: typeof obj?.summary === 'string' ? obj.summary : ''
  }
}

function tail(s: string, lines = 4): string {
  return String(s || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-lines)
    .join(' | ')
    .slice(0, 300)
}

/** Aplica um passo: escreve os arquivos e roda só os comandos seguros. IO testável. */
export function applyCoderStep(cfg: AppConfig, root: string, step: CoderStep): CoderStepResult {
  const written: string[] = []
  const skipped: string[] = []
  for (const f of step.files) {
    try {
      const w = writeCodeFile(cfg, { root, file: f.path, content: f.content, overwrite: true })
      written.push(w.file)
    } catch (e) {
      skipped.push(`${f.path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const ran: CoderRun[] = []
  for (const command of step.run) {
    const cls = classifyCommand(cfg, command)
    if (cls.tier !== 'allowed') {
      ran.push({ command, ok: false, ran: false, code: null, summary: `pulado (${cls.tier}: precisa de você)` })
      continue
    }
    try {
      const r = runCodeTerminal(cfg, { root, command })
      ran.push({
        command,
        ok: r.ran && r.ok,
        ran: r.ran,
        code: r.code,
        summary: r.ok ? tail(r.stdout) || 'ok' : tail(r.stderr) || `código ${r.code}`
      })
    } catch (e) {
      ran.push({ command, ok: false, ran: false, code: null, summary: e instanceof Error ? e.message : String(e) })
    }
  }
  return { written, skipped, ran }
}

const CODER_SYSTEM =
  'Você é o coder autônomo do Ares: um engenheiro de software sênior que CONSTRÓI o que for pedido, em pt-BR, de forma incremental. ' +
  'A cada passo responda APENAS um objeto JSON válido (sem texto fora, sem crases) no formato: ' +
  '{"thought":"breve raciocínio","files":[{"path":"rel/arquivo","content":"conteúdo COMPLETO do arquivo"}],"run":["comando"],"done":false,"summary":"o que fez neste passo"}. ' +
  'Regras: caminhos sempre RELATIVOS à raiz do projeto; "content" é o arquivo inteiro (não diffs). ' +
  'Prefira soluções simples e SEM dependências externas quando possível (ex.: site estático HTML/CSS/JS). ' +
  'Em "run" só sugira comandos de verificação leves (ex.: testes/typecheck que já existam) — instalar dependências NÃO funciona aqui. ' +
  'Quando o objetivo estiver cumprido, marque "done": true e descreva como rodar/abrir no "summary". Não repita arquivos já corretos.'

function buildCoderPrompt(objective: string, fileTree: string[], lastResult: string): string {
  const parts = [
    `Objetivo: ${objective}`,
    fileTree.length ? `Arquivos atuais do projeto:\n${fileTree.slice(0, 120).join('\n')}` : 'O projeto está vazio.'
  ]
  if (lastResult) parts.push(`Resultado do passo anterior (use para corrigir/continuar):\n${lastResult.slice(0, 2500)}`)
  return parts.join('\n\n')
}

/** Executa a tarefa de forma autônoma: planeja → escreve → roda → itera. */
export async function runCoderTask(
  cfg: AppConfig,
  opts: { objetivo: string; root?: string; passos?: number }
): Promise<CoderResult> {
  const objective = String(opts.objetivo || '').trim()
  if (!objective) throw new Error('Diga o objetivo do projeto.')
  if (!cfg.integrations.code.allowPatchApply) {
    throw new Error('Coder autônomo desativado. Ligue "Permitir aplicar patches" nas Configurações.')
  }
  const root = resolveCodeWorkspace(cfg, opts.root)
  const maxSteps = Math.max(1, Math.min(Number(opts.passos) || 4, 8))
  const transcript: CoderStepReport[] = []
  let lastResult = ''
  let done = false

  for (let i = 0; i < maxSteps; i++) {
    const ws = summarizeCodeWorkspace(cfg, root)
    let raw = ''
    try {
      raw = await chatJSON(
        cfg,
        [
          { role: 'system', content: CODER_SYSTEM },
          { role: 'user', content: buildCoderPrompt(objective, ws.files, lastResult) }
        ],
        true
      )
    } catch (e) {
      transcript.push({ written: [], skipped: [], ran: [], summary: `falha ao planejar: ${e instanceof Error ? e.message : e}`, done: false })
      break
    }
    const step = parseCoderStep(raw)
    const applied = applyCoderStep(cfg, root, step)
    transcript.push({ ...applied, summary: step.summary || step.thought || '(sem resumo)', done: step.done })
    lastResult = JSON.stringify(applied)
    if (step.done || (step.files.length === 0 && step.run.length === 0)) {
      done = step.done
      break
    }
  }

  const failures = transcript.flatMap((t) => t.ran.filter((r) => r.ran && !r.ok))
  const ok = done && failures.length === 0
  const last = transcript[transcript.length - 1]
  return {
    root,
    objective,
    steps: transcript.length,
    ok,
    summary: last?.summary || 'sem alterações',
    transcript
  }
}
