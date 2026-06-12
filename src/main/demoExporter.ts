import AdmZip from 'adm-zip'
import { demoManager } from './demoManager'
import { logger } from './logger'
import { dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'

interface DemoAsset {
  slideId: string
  screenshot: Buffer
  audio: Buffer
  text: string
}

class DemoExporter {
  private assets: DemoAsset[] = []
  private isRecording = false

  public startRecording() {
    this.assets = []
    this.isRecording = true
    logger.info('demo', 'Iniciada gravação do Demo Mode')
  }

  public stopRecording() {
    this.isRecording = false
    logger.info('demo', `Gravação do Demo Mode pausada/parada com ${this.assets.length} assets`)
  }

  public async recordPhrase(text: string, audioBuffer: Buffer) {
    if (!this.isRecording || !demoManager.getState().isActive) return

    const state = demoManager.getState()
    const slideId = state.currentSlide?.id || 'unknown'

    // Aguarda um pequeno momento para a UI do React ter animado o slide atual
    await new Promise(resolve => setTimeout(resolve, 500))

    const windows = BrowserWindow.getAllWindows()
    const mainWindow = windows.length > 0 ? windows[0] : null
    if (!mainWindow) return

    try {
      const image = await mainWindow.webContents.capturePage()
      const screenshot = image.toPNG()
      
      this.assets.push({
        slideId,
        text,
        screenshot,
        audio: audioBuffer
      })
      
      logger.info('demo', `Capturado slide ${slideId} (${text.substring(0, 20)}...)`)
    } catch (err) {
      logger.error('demo', 'Erro ao capturar tela para exportação', err)
    }
  }

  public async exportZip(): Promise<boolean> {
    if (this.assets.length === 0) {
      logger.warn('demo', 'Nenhum asset gravado para exportar.')
      return false
    }

    const windows = BrowserWindow.getAllWindows()
    const mainWindow = windows.length > 0 ? windows[0] : null
    if (!mainWindow) return false

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar Exportação de Apresentação',
      defaultPath: 'ares-demo.zip',
      filters: [{ name: 'Arquivo ZIP', extensions: ['zip'] }]
    })

    if (canceled || !filePath) return false

    try {
      const zip = new AdmZip()
      let htmlBody = ''

      this.assets.forEach((asset, i) => {
        const slideIndex = i + 1
        const imgName = `slide_${slideIndex}.png`
        const audName = `audio_${slideIndex}.wav`

        zip.addFile(imgName, asset.screenshot)
        zip.addFile(audName, asset.audio)

        htmlBody += `
        <div class="slide">
          <img src="${imgName}" alt="Slide ${slideIndex}" />
          <p>${asset.text}</p>
          <audio controls>
            <source src="${audName}" type="audio/wav">
          </audio>
        </div>`
      })

      const htmlPage = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Ares Demo Export</title>
        <style>
          body { font-family: sans-serif; background: #04070f; color: #fff; max-width: 1000px; margin: 0 auto; padding: 20px; }
          .slide { border: 1px solid #164e63; border-radius: 12px; margin-bottom: 30px; padding: 20px; background: #083344; }
          img { max-width: 100%; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
          audio { width: 100%; margin-top: 15px; }
          p { color: #67e8f9; font-size: 1.1em; line-height: 1.5; }
        </style>
      </head>
      <body>
        <h1>Ares Demo Presentation</h1>
        ${htmlBody}
      </body>
      </html>
      `

      zip.addFile('index.html', Buffer.from(htmlPage, 'utf-8'))
      zip.writeZip(filePath)
      
      logger.info('demo', `Exportação salva com sucesso em: ${filePath}`)
      return true
    } catch (err) {
      logger.error('demo', 'Erro ao exportar ZIP', err)
      return false
    }
  }
}

export const demoExporter = new DemoExporter()
