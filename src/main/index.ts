import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'path'
import { ensureConfig, readConfig, updateConfig } from './config'
import { loadBoard, saveBoard } from './tasks'
import { transcribe } from './grog'
import { runTurn, extractFacts } from './agent'
import { chatJSON } from './ninerouter'
import { cancelSession } from './running'
import { buildBriefing } from './briefing'
import { getDiagnostics } from './diagnostics'
import { initOverlay, toggleOverlay, setOverlayState, focusMain, requestListen } from './overlay'
import { setupTray, destroyTray, registerGlobalShortcut, setAutostart } from './desktop'
import { exportData, importData } from './backup'
import { getSystemMetrics, readClipboard } from './system'
import { openRouterOAuth } from './oauth'
import { getProvider } from '../shared/providers'
import { startReminders } from './notify'
import { synthesize, listPiperVoices, isPiperReady, ensurePiper } from './piper'
import { shutdownPiperPool } from './piperEngine'
import { initLogger, logger, getRecentLogs, errToMessage } from './logger'
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
  deleteSession,
  loadLists,
  setLists,
  loadNotes,
  addNote,
  removeNote,
  loadReminders,
  addReminder,
  removeReminder,
  setReminders
} from './data'
import type {
  AppConfig,
  AresState,
  Board,
  CalendarEvent,
  Checklist,
  DeepPartial,
  MemoryCategory,
  ReasoningLevel,
  Recurrence,
  Reminder,
  UserLocation
} from '../shared/types'

// Nome do app: define userData (Linux: ~/.config/ares) com config/tasks/memória/etc.
app.setName('ares')

// No Linux, o Chromium do Electron desliga a síntese de voz por padrão.
// Habilita o speech-dispatcher para a voz Web Speech (reserva) sair no áudio.
app.commandLine.appendSwitch('enable-speech-dispatcher')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
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
  // Fechar a janela principal encerra também o overlay (evita o app ficar vivo só com a orbe).
  mainWindow.on('closed', () => {
    toggleOverlay(false)
    mainWindow = null
  })
}

app.whenReady().then(() => {
  initLogger(app.getPath('userData'))
  logger.info('app', `Ares ${app.getVersion()} iniciado — ${process.platform} ${process.arch}, electron ${process.versions.electron}`)
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
  initOverlay(() => mainWindow)
  const cfg0 = readConfig()
  if (cfg0.ui.overlayEnabled) toggleOverlay(true)
  setupTray(() => mainWindow)
  registerGlobalShortcut(cfg0.ui.globalShortcut, () => mainWindow)
  setAutostart(cfg0.ui.autostart)
  startReminders(() => mainWindow)
  // Garante o Piper (voz neural) em background; até ficar pronto, usa-se a Web Speech.
  ensurePiper()
    .then((ok) => logger.info('piper', ok ? 'voz neural pronta' : 'Piper indisponível (usando Web Speech)'))
    .catch((e) => logger.warn('piper', 'falha ao preparar o Piper', e))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  destroyTray()
  shutdownPiperPool()
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

  // Chat (agente): um turno completo com ações (voice = resposta mais curta).
  // A "fala" é transmitida em tempo real via evento 'chat:delta'; o invoke
  // resolve com o resultado final (board, memória, eventos, notas).
  ipcMain.handle('chat:ask', async (event, payload: { sessionId: string; text: string; voice?: boolean }) => {
    return runTurn(
      payload.sessionId,
      payload.text,
      !!payload.voice,
      (chunk, phase, kind = 'both') => {
        if (!event.sender.isDestroyed()) event.sender.send('chat:delta', { chunk, phase, kind })
      },
      (activity) => {
        if (!event.sender.isDestroyed()) event.sender.send('chat:activity', activity)
      }
    )
  })
  // Cancela comandos/coder em execução na sessão (ex.: parar um build travado pelo Esc).
  ipcMain.handle('code:cancel', (_e, sessionId: string): number => cancelSession(sessionId))

  // Briefing do dia + diagnóstico do sistema
  ipcMain.handle('briefing:get', async () => buildBriefing(readConfig()))
  ipcMain.handle('diagnostics:get', async () => getDiagnostics())

  // Telemetria do sistema (HUD) + leitura da área de transferência
  ipcMain.handle('metrics:get', () => getSystemMetrics())
  ipcMain.handle('clipboard:read', () => readClipboard())

  // Abrir link/anexo de cartão no app padrão do sistema (http(s):// ou file://)
  ipcMain.handle('system:openExternal', async (_e, url: string) => {
    const u = String(url || '').trim()
    if (/^(https?:|file:|mailto:)/i.test(u)) await shell.openExternal(u)
    return true
  })

  // Overlay flutuante (mini-orbe always-on-top)
  ipcMain.handle('overlay:set', (_e, enabled: boolean): AppConfig => {
    toggleOverlay(!!enabled)
    return updateConfig({ ui: { overlayEnabled: !!enabled } })
  })
  ipcMain.handle('overlay:pushState', (_e, state: AresState) => {
    setOverlayState(state)
    return true
  })
  ipcMain.handle('overlay:focusMain', () => {
    focusMain()
    return true
  })
  ipcMain.handle('overlay:command', () => {
    requestListen()
    return true
  })

  // TTS Piper (voz neural) -> WAV
  ipcMain.handle('tts:synthesize', async (_e, text: string, opts: { voice?: string; rate?: number }) => {
    try {
      const buf = await synthesize(text, opts)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    } catch (e) {
      logger.warn('tts', 'síntese Piper falhou (renderer cai para Web Speech)', e)
      throw e
    }
  })
  ipcMain.handle('tts:status', () => ({ ready: isPiperReady(), voices: listPiperVoices(), platform: process.platform }))

  // Logs recentes para a aba Sistema/Diagnóstico
  ipcMain.handle('logs:log', (_e, level: 'debug' | 'info' | 'warn' | 'error', scope: string, message: string, err?: unknown) => {
    if (level === 'error') logger.error(scope, message, err)
    else if (level === 'warn') logger.warn(scope, message, err)
    else if (level === 'info') logger.info(scope, message, err)
    else logger.debug(scope, message, err)
    return true
  })
  ipcMain.handle('logs:recent', (_e, limit?: number) => getRecentLogs(typeof limit === 'number' ? limit : 200))

  // Widgets / consultas diretas
  ipcMain.handle('weather:get', (_e, city: string) => getWeather(city))
  ipcMain.handle('weather:getCurrent', (_e, location: UserLocation) => getWeatherAt(location))
  ipcMain.handle('location:reverse', (_e, latitude: number, longitude: number) => reverseGeocode(latitude, longitude))
  ipcMain.handle('news:get', (_e, topic: string) => getNews(topic))

  // Listas simples
  ipcMain.handle('lists:load', () => loadLists())
  ipcMain.handle('lists:save', (_e, lists: Checklist[]) => setLists(lists))

  // Notas rápidas
  ipcMain.handle('notes:load', () => loadNotes())
  ipcMain.handle('notes:add', (_e, text: string) => addNote(text))
  ipcMain.handle('notes:remove', (_e, id: string) => removeNote(id))

  // Lembretes (remédio/rotina, timer, despertador)
  ipcMain.handle('reminders:load', () => loadReminders())
  ipcMain.handle(
    'reminders:add',
    (_e, r: { text: string; whenISO: string; recurrence?: Recurrence; kind?: Reminder['kind'] }) => addReminder(r)
  )
  ipcMain.handle('reminders:remove', (_e, id: string) => removeReminder(id))
  ipcMain.handle('reminders:save', (_e, rs: Reminder[]) => setReminders(rs))

  // Backup / restauração
  ipcMain.handle('data:export', () => exportData())
  ipcMain.handle('data:import', () => importData())

  // Atalho global + iniciar com o sistema
  ipcMain.handle('system:setGlobalShortcut', (_e, enabled: boolean): AppConfig => {
    registerGlobalShortcut(!!enabled, () => mainWindow)
    return updateConfig({ ui: { globalShortcut: !!enabled } })
  })
  ipcMain.handle('system:setAutostart', (_e, enabled: boolean): AppConfig => {
    setAutostart(!!enabled)
    return updateConfig({ ui: { autostart: !!enabled } })
  })

  // Teste rápido de conexão com o cérebro (9 Router)
  ipcMain.handle('brain:test', async (): Promise<{ ok: boolean; detail: string }> => {
    const cfg = readConfig()
    const url = cfg.nineRouter.baseUrl.replace(/\/$/, '') + '/models'
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3000)
    try {
      const headers: Record<string, string> = {}
      if (cfg.nineRouter.apiKey) headers['Authorization'] = `Bearer ${cfg.nineRouter.apiKey}`
      const res = await fetch(url, { signal: ctrl.signal, headers })
      clearTimeout(timer)
      return res.ok ? { ok: true, detail: 'Conexão OK' } : { ok: false, detail: `HTTP ${res.status}` }
    } catch (e: any) {
      clearTimeout(timer)
      return { ok: false, detail: e?.name === 'AbortError' ? 'sem resposta (timeout)' : 'offline / inacessível' }
    }
  })

  // Testa um nível de raciocínio específico no provedor/modelo atual: faz uma chamada
  // mínima com aquele reasoning_effort e mede a latência. Usado pelo botão "Testar
  // todos os níveis" na aba de Modelos. Não altera a config salva.
  ipcMain.handle(
    'brain:testReasoning',
    async (_e, level: ReasoningLevel): Promise<{ ok: boolean; level: ReasoningLevel; ms: number; detail: string }> => {
      const base = readConfig()
      const cfg: AppConfig = { ...base, nineRouter: { ...base.nineRouter, reasoning: level } }
      const started = Date.now()
      try {
        const out = await chatJSON(
          cfg,
          [{ role: 'user', content: 'Responda apenas com a palavra OK.' }],
          false
        )
        const ms = Date.now() - started
        const ok = typeof out === 'string' && out.trim().length > 0
        return { ok, level, ms, detail: ok ? `${out.trim().slice(0, 24)} · ${ms} ms` : 'resposta vazia' }
      } catch (e) {
        logger.warn('brain', `teste de raciocínio "${level}" falhou`, e)
        return { ok: false, level, ms: Date.now() - started, detail: errToMessage(e).slice(0, 80) }
      }
    }
  )

  // Login OAuth de provedor (hoje: OpenRouter). Em caso de sucesso, grava a chave
  // e aponta o cérebro para o provedor, devolvendo a config já atualizada.
  ipcMain.handle(
    'provider:oauth',
    async (_e, id: string): Promise<{ ok: boolean; config?: AppConfig; error?: string }> => {
      const preset = getProvider(id)
      if (!preset || preset.oauth !== 'openrouter') {
        return { ok: false, error: 'Provedor sem login OAuth disponível.' }
      }
      try {
        const key = await openRouterOAuth()
        const current = readConfig()
        const keepModel = current.nineRouter.model && current.nineRouter.baseUrl === preset.baseUrl
        const config = updateConfig({
          nineRouter: {
            baseUrl: preset.baseUrl,
            apiKey: key,
            model: keepModel ? current.nineRouter.model : preset.defaultModel
          }
        })
        return { ok: true, config }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    }
  )
}
