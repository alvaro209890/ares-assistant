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

import { mkdirSync, rmSync } from 'node:fs'
import { chatJSON } from '../src/main/ninerouter'
import { runTurn } from '../src/main/agent'
import { createSession } from '../src/main/data'

const brain = vi.mocked(chatJSON)

/** Faz o "cérebro" devolver este envelope na próxima chamada (1 por turno sem queries). */
function nextEnvelope(fala: string, acoes: unknown[] = []): void {
  brain.mockResolvedValueOnce(JSON.stringify({ fala, acoes }))
}

beforeEach(() => {
  // Zera o estado em disco entre os testes (memória, board, sessões…).
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  brain.mockReset()
})

describe('agent — runTurn (orquestração do cérebro)', () => {
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
