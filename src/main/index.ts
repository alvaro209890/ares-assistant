import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'path'
import { ensureConfig, readConfig, updateConfig } from './config'
import { loadBoard, saveBoard } from './tasks'
import { transcribe } from './grog'
import { runTurn, extractFacts } from './agent'
import { buildBriefing } from './briefing'
import { getDiagnostics } from './diagnostics'
import { startReminders } from './notify'
import { synthesize, listPiperVoices, isPiperReady, ensurePiper } from './piper'
import { getWeather, getWeatherAt, getNews, reverseGeocode } from './tools'
import {
  loadMemory,
  addFact,
  updateFact,
  approveFact,
  removeFact,
  loadEvents,
  addEvent,
  removeEvent,
  setEvents,
  listSessions,
  getSession,
  createSession,
  renameSession,
  deleteSession
} from './data'
import type { AppConfig, Board, CalendarEvent, DeepPartial, MemoryCategory, UserLocation } from '../shared/types'

// Nome do app: define userData (Linux: ~/.config/ares) com config/tasks/memória/etc.
app.setName('ares')

// No Linux, o Chromium do Electron desliga a síntese de voz por padrão.
// Habilita o speech-dispatcher para a voz Web Speech (reserva) sair no áudio.
app.commandLine.appendSwitch('enable-speech-dispatcher')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    backgroundColor: '#04070f',
    title: 'ARES',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  ensureConfig()

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(
      permission === 'media' ||
        String(permission) === 'audioCapture' ||
        permission === 'notifications' ||
        permission === 'geolocation'
    )
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return (
      permission === 'media' ||
      String(permission) === 'audioCapture' ||
      permission === 'notifications' ||
      permission === 'geolocation'
    )
  })

  registerIpc()
  createWindow()
  startReminders(() => mainWindow)
  // Garante o Piper (voz neural) em background; até ficar pronto, usa-se a Web Speech.
  ensurePiper().catch(() => {})

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc(): void {
  // Config
  ipcMain.handle('config:get', (): AppConfig => readConfig())
  ipcMain.handle('config:update', (_e, patch: DeepPartial<AppConfig>): AppConfig => updateConfig(patch))

  // Tarefas (Kanban) — renderer salva o board após edições/DnD
  ipcMain.handle('tasks:load', (): Board => loadBoard())
  ipcMain.handle('tasks:save', (_e, board: Board): boolean => {
    saveBoard(board)
    return true
  })

  // Memória de longo prazo
  ipcMain.handle('memory:load', () => loadMemory())
  ipcMain.handle('memory:add', (_e, text: string, category?: MemoryCategory) =>
    addFact(text, { category, source: 'manual', status: 'active' })
  )
  ipcMain.handle('memory:update', (_e, id: string, patch: { text?: string; category?: MemoryCategory; status?: 'active' | 'pending' }) =>
    updateFact(id, patch)
  )
  ipcMain.handle('memory:approve', (_e, id: string) => approveFact(id))
  ipcMain.handle('memory:remove', (_e, id: string) => removeFact(id))
  ipcMain.handle('memory:autoExtract', (_e, sessionId: string) => extractFacts(sessionId))

  // Calendário
  ipcMain.handle('calendar:load', () => loadEvents())
  ipcMain.handle(
    'calendar:add',
    (
      _e,
      ev: {
        title: string
        whenISO: string
        description?: string
        remindMinutes?: number
        recurrence?: CalendarEvent['recurrence']
      }
    ) => addEvent(ev)
  )
  ipcMain.handle('calendar:remove', (_e, id: string) => removeEvent(id))
  ipcMain.handle('calendar:save', (_e, events: CalendarEvent[]) => setEvents(events))

  // Sessões de conversa
  ipcMain.handle('sessions:list', () => listSessions())
  ipcMain.handle('sessions:get', (_e, id: string) => getSession(id))
  ipcMain.handle('sessions:create', (_e, title?: string) => createSession(title))
  ipcMain.handle('sessions:rename', (_e, id: string, title: string) => renameSession(id, title))
  ipcMain.handle('sessions:delete', (_e, id: string) => deleteSession(id))

  // STT (fala -> texto)
  ipcMain.handle('stt:transcribe', async (_e, audio: ArrayBuffer, mimeType: string): Promise<string> => {
    return transcribe(readConfig(), audio, mimeType)
  })

  // Chat (agente): um turno completo com ações (voice = resposta mais curta)
  ipcMain.handle('chat:ask', async (_e, payload: { sessionId: string; text: string; voice?: boolean }) => {
    return runTurn(payload.sessionId, payload.text, !!payload.voice)
  })

  // Briefing do dia + diagnóstico do sistema
  ipcMain.handle('briefing:get', async () => buildBriefing(readConfig()))
  ipcMain.handle('diagnostics:get', async () => getDiagnostics())

  // Abrir link/anexo de cartão no app padrão do sistema (http(s):// ou file://)
  ipcMain.handle('system:openExternal', async (_e, url: string) => {
    const u = String(url || '').trim()
    if (/^(https?:|file:|mailto:)/i.test(u)) await shell.openExternal(u)
    return true
  })

  // TTS Piper (voz neural) -> WAV
  ipcMain.handle('tts:synthesize', async (_e, text: string, opts: { voice?: string; rate?: number }) => {
    const buf = await synthesize(text, opts)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  })
  ipcMain.handle('tts:status', () => ({ ready: isPiperReady(), voices: listPiperVoices(), platform: process.platform }))

  // Widgets / consultas diretas
  ipcMain.handle('weather:get', (_e, city: string) => getWeather(city))
  ipcMain.handle('weather:getCurrent', (_e, location: UserLocation) => getWeatherAt(location))
  ipcMain.handle('location:reverse', (_e, latitude: number, longitude: number) => reverseGeocode(latitude, longitude))
  ipcMain.handle('news:get', (_e, topic: string) => getNews(topic))
}
