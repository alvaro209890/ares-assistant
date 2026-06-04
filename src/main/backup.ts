import { app, dialog } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

// Backup/restauração em 1 clique. Cobre o CONTEÚDO do usuário (tarefas, agenda,
// memória, conversas, listas, notas, lembretes). NÃO inclui config.json, que guarda
// chaves de API — evita vazar segredos num arquivo compartilhável.

const FILES = ['tasks.json', 'memory.json', 'calendar.json', 'sessions.json', 'lists.json', 'notes.json', 'reminders.json']

export async function exportData(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar dados do Ares',
    defaultPath: `ares-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'Backup Ares', extensions: ['json'] }]
  })
  if (canceled || !filePath) return { ok: false }
  const bundle: { _ares: string; version: number; exportedAt: number; files: Record<string, unknown> } = {
    _ares: 'backup',
    version: 1,
    exportedAt: Date.now(),
    files: {}
  }
  for (const f of FILES) {
    const p = join(app.getPath('userData'), f)
    if (existsSync(p)) {
      try {
        bundle.files[f] = JSON.parse(readFileSync(p, 'utf8'))
      } catch {
        /* ignora arquivo corrompido */
      }
    }
  }
  try {
    writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8')
    return { ok: true, path: filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function importData(): Promise<{ ok: boolean; restored?: number; error?: string }> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Restaurar backup do Ares',
    properties: ['openFile'],
    filters: [{ name: 'Backup Ares', extensions: ['json'] }]
  })
  if (canceled || !filePaths[0]) return { ok: false }
  let bundle: any
  try {
    bundle = JSON.parse(readFileSync(filePaths[0], 'utf8'))
  } catch {
    return { ok: false, error: 'Arquivo inválido.' }
  }
  if (!bundle || bundle._ares !== 'backup' || !bundle.files) return { ok: false, error: 'Não é um backup do Ares.' }
  let restored = 0
  for (const f of FILES) {
    if (bundle.files[f] !== undefined) {
      try {
        writeFileSync(join(app.getPath('userData'), f), JSON.stringify(bundle.files[f], null, 2), 'utf8')
        restored++
      } catch {
        /* ignora */
      }
    }
  }
  return { ok: true, restored }
}
