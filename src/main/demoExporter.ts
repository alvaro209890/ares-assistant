import AdmZip from 'adm-zip'
import { logger } from './logger'
import { dialog, BrowserWindow } from 'electron'
import type { DemoSlide } from '../shared/types'

// Não importa demoManager para evitar dependência circular
// (demoManager → demoExporter → demoManager).
// Em vez disso, demoManager chama demoExporter.captureSlide() diretamente.

interface CapturedSlide {
  slide: DemoSlide
  screenshot: Buffer | null
  audio: Buffer | null
  narration: string
}

class DemoExporter {
  private slides: CapturedSlide[] = []
  private isRecording = false
  private pendingCapture: ReturnType<typeof setTimeout> | null = null
  // Fila serializa capturas para evitar race condition ao avançar slides rapidamente
  private captureQueue: Promise<void> = Promise.resolve()
  // Slide mais recente passado para captureSlide, usado em recordPhrase
  private lastQueuedSlideId: string | null = null

  public startRecording(): void {
    this.slides = []
    this.isRecording = true
    this.lastQueuedSlideId = null
    this.captureQueue = Promise.resolve()
    logger.info('demo', 'Iniciada gravação do Demo Mode')
  }

  public stopRecording(): void {
    this.isRecording = false
    if (this.pendingCapture) {
      clearTimeout(this.pendingCapture)
      this.pendingCapture = null
    }
    logger.info('demo', `Gravação do Demo Mode encerrada com ${this.slides.length} slide(s)`)
  }

  /** Chamado pelo demoManager ao exibir cada slide. Captura screenshot com delay. */
  public captureSlide(slide: DemoSlide): void {
    if (!this.isRecording) return
    this.lastQueuedSlideId = slide.id
    // Cancela captura pendente do slide anterior (usuário avançou rápido)
    if (this.pendingCapture) {
      clearTimeout(this.pendingCapture)
      this.pendingCapture = null
    }
    // Aguarda 600 ms para a UI animar o slide antes de capturar
    this.pendingCapture = setTimeout(() => {
      this.pendingCapture = null
      // Enfileira na promise chain para serializar capturas concorrentes
      this.captureQueue = this.captureQueue.then(() => this.doCapture(slide))
    }, 600)
  }

  private async doCapture(slide: DemoSlide): Promise<void> {
    const windows = BrowserWindow.getAllWindows()
    const mainWindow = windows.find((w) => !w.isDestroyed()) ?? null
    let screenshot: Buffer | null = null
    if (mainWindow) {
      try {
        const image = await mainWindow.webContents.capturePage()
        screenshot = image.toPNG()
      } catch (err) {
        logger.error('demo', 'Erro ao capturar screenshot do slide', err)
      }
    }
    // Evita duplicata: se já existe entrada para este slide, atualiza o screenshot
    const existing = this.slides.find((s) => s.slide.id === slide.id)
    if (existing) {
      if (screenshot) existing.screenshot = screenshot
      return
    }
    this.slides.push({ slide, screenshot, audio: null, narration: slide.title })
    logger.info('demo', `Slide capturado: ${slide.title}`)
  }

  /**
   * Chamado pelo sintetizador TTS (index.ts) após gerar o áudio de uma frase.
   * Aguarda a fila de captura terminar antes de associar o áudio ao slide correto.
   */
  public async recordPhrase(text: string, audioBuffer: Buffer): Promise<void> {
    if (!this.isRecording) return
    // Garante que o doCapture do slide atual já terminou antes de associar o áudio
    await this.captureQueue
    if (!this.lastQueuedSlideId) return
    const target = this.slides.find((s) => s.slide.id === this.lastQueuedSlideId)
    if (target && !target.audio) {
      target.audio = audioBuffer
      target.narration = text
    }
  }

  public async exportZip(): Promise<boolean> {
    if (this.slides.length === 0) {
      logger.warn('demo', 'Nenhum slide capturado para exportar. Inicie a apresentação primeiro.')
      return false
    }

    const windows = BrowserWindow.getAllWindows()
    const mainWindow = windows.find((w) => !w.isDestroyed()) ?? null
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

      for (let i = 0; i < this.slides.length; i++) {
        const { slide, screenshot, audio, narration } = this.slides[i]
        const idx = i + 1
        const imgName = `slide_${idx}.png`
        const audName = `audio_${idx}.wav`

        if (screenshot) zip.addFile(imgName, screenshot)
        if (audio) zip.addFile(audName, audio)

        const pointsHtml = slide.points?.length
          ? `<ul>${slide.points.map((p) => `<li>${p}</li>`).join('')}</ul>`
          : ''
        const codeHtml = slide.codeSnippet
          ? `<pre><code>${slide.codeSnippet.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`
          : ''
        const audioHtml = audio
          ? `<audio controls><source src="${audName}" type="audio/wav"></audio>`
          : ''
        const narrationHtml =
          narration && narration !== slide.title
            ? `<p class="narration">${narration}</p>`
            : ''

        htmlBody += `
  <div class="slide">
    <h2>${slide.title}</h2>
    ${screenshot ? `<img src="${imgName}" alt="Slide ${idx}" />` : ''}
    ${pointsHtml}
    ${codeHtml}
    ${narrationHtml}
    ${audioHtml}
  </div>`
      }

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Ares Demo Export</title>
  <style>
    body { font-family: sans-serif; background: #04070f; color: #fff; max-width: 1000px; margin: 0 auto; padding: 20px; }
    h1 { color: #67e8f9; }
    .slide { border: 1px solid #164e63; border-radius: 12px; margin-bottom: 30px; padding: 20px; background: #083344; }
    .slide h2 { color: #67e8f9; margin-top: 0; }
    img { max-width: 100%; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); margin-bottom: 12px; display: block; }
    ul { color: #a5f3fc; padding-left: 20px; line-height: 1.7; }
    pre { background: #0c1a2e; border: 1px solid #1e3a5f; border-radius: 8px; padding: 14px; overflow-x: auto; }
    code { color: #7dd3fc; font-size: 0.9em; }
    .narration { color: #94a3b8; font-style: italic; }
    audio { width: 100%; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>Ares Demo Presentation</h1>
  ${htmlBody}
</body>
</html>`

      zip.addFile('index.html', Buffer.from(html, 'utf-8'))
      zip.writeZip(filePath)
      logger.info('demo', `Exportação salva em: ${filePath} (${this.slides.length} slide(s))`)
      return true
    } catch (err) {
      logger.error('demo', 'Erro ao exportar ZIP', err)
      return false
    }
  }
}

export const demoExporter = new DemoExporter()
