import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { demoExporter } from '../src/main/demoExporter'
import { demoManager } from '../src/main/demoManager'

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => ([
      {
        isDestroyed: vi.fn(() => false),
        webContents: {
          capturePage: vi.fn().mockResolvedValue({
            toPNG: vi.fn().mockReturnValue(Buffer.from('fake-png'))
          })
        }
      }
    ]))
  }
}))

describe('DemoExporter', () => {
  beforeEach(() => {
    // Reset state before each test
    demoExporter.stopRecording()
    // @ts-ignore
    demoExporter.slides = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve descartar gravação se não estiver rodando (isRecording = false)', async () => {
    await demoExporter.recordPhrase('oi', Buffer.from('audio'))
    // @ts-ignore
    expect(demoExporter.slides.length).toBe(0)
  })

  it('deve gravar assets corretamente quando ativo', async () => {
    demoManager.start() // ativa gravação no exporter
    demoManager.queueSlide({
      id: 'slide-1',
      title: 'Primeiro slide',
      points: []
    })
    await vi.advanceTimersByTimeAsync(650)
    
    const fakeAudio = Buffer.from('wav-data')
    await demoExporter.recordPhrase('Primeiro slide', fakeAudio)
    
    // @ts-ignore
    expect(demoExporter.slides.length).toBe(1)
    // @ts-ignore
    expect(demoExporter.slides[0].narration).toBe('Primeiro slide')
    // @ts-ignore
    expect(demoExporter.slides[0].audio).toBe(fakeAudio)
    // @ts-ignore
    expect(demoExporter.slides[0].screenshot.toString()).toBe('fake-png')
  })
})
