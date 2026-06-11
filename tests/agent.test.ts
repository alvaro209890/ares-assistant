import { beforeEach, describe, expect, it, vi } from 'vitest'

// userData isolado em um tmp dir; o mock do electron precisa existir ANTES dos imports
// (vi.hoisted garante isso). Mockamos também a camada do LLM (ninerouter) para não bater
// na rede — controlamos o "cérebro" devolvendo envelopes JSON a cada turno.
const { TMP } = vi.hoisted(() => {
  const os = require('node:os')
  const fs = require('node:fs')
  const path = require('node:path')
  return { TMP: fs.mkdtempSync(path.join(os.tmpdir(), 'ares-agent-')) as string }
})

vi.mock('electron', () => ({
  app: { getPath: () => TMP },
  clipboard: { readText: () => '', writeText: () => undefined }
}))

vi.mock('../src/main/ninerouter', () => ({
  chatJSON: vi.fn(),
  streamChat: vi.fn()
}))

vi.mock('../src/main/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/tools')>()
  return {
    ...actual,
    webSearch: vi.fn(async () => [
      { title: 'Fonte de teste', url: 'https://example.com/fonte', snippet: 'Resultado controlado.' }
    ]),
    getNews: vi.fn(async () => [
      {
        title: 'Notícia recente de teste',
        link: 'https://example.com/noticia',
        source: 'Fonte Teste',
        published: 'Wed, 10 Jun 2026 12:00:00 GMT'
      }
    ]),
    readPage: vi.fn(async () => ({ title: 'Página de teste', text: 'Conteúdo controlado.' }))
  }
})

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentActivityEvent } from '../src/shared/types'
import { chatJSON, streamChat } from '../src/main/ninerouter'
import { compactSubagentContext, runTurn, stripRepeatedGreeting } from '../src/main/agent'
import { createSession } from '../src/main/data'
import { updateConfig } from '../src/main/config'

const brain = vi.mocked(chatJSON)
const stream = vi.mocked(streamChat)

/** Faz o "cérebro" devolver este envelope na próxima chamada (1 por turno sem queries). */
function nextEnvelope(fala: string, acoes: unknown[] = []): void {
  brain.mockResolvedValueOnce(JSON.stringify({ fala, acoes }))
}

beforeEach(() => {
  // Zera o estado em disco entre os testes (memória, board, sessões…).
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  brain.mockReset()
  stream.mockReset()
})

describe('agent — runTurn (orquestração do cérebro)', () => {
  it('remove saudacao repetida quando o chat ja tem historico', async () => {
    expect(stripRepeatedGreeting('Boa tarde, Alvaaro. Sua pasta está em ordem.')).toBe('Sua pasta está em ordem.')

    const sid = createSession().id
    nextEnvelope('Olá, Alvaaro. Como posso ajudar?', [])
    await runTurn(sid, 'ola')

    nextEnvelope('Boa tarde, Alvaaro. Sua pasta Documentos está em ordem.', [])
    const r = await runTurn(sid, 'analise minha pasta de documentos')

    expect(r.fala).toBe('Sua pasta Documentos está em ordem.')
  })

  it('aplica uma mutação proposta pelo LLM e devolve a fala', async () => {
    const sid = createSession().id
    nextEnvelope('Anotado, senhor.', [
      { tipo: 'memoria.salvar', fato: 'prefere aspas simples no código', categoria: 'preferencias' }
    ])

    const r = await runTurn(sid, 'lembre dessa preferência')

    expect(r.fala).toBe('Anotado, senhor.')
    expect(r.memory.some((f) => f.text === 'prefere aspas simples no código' && f.status === 'active')).toBe(true)
  })

  it('memoryFallback salva o fato mesmo quando o LLM não emite a ação', async () => {
    const sid = createSession().id
    nextEnvelope('Claro.', []) // LLM não devolveu memoria.salvar

    const r = await runTurn(sid, 'lembra que eu uso ponto e vírgula sempre')

    expect(r.memory.some((f) => /ponto e vírgula/i.test(f.text))).toBe(true)
  })

  it('monta contexto compacto para subagentes sem carregar historico inteiro', async () => {
    const sid = createSession().id
    nextEnvelope('Primeira resposta.', [])
    await runTurn(sid, 'Meu projeto atual é o Ares e quero melhorar a Colmeia.')
    nextEnvelope('Segunda resposta.', [])
    await runTurn(sid, 'A Atena deve priorizar notícias recentes.')

    const ctx = compactSubagentContext(sid, 'Contexto direto da ação', 500)

    expect(ctx).toContain('Contexto direto da ação')
    expect(ctx).toContain('Atena deve priorizar notícias recentes')
    expect(ctx!.length).toBeLessThanOrEqual(500)
  })

  it('ignora ação inválida e registra uma nota', async () => {
    const sid = createSession().id
    nextEnvelope('Feito.', [{ tipo: 'tarefa.criar' }]) // sem título -> inválida

    const r = await runTurn(sid, 'cria uma tarefa')

    expect(r.notes.some((n) => /ignorada/i.test(n))).toBe(true)
  })

  it('roda ferramenta de consulta e responde na 2ª fase (após o resultado)', async () => {
    const sid = createSession().id
    // Fase 1: o LLM pede uma ferramenta de consulta (calcular, local/sem rede).
    nextEnvelope('Deixe-me ver.', [{ tipo: 'calcular', expressao: '2+2' }])
    // Fase 2: com o resultado em mãos, responde de fato — é essa fala que prevalece.
    nextEnvelope('São quatro, senhor.', [])

    const r = await runTurn(sid, 'quanto é dois mais dois')

    expect(brain).toHaveBeenCalledTimes(2)
    expect(r.fala).toBe('São quatro, senhor.')
  })

  it('streama a fala final mesmo quando a fase pós-ferramenta vem como texto solto', async () => {
    const sid = createSession().id
    const envelopes = [
      JSON.stringify({ fala: 'Vou calcular.', acoes: [{ tipo: 'calcular', expressao: '2+2' }] }),
      'São quatro, senhor.'
    ]
    let i = 0
    stream.mockImplementation(async (_cfg: unknown, _msgs: unknown, onDelta: (d: string) => void) => {
      const text = envelopes[i++] ?? ''
      onDelta(text)
      return text
    })
    const deltas: { chunk: string; phase: number; kind: string }[] = []

    const r = await runTurn(sid, 'quanto é dois mais dois', false, (chunk, phase, kind = 'both') =>
      deltas.push({ chunk, phase, kind })
    )

    expect(r.fala).toBe('São quatro, senhor.')
    expect(deltas.some((d) => d.phase === 2 && d.kind === 'both' && d.chunk.includes('São quatro'))).toBe(true)
  })

  it('finaliza com a fala parcial quando o stream cai apos emitir texto', async () => {
    const sid = createSession().id
    stream.mockImplementation(async (_cfg: unknown, _msgs: unknown, onDelta: (d: string) => void) => {
      onDelta('{"fala":"Claude Fable 5 é um nome que não corresponde')
      throw new Error('stream interrompido')
    })
    const deltas: string[] = []

    const r = await runTurn(sid, 'pergunta do claude fable 5', false, (chunk) => deltas.push(chunk))

    expect(r.fala).toContain('Claude Fable 5')
    expect(deltas.join('')).toContain('Claude Fable 5')
    expect(r.notes).toEqual([])
  })

  it('cumpre promessa de acionar Atena mesmo quando o LLM esquece a ação JSON', async () => {
    const sid = createSession().id
    brain
      .mockResolvedValueOnce(JSON.stringify({ fala: 'Vou pesquisar isso agora com a Atena.', acoes: [] }))
      .mockResolvedValueOnce('Atena encontrou uma fonte de teste e confirmou o fato principal.')
      .mockResolvedValueOnce(JSON.stringify({ fala: 'Atena confirmou o fato principal com fonte controlada.', acoes: [] }))
    const hive: string[] = []

    const r = await runTurn(
      sid,
      'Pesquise para mim sobre o modelo lançado hoje.',
      false,
      undefined,
      undefined,
      (status) => hive.push(`${status.id}:${status.phase}`)
    )

    expect(brain).toHaveBeenCalledTimes(3)
    expect(hive).toContain('researcher:thinking')
    expect(hive).toContain('researcher:done')
    expect(r.fala).toContain('Atena confirmou')
    expect(r.notes).toContain('colmeia corrigida: promessa convertida em ação real')
  })

  it('encadeia rodadas de ferramentas: consulta da 2ª fase também executa', async () => {
    const sid = createSession().id
    // Rodada 1: pede um cálculo.
    nextEnvelope('Vou calcular.', [{ tipo: 'calcular', expressao: '2+2' }])
    // Rodada 2: com o resultado, pede OUTRA consulta (antes era ignorada).
    nextEnvelope('Agora converto para milhas.', [{ tipo: 'converter.unidade', de: 'km', para: 'mi', valor: 4 }])
    // Rodada 3: resposta final.
    nextEnvelope('São quatro quilômetros, cerca de duas vírgula cinco milhas.', [])

    const phases: number[] = []
    const r = await runTurn(sid, 'quanto é 2+2 em km e em milhas?', false, (_c, ph) => phases.push(ph))

    expect(brain).toHaveBeenCalledTimes(3)
    expect(r.fala).toContain('milhas')
    expect(Math.max(...phases)).toBe(3) // streaming abriu a 3ª fase
  })

  it('para de encadear no limite de rodadas (sem ciclo infinito)', async () => {
    const sid = createSession().id
    // O "cérebro" SEMPRE pede mais uma consulta — o agente precisa cortar no limite.
    brain.mockResolvedValue(
      JSON.stringify({ fala: 'Mais uma verificação.', acoes: [{ tipo: 'calcular', expressao: '1+1' }] })
    )

    const r = await runTurn(sid, 'fica calculando para sempre')

    // 1 chamada inicial + MAX_TOOL_ROUNDS respostas pós-ferramenta = 4
    expect(brain).toHaveBeenCalledTimes(4)
    expect(r.fala).toBeTruthy()
  })

  it('emite atividades ao ler arquivo no modo programador', async () => {
    updateConfig({ integrations: { code: { workspaceRoot: TMP, allowedRoots: [TMP] } } })
    writeFileSync(join(TMP, 'a.ts'), 'export const a = 1\n', 'utf8')
    const sid = createSession().id
    nextEnvelope('Vou ler.', [{ tipo: 'codigo.ler', arquivo: 'a.ts' }])
    nextEnvelope('Arquivo lido.', [])
    const activities: AgentActivityEvent[] = []

    await runTurn(sid, 'leia a.ts', false, undefined, (a) => activities.push(a))

    expect(activities.some((a) => a.kind === 'read' && a.status === 'running')).toBe(true)
    expect(activities.some((a) => a.kind === 'read' && a.status === 'done' && a.detail === 'a.ts')).toBe(true)
  })

  it('emite waiting quando terminal precisa de autorização', async () => {
    updateConfig({ integrations: { code: { workspaceRoot: TMP, allowedRoots: [TMP], terminalAutoApprove: false } } })
    const sid = createSession().id
    nextEnvelope('Vou preparar o comando.', [{ tipo: 'codigo.terminal', comando: 'npm install left-pad' }])
    nextEnvelope('Autoriza executar npm install left-pad?', [])
    const activities: AgentActivityEvent[] = []

    await runTurn(sid, 'instale left-pad', false, undefined, (a) => activities.push(a))

    expect(activities.some((a) => a.kind === 'terminal' && a.status === 'running')).toBe(true)
    expect(activities.some((a) => a.kind === 'terminal' && a.status === 'waiting' && a.command === 'npm install left-pad')).toBe(true)
  })

  it('emite amostra de output em comando permitido', async () => {
    updateConfig({
      integrations: { code: { workspaceRoot: TMP, allowedRoots: [TMP], allowedCommands: ['node --version'] } }
    })
    const sid = createSession().id
    nextEnvelope('Vou rodar.', [{ tipo: 'codigo.comando', comando: 'node --version' }])
    nextEnvelope('Comando concluído.', [])
    const activities: AgentActivityEvent[] = []

    await runTurn(sid, 'rode node --version', false, undefined, (a) => activities.push(a))

    expect(activities.some((a) => a.kind === 'command' && a.status === 'output' && /v\d+/.test(a.output || ''))).toBe(true)
    expect(activities.some((a) => a.kind === 'command' && a.status === 'done')).toBe(true)
  })

  it('voz+código: streama a resposta COMPLETA na tela e fala um resumo NÃO-vazio (fase 2)', async () => {
    // Regressão do bug: ao analisar um diretório por voz, ele falava "vou analisar" (fase 1)
    // mas ficava MUDO na resposta (fase 2). Agora a tela recebe o texto completo (canal
    // 'display') e a voz recebe um resumo conciso e não-vazio (canal 'speak').
    updateConfig({ integrations: { code: { workspaceRoot: TMP, allowedRoots: [TMP] } } })
    const sid = createSession().id
    const envelopes = [
      JSON.stringify({ fala: 'Vou analisar o diretório, senhor.', acoes: [{ tipo: 'codigo.workspace' }] }),
      JSON.stringify({
        fala: 'O diretório tem três pastas principais: src, tests e docs, além de package.json e do README. É um projeto Node com testes configurados.',
        acoes: []
      })
    ]
    let i = 0
    stream.mockImplementation(async (_cfg: unknown, _msgs: unknown, onDelta: (d: string) => void) => {
      const text = envelopes[i++] ?? '{"fala":"","acoes":[]}'
      onDelta(text)
      return text
    })

    const deltas: { chunk: string; phase: number; kind: string }[] = []
    const r = await runTurn(sid, 'analise o diretório atual', true, (chunk, phase, kind = 'both') =>
      deltas.push({ chunk, phase, kind })
    )

    const display2 = deltas.filter((d) => d.phase === 2 && d.kind === 'display').map((d) => d.chunk).join('')
    const speak2 = deltas.filter((d) => d.phase === 2 && d.kind === 'speak').map((d) => d.chunk).join('').trim()

    expect(display2).toContain('três pastas principais') // resposta completa foi pra tela
    expect(speak2.length).toBeGreaterThan(0) // a voz CONTINUOU (não ficou muda) — o bug
    expect(speak2).toContain('diretório') // e fala o conteúdo real, não um genérico
    expect(r.fala).toContain('testes configurados') // chat guarda o texto COMPLETO (2 frases)
    expect(r.falaVoz).toContain('diretório') // fallback robusto caso o último IPC de fala se perca
  })

  it('segura ação destrutiva até a confirmação e executa após o "sim"', async () => {
    const sid = createSession().id

    // 1) cria a tarefa
    nextEnvelope('Tarefa criada.', [{ tipo: 'tarefa.criar', titulo: 'Comprar pão' }])
    let r = await runTurn(sid, 'cria a tarefa comprar pão')
    const hasTask = (res: typeof r): boolean => Object.values(res.board.cards).some((c) => c.title === 'Comprar pão')
    expect(hasTask(r)).toBe(true)

    // 2) pede para remover SEM confirmar -> deve segurar (não apaga)
    nextEnvelope('Confirma que eu vou apagar a tarefa "Comprar pão"?', [
      { tipo: 'tarefa.remover', titulo: 'Comprar pão' }
    ])
    r = await runTurn(sid, 'apaga a tarefa comprar pão')
    expect(hasTask(r)).toBe(true) // ainda existe
    expect(r.notes.some((n) => /aguardando confirma/i.test(n))).toBe(true)

    // 3) usuário confirma -> agora remove
    nextEnvelope('Pronto, removida.', [])
    r = await runTurn(sid, 'sim')
    expect(hasTask(r)).toBe(false)
  })
})
