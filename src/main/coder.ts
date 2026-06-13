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
  parseError?: string
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
  done: boolean
  ok: boolean
  summary: string
  changedFiles: string[]
  validated: boolean
  validationSummary?: string
  blockedReason?: string
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
  
  let parseError: string | undefined
  let parsedAny = false
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c)
      if (parsed && typeof parsed === 'object') {
        obj = parsed as Record<string, unknown>
        parsedAny = true
        break
      }
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e)
    }
  }

  if (!parsedAny) {
    return {
      files: [],
      run: [],
      done: false,
      summary: '',
      parseError: parseError || 'Formato JSON inválido'
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
export async function applyCoderStep(
  cfg: AppConfig,
  root: string,
  step: CoderStep,
  signal?: AbortSignal,
  onProgress?: (label: string, percent?: number) => void
): Promise<CoderStepResult> {
  const written: string[] = []
  const skipped: string[] = []
  step.files.forEach((f, idx) => {
    try {
      onProgress?.(`Escrevendo ${f.path}...`, step.files.length ? Math.round(((idx + 1) / step.files.length) * 35) : undefined)
      const w = writeCodeFile(cfg, { root, file: f.path, content: f.content, overwrite: true })
      written.push(w.file)
    } catch (e) {
      skipped.push(`${f.path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })

  const ran: CoderRun[] = []
  for (let i = 0; i < step.run.length; i++) {
    const command = step.run[i]
    onProgress?.(`Rodando validação: ${command}`, 40 + Math.round(((i + 1) / Math.max(1, step.run.length)) * 45))
    const cls = classifyCommand(cfg, command)
    if (cls.tier !== 'allowed') {
      ran.push({ command, ok: false, ran: false, code: null, summary: `pulado (${cls.tier}: precisa de você)` })
      continue
    }
    try {
      const r = await runCodeTerminal(cfg, { root, command, signal })
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
  opts: {
    objetivo: string
    root?: string
    passos?: number
    signal?: AbortSignal
    onProgress?: (label: string, percent?: number) => void
  }
): Promise<CoderResult> {
  const objective = String(opts.objetivo || '').trim()
  if (!objective) throw new Error('Diga o objetivo do projeto.')
  if (!cfg.integrations.code.allowPatchApply) {
    throw new Error('Coder autônomo desativado. Ligue "Permitir aplicar patches" nas Configurações.')
  }
  const root = resolveCodeWorkspace(cfg, opts.root)
  const maxSteps = Math.max(1, Math.min(Number(opts.passos) || 6, 10))
  const transcript: CoderStepReport[] = []
  let lastResult = ''
  let done = false
  let blockedReason = ''
  let parseErrors = 0
  let noActionStalls = 0

  for (let i = 0; i < maxSteps; i++) {
    // Cancelamento (Esc/IPC): sem esta checagem, um erro de parse em loop ainda
    // disparava novas chamadas ao LLM depois de o usuário abortar a tarefa.
    if (opts.signal?.aborted) {
      blockedReason = 'tarefa cancelada pelo usuário'
      transcript.push({ written: [], skipped: [], ran: [], summary: blockedReason, done: false })
      break
    }
    const ws = summarizeCodeWorkspace(cfg, root)
    let raw = ''
    try {
      opts.onProgress?.(`Coder autônomo: planejando passo ${i + 1}/${maxSteps}...`, Math.round((i / maxSteps) * 90))
      raw = await chatJSON(
        cfg,
        [
          { role: 'system', content: CODER_SYSTEM },
          { role: 'user', content: buildCoderPrompt(objective, ws.files, lastResult) }
        ],
        true,
        { signal: opts.signal }
      )
    } catch (e) {
      blockedReason = `falha ao planejar: ${e instanceof Error ? e.message : e}`
      transcript.push({ written: [], skipped: [], ran: [], summary: blockedReason, done: false })
      break
    }
    const step = parseCoderStep(raw)
    if (step.parseError) {
      parseErrors++
      const errorMsg = `Erro de formatação no passo ${i + 1}: a resposta não pôde ser analisada como JSON válido. Detalhe: ${step.parseError}. Certifique-se de responder APENAS o JSON no formato exigido, sem markdown extra ou explicações.`
      transcript.push({
        written: [],
        skipped: [errorMsg],
        ran: [],
        summary: `Erro de formato JSON na resposta do modelo`,
        done: false
      })
      lastResult = errorMsg
      if (parseErrors >= 2) {
        blockedReason = 'o coder autônomo devolveu JSON inválido repetidamente'
        break
      }
      continue
    }
    parseErrors = 0
    opts.onProgress?.(
      step.files.length
        ? `Coder autônomo: escrevendo ${step.files.length} arquivo(s)...`
        : step.run.length
          ? 'Coder autônomo: validando a alteração...'
          : 'Coder autônomo: conferindo conclusão...',
      Math.round((i / maxSteps) * 90)
    )
    const applied = await applyCoderStep(cfg, root, step, opts.signal, opts.onProgress)
    const stepEvidence = applied.written.length > 0 || applied.ran.some((r) => r.ran)
    const totalEvidence =
      transcript.some((t) => t.written.length > 0 || t.ran.some((r) => r.ran)) || stepEvidence
    const skippedApproval = applied.ran.find((r) => !r.ran && /precisa de você/i.test(r.summary))
    const stepDone = step.done && totalEvidence && !skippedApproval
    transcript.push({ ...applied, summary: step.summary || step.thought || '(sem resumo)', done: stepDone })
    lastResult = JSON.stringify(applied)

    if (skippedApproval) {
      blockedReason = `o comando "${skippedApproval.command}" precisa da sua autorização`
      break
    }

    if (step.done && !totalEvidence) {
      noActionStalls++
      lastResult =
        'Você marcou done=true sem escrever arquivo nem rodar comando. Continue com uma ação real em files/run ou explique bloqueio no summary.'
      if (noActionStalls >= 2) {
        blockedReason = 'o coder marcou conclusão sem executar nenhuma ação real'
        break
      }
      continue
    }

    if (step.files.length === 0 && step.run.length === 0 && !step.done) {
      noActionStalls++
      lastResult =
        'O passo não trouxe arquivos nem comandos. Continue com uma ação executável ou marque done=true somente se já houver evidência real.'
      if (noActionStalls >= 2) {
        blockedReason = 'o coder não forneceu nenhuma ação executável'
        break
      }
      continue
    }

    noActionStalls = 0
    if (stepDone) {
      done = true
      break
    }
  }

  const lastByCommand = new Map<string, CoderRun>()
  for (const r of transcript.flatMap((t) => t.ran).filter((r) => r.ran)) lastByCommand.set(r.command, r)
  const failures = Array.from(lastByCommand.values()).filter((r) => !r.ok)
  const changedFiles = Array.from(new Set(transcript.flatMap((t) => t.written)))
  const validation = Array.from(lastByCommand.values()).at(-1)
  const validated = !!validation
  if (!blockedReason && failures.length) {
    blockedReason = `validação falhou em ${failures.map((r) => `"${r.command}"`).join(', ')}`
  } else if (!blockedReason && !done) {
    blockedReason = `limite de ${maxSteps} passos atingido antes da conclusão`
  }
  const ok = done && failures.length === 0 && !blockedReason
  const last = transcript[transcript.length - 1]
  opts.onProgress?.(ok ? 'Coder autônomo: objetivo concluído.' : `Coder autônomo: ${blockedReason}`, 100)
  return {
    root,
    objective,
    steps: transcript.length,
    done,
    ok,
    summary: blockedReason || last?.summary || 'sem alterações',
    changedFiles,
    validated,
    ...(validation ? { validationSummary: `${validation.command}: ${validation.summary}` } : {}),
    ...(blockedReason ? { blockedReason } : {}),
    transcript
  }
}
