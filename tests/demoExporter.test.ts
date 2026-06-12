import { describe, it, expect, vi, beforeEach } from 'vitest'
import { demoExporter } from '../src/main/demoExporter'
import { demoManager } from '../src/main/demoManager'

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => ([
      {
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
    demoExporter.assets = []
  })

  it('deve descartar gravação se não estiver rodando (isRecording = false)', async () => {
    await demoExporter.recordPhrase('oi', Buffer.from('audio'))
    // @ts-ignore
    expect(demoExporter.assets.length).toBe(0)
  })

  it('deve gravar assets corretamente quando ativo', async () => {
    demoExporter.startRecording()
    demoManager.start() // ativa o demo manager
    
    const fakeAudio = Buffer.from('wav-data')
    await demoExporter.recordPhrase('Primeiro slide', fakeAudio)
    
    // @ts-ignore
    expect(demoExporter.assets.length).toBe(1)
    // @ts-ignore
    expect(demoExporter.assets[0].text).toBe('Primeiro slide')
    // @ts-ignore
    expect(demoExporter.assets[0].audio).toBe(fakeAudio)
    // @ts-ignore
    expect(demoExporter.assets[0].screenshot.toString()).toBe('fake-png')
  })
})
