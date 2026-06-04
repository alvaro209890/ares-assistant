import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import type { AresState } from '../shared/types'

// Mini-orbe flutuante (companion) always-on-top. Reusa o renderer carregado com
// hash #overlay, então a janela é pequena, sem moldura e transparente. O estado da
// orbe é espelhado do processo renderer principal via setOverlayState.

let overlayWin: BrowserWindow | null = null
let getMain: (() => BrowserWindow | null) | null = null

export function initOverlay(mainGetter: () => BrowserWindow | null): void {
  getMain = mainGetter
}

export function isOverlayOpen(): boolean {
  return !!overlayWin && !overlayWin.isDestroyed()
}

export function setOverlayState(state: AresState): void {
  if (isOverlayOpen()) overlayWin!.webContents.send('overlay:state', state)
}

export function showOverlay(): void {
  if (isOverlayOpen()) {
    overlayWin!.show()
    return
  }
  const { workArea } = screen.getPrimaryDisplay()
  const size = 148
  overlayWin = new BrowserWindow({
    width: size,
    height: size,
    x: workArea.x + workArea.width - size - 24,
    y: workArea.y + workArea.height - size - 24,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    alwaysOnTop: true,
    title: 'ARES',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
  overlayWin.setAlwaysOnTop(true, 'screen-saver')
  try {
    overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch {
    /* nem todo SO suporta */
  }
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) overlayWin.loadURL(`${devUrl}#overlay`)
  else overlayWin.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
  overlayWin.on('closed', () => {
    overlayWin = null
  })
}

export function hideOverlay(): void {
  if (isOverlayOpen()) overlayWin!.close()
  overlayWin = null
}

export function toggleOverlay(show: boolean): void {
  if (show) showOverlay()
  else hideOverlay()
}

/** Traz a janela principal para frente (clique na orbe flutuante). */
export function focusMain(): void {
  const w = getMain?.()
  if (!w || w.isDestroyed()) return
  if (w.isMinimized()) w.restore()
  if (!w.isVisible()) w.show()
  w.focus()
}

/** Pede à janela principal para iniciar uma captura de voz (botão da orbe). */
export function requestListen(): void {
  focusMain()
  const w = getMain?.()
  if (w && !w.isDestroyed()) w.webContents.send('overlay:listen')
}
