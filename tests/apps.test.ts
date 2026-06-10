import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  listStartMenuApps,
  matchShortcut,
  normalizeAppName,
  scanShortcuts,
  scoreAppMatch,
  startMenuDirs,
  type StartMenuApp
} from '../src/main/apps'

const app = (name: string): StartMenuApp => ({ name, path: `C:\\fake\\${name}.lnk` })

const INSTALLED: StartMenuApp[] = [
  app('Spotify'),
  app('Visual Studio Code'),
  app('Word'),
  app('Microsoft Edge'),
  app('WhatsApp'),
  app('Steam'),
  app('VLC media player'),
  app('Google Chrome')
]

describe('apps — normalização e casamento de nomes falados', () => {
  it('normaliza acentos, caixa e pontuação', () => {
    expect(normalizeAppName('Visual Studio Code')).toBe('visual studio code')
    expect(normalizeAppName('  VLC — media player! ')).toBe('vlc media player')
    expect(normalizeAppName('Configurações')).toBe('configuracoes')
  })

  it('casa nome exato e prefixo', () => {
    expect(matchShortcut('spotify', INSTALLED)?.name).toBe('Spotify')
    expect(matchShortcut('word', INSTALLED)?.name).toBe('Word')
    expect(matchShortcut('vlc', INSTALLED)?.name).toBe('VLC media player')
  })

  it('casa por palavras parciais ("studio code" -> Visual Studio Code)', () => {
    expect(matchShortcut('studio code', INSTALLED)?.name).toBe('Visual Studio Code')
    expect(matchShortcut('edge', INSTALLED)?.name).toBe('Microsoft Edge')
    expect(matchShortcut('chrome', INSTALLED)?.name).toBe('Google Chrome')
  })

  it('tolera pequenos erros de transcrição de voz', () => {
    expect(matchShortcut('spotifi', INSTALLED)?.name).toBe('Spotify')
    expect(matchShortcut('whatsap', INSTALLED)?.name).toBe('WhatsApp')
  })

  it('não inventa app quando nada casa com confiança', () => {
    expect(matchShortcut('fotoshop', INSTALLED)).toBeNull()
    expect(matchShortcut('x', INSTALLED)).toBeNull()
    expect(matchShortcut('', INSTALLED)).toBeNull()
  })

  it('prefere o nome mais curto/específico em empates', () => {
    const list = [app('Word Viewer Pro'), app('Word')]
    expect(matchShortcut('word', list)?.name).toBe('Word')
    expect(scoreAppMatch('word', 'word')).toBeGreaterThan(scoreAppMatch('word', 'word viewer pro'))
  })
})

describe('apps — varredura do Menu Iniciar', () => {
  const TMP = mkdtempSync(join(tmpdir(), 'ares-apps-'))
  afterAll(() => rmSync(TMP, { recursive: true, force: true }))

  it('encontra .lnk/.url recursivamente, deduplica e ignora ruído', () => {
    mkdirSync(join(TMP, 'Acessórios'), { recursive: true })
    writeFileSync(join(TMP, 'Spotify.lnk'), '')
    writeFileSync(join(TMP, 'Acessórios', 'Paint.lnk'), '')
    writeFileSync(join(TMP, 'Acessórios', 'Spotify.lnk'), '') // duplicado
    writeFileSync(join(TMP, 'Uninstall Spotify.lnk'), '') // ruído
    writeFileSync(join(TMP, 'Site oficial.url'), '') // ruído
    writeFileSync(join(TMP, 'leiame.txt'), '') // não é atalho

    const apps = scanShortcuts([TMP])
    const names = apps.map((a) => a.name).sort()
    expect(names).toEqual(['Paint', 'Spotify'])
  })

  it('startMenuDirs monta as pastas a partir do ambiente', () => {
    const dirs = startMenuDirs({ ProgramData: 'C:\\PD', APPDATA: 'C:\\AD' } as NodeJS.ProcessEnv)
    expect(dirs).toHaveLength(2)
    expect(dirs[0]).toContain('Start Menu')
    expect(startMenuDirs({} as NodeJS.ProcessEnv)).toEqual([])
  })

  it.skipIf(process.platform !== 'win32')('varredura real do Windows devolve apps sem lançar', () => {
    const apps = listStartMenuApps()
    expect(Array.isArray(apps)).toBe(true)
    expect(apps.length).toBeGreaterThan(0) // todo Windows tem ao menos os acessórios
    expect(apps.every((a) => a.path.toLowerCase().endsWith('.lnk') || a.path.toLowerCase().endsWith('.url'))).toBe(true)
  })
})
