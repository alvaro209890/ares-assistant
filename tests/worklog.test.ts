import { describe, it, expect, beforeEach, vi } from 'vitest'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const { TMP } = vi.hoisted(() => {
  const os = require('node:os')
  const fs = require('node:fs')
  const path = require('node:path')
  return { TMP: fs.mkdtempSync(path.join(os.tmpdir(), 'ares-worklog-')) as string }
})

vi.mock('electron', () => ({
  app: { getPath: () => TMP }
}))

import { getWorklog, worklogPatchFromResult, buildResumeSummary, compactWorklog } from '../src/main/worklog'
import { writeJSON } from '../src/main/data'
import type { AppConfig, Acao } from '../src/shared/types'

describe('Worklog - Sessões Retomáveis', () => {
  const root = 'c:\\fake\\project'
  const userData = app.getPath('userData')
  const mockCfg = { integrations: { code: { workspaceRoot: root } } } as AppConfig

  beforeEach(async () => {
    // Limpa estado
    const fs = await import('fs')
    if (fs.existsSync(userData)) {
      const items = fs.readdirSync(userData)
      for (const item of items) {
        if (item.startsWith('worklog-') || item === 'session-context.json') {
          fs.rmSync(join(userData, item), { force: true, recursive: true })
        }
      }
    }
  })

  it('migra a semente antiga (session-context.json) na primeira execução', () => {
    writeJSON('session-context.json', { lastEditedFile: 'old.ts', lastTerminalCommand: 'npm test' })
    const wlog = getWorklog(root)
    expect(wlog.entries.length).toBe(1)
    expect(wlog.entries[0].description).toBe('Sessão anterior migrada')
    expect(wlog.entries[0].resultSummary).toContain('old.ts')
    expect(wlog.entries[0].resultSummary).toContain('npm test')
  })

  it('captura por tipo de ferramenta: edicao de codigo', () => {
    worklogPatchFromResult('codigo.editar', { path: root } as unknown as Acao, { ok: true, resultado: { file: 'index.ts', changed: true } } as any, mockCfg)
    const wlog = getWorklog(root)
    expect(wlog.entries.length).toBe(1)
    expect(wlog.entries[0].tool).toBe('codigo.editar')
    expect(wlog.entries[0].filesTouched).toContain('index.ts')
    expect(wlog.entries[0].resultSummary).toContain('Alterações aplicadas')
  })

  it('captura por tipo de ferramenta: comando terminal que falha', () => {
    worklogPatchFromResult('codigo.terminal', { path: root } as unknown as Acao, { ok: false, resultado: { ok: false, code: 1, stderr: 'error 404' } } as any, mockCfg)
    const wlog = getWorklog(root)
    expect(wlog.entries.length).toBe(1)
    expect(wlog.entries[0].resultSummary).toContain('error 404')
    expect(wlog.entries[0].resultSummary).toContain('Falhou')
  })

  it('captura por tipo de ferramenta: briefing de subagente', () => {
    const report = '[ESCOPO] Fazer X\n[PASSOS] 1. Y\n[VALIDAR] test'
    worklogPatchFromResult('subagente.construir', { path: root } as unknown as Acao, { ok: true, resultado: { report } } as any, mockCfg)
    const wlog = getWorklog(root)
    expect(wlog.entries[0].resultSummary).toContain('[ESCOPO]')
  })

  it('aplica caps: 10 sessoes e compacta strings compridas sem cortar no meio da entrada', () => {
    for (let i = 0; i < 15; i++) {
      worklogPatchFromResult('codigo.editar', { path: root, objetivo: `Ação ${i}` } as unknown as Acao, { ok: true, resultado: { changed: true } } as any, mockCfg)
    }
    const wlog = compactWorklog(getWorklog(root))
    expect(wlog.entries.length).toBeLessThanOrEqual(10)
    expect(wlog.entries[0].description).toBe('Ação 14') // mais recente

    // Testa compactação por tamanho: adiciona uma entrada gigante
    const giant = 'x'.repeat(5000)
    worklogPatchFromResult('codigo.terminal', { path: root, objetivo: 'Comando gigante' } as unknown as Acao, { ok: true, resultado: { ok: true, stdout: giant } } as any, mockCfg)
    const wlog2 = compactWorklog(getWorklog(root))
    const totalChars = JSON.stringify(wlog2).length
    expect(totalChars).toBeLessThan(10000)
    expect(wlog2.entries[0].description).toBe('Comando gigante')
  })

  it('resumo de retomada com briefing ativo e sem', () => {
    // Sem briefing
    worklogPatchFromResult('codigo.editar', { path: root, objetivo: 'Editei um bagulho' } as unknown as Acao, { ok: true, resultado: { changed: true } } as any, mockCfg)
    const wlog1 = getWorklog(root)
    const res1 = buildResumeSummary(wlog1, '', [])
    expect(res1).toContain('Editei um bagulho')
    expect(res1).not.toContain('Estávamos focados em')

    // Com briefing
    const report = '[ESCOPO] Módulo de pagamentos\n[PASSOS] 1. foo'
    worklogPatchFromResult('subagente.construir', { path: root, objetivo: 'Bora planejar' } as unknown as Acao, { ok: true, resultado: { report } } as any, mockCfg)
    const wlog2 = getWorklog(root)
    const res2 = buildResumeSummary(wlog2, '', [])
    expect(res2).toContain('Bora planejar')
    expect(res2).toContain('Estávamos focados em: Módulo de pagamentos')
  })

  it('divergência diário vs git: git vence (resumo inclui pendências reais)', () => {
    worklogPatchFromResult('codigo.terminal', { path: root, objetivo: 'Ok' } as unknown as Acao, { ok: true, resultado: { ok: true } } as any, mockCfg)
    const wlog = getWorklog(root)
    const gitStatus = 'M src/main/data.ts\n?? src/new.ts'
    const res = buildResumeSummary(wlog, gitStatus, [])
    expect(res).toContain('2 arquivo(s) com alterações pendentes')
  })
})
