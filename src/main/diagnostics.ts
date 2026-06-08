import { app } from 'electron'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import type { DiagnosticsResult, DataFileInfo } from '../shared/types'
import { readConfig } from './config'
import { isPiperReady, listPiperVoices } from './piper'

// Coleta o status local do Ares: app, serviços (9 Router/Groq/Piper), localização e
// arquivos de dados. Tudo local; só o ping do 9 Router toca a rede (com timeout curto).

async function pingNineRouter(baseUrl: string): Promise<{ ok: boolean; detail: string }> {
  const url = baseUrl.replace(/\/$/, '') + '/models'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 2500)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (res.ok) return { ok: true, detail: 'online' }
    return { ok: false, detail: `respondeu HTTP ${res.status}` }
  } catch (e: any) {
    clearTimeout(timer)
    return { ok: false, detail: e?.name === 'AbortError' ? 'sem resposta (timeout)' : 'offline / inacessível' }
  }
}

function fileInfo(name: string): DataFileInfo {
  const path = join(app.getPath('userData'), name)
  try {
    if (existsSync(path)) {
      const st = statSync(path)
      return { name, path, exists: true, sizeKB: Math.round((st.size / 1024) * 10) / 10 }
    }
  } catch {
    /* ignora */
  }
  return { name, path, exists: false, sizeKB: 0 }
}

export async function getDiagnostics(): Promise<DiagnosticsResult> {
  const cfg = readConfig()
  const nine = await pingNineRouter(cfg.nineRouter.baseUrl)
  const groqConfigured = !!cfg.grog.apiKey
  return {
    app: {
      name: 'Ares',
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron || '?',
      node: process.versions.node || '?',
      chrome: process.versions.chrome || '?'
    },
    userDataPath: app.getPath('userData'),
    nineRouter: { ...nine, baseUrl: cfg.nineRouter.baseUrl, model: cfg.nineRouter.model },
    groq: {
      configured: groqConfigured,
      ok: groqConfigured,
      detail: groqConfigured ? 'chave configurada' : 'sem chave — STT por voz indisponível'
    },
    piper: { ready: isPiperReady(), voices: listPiperVoices() },
    location: cfg.integrations.location,
    dataFiles: [
      'config.json',
      'tasks.json',
      'memory.json',
      'calendar.json',
      'sessions.json',
      'lists.json',
      'notes.json',
      'reminders.json'
    ].map(fileInfo)
  }
}
