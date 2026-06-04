import { app, Tray, Menu, BrowserWindow, globalShortcut, nativeImage } from 'electron'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Presença no sistema: ícone na bandeja, atalho global e iniciar com o sistema.
// Tudo é best-effort e defensivo — falhas não derrubam o app.

const TRAY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAjklEQVR42u2X0Q3AIAhEHauzMEnX7U/XoL9Nm+pJEc5Ekvv1HkQBS1kxW2yHak1pxsNAeo1dQSoHy4f8IDqNmyB/zcUoG4ST+QsiOntbFVDz/VS9y6UKSPZPYxAEqwKSvRFAXABa5mgVFsC8ANGXMP4ZpjciilacPowoxnH6QkKxklEspRRrOc3HZMWouAAz5wJTleg38gAAAABJRU5ErkJggg=='

let tray: Tray | null = null
const SHORTCUT = 'CommandOrControl+Shift+Space'

function show(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function setupTray(getWin: () => BrowserWindow | null): void {
  if (tray) return
  try {
    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_PNG_BASE64}`)
    tray = new Tray(icon)
    tray.setToolTip('Ares')
    const menu = Menu.buildFromTemplate([
      { label: 'Abrir o Ares', click: () => show(getWin()) },
      {
        label: 'Falar agora',
        click: () => {
          const w = getWin()
          show(w)
          w?.webContents.send('overlay:listen')
        }
      },
      {
        label: 'Briefing do dia',
        click: () => {
          const w = getWin()
          show(w)
          w?.webContents.send('shortcut:briefing')
        }
      },
      { type: 'separator' },
      { label: 'Sair', click: () => app.quit() }
    ])
    tray.setContextMenu(menu)
    tray.on('click', () => show(getWin()))
  } catch {
    /* alguns ambientes Linux não têm bandeja; ignora */
  }
}

export function destroyTray(): void {
  try {
    tray?.destroy()
  } catch {
    /* ignora */
  }
  tray = null
}

export function registerGlobalShortcut(enabled: boolean, getWin: () => BrowserWindow | null): boolean {
  try {
    globalShortcut.unregister(SHORTCUT)
  } catch {
    /* ignora */
  }
  if (!enabled) return false
  try {
    return globalShortcut.register(SHORTCUT, () => {
      const w = getWin()
      show(w)
      w?.webContents.send('overlay:listen')
    })
  } catch {
    return false
  }
}

// Iniciar com o sistema. No Windows/macOS usa a API nativa. No Linux escreve um
// .desktop em ~/.config/autostart (efetivo de fato após empacotar o app).
export function setAutostart(enabled: boolean): void {
  try {
    if (process.platform === 'linux') {
      const dir = join(homedir(), '.config', 'autostart')
      const file = join(dir, 'ares.desktop')
      if (enabled) {
        mkdirSync(dir, { recursive: true })
        const exec = app.isPackaged ? process.execPath : `${process.execPath} ${app.getAppPath()}`
        writeFileSync(
          file,
          `[Desktop Entry]\nType=Application\nName=Ares\nExec=${exec}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`,
          'utf8'
        )
      } else if (existsSync(file)) {
        rmSync(file, { force: true })
      }
    } else {
      app.setLoginItemSettings({ openAtLogin: enabled })
    }
  } catch {
    /* best-effort */
  }
}
