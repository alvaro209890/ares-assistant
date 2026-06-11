import { describe, expect, it } from 'vitest'
import {
  audioBackend,
  buildBrightness,
  buildMedia,
  buildVolume,
  mediaBackend,
  resolveOpenTarget
} from '../src/main/control'

const which = (have: string[]) => (t: string) => have.includes(t)
const noApp = () => null
const menu = (apps: Record<string, string>) => (name: string) => {
  const hit = Object.entries(apps).find(([n]) => n.toLowerCase().includes(name.toLowerCase()))
  return hit ? { name: hit[0], path: hit[1] } : null
}

describe('controle do computador — resolveOpenTarget', () => {
  it('abre URL http(s) com o opener do sistema', () => {
    const plan = resolveOpenTarget('https://example.com', which([]), noApp)
    expect(plan.kind).toBe('url')
    if (process.platform === 'win32') {
      expect(plan.cmd).toBe('cmd')
      expect(plan.args).toContain('https://example.com')
    } else {
      expect(plan.cmd).toBe('xdg-open')
      expect(plan.args).toEqual(['https://example.com'])
    }
  })

  it('completa domínio sem esquema para https', () => {
    const p = resolveOpenTarget('youtube.com', which([]), noApp)
    expect(p.kind).toBe('url')
    expect(p.args).toContain('https://youtube.com')
  })

  it('resolve apelido de app para o primeiro binário existente', () => {
    if (process.platform === 'win32') {
      expect(resolveOpenTarget('navegador', which(['chrome']), noApp).cmd).toBe('chrome')
      expect(resolveOpenTarget('firefox', which(['firefox']), noApp).cmd).toBe('firefox')
      expect(resolveOpenTarget('calculadora', which(['calc']), noApp).cmd).toBe('calc')
      expect(resolveOpenTarget('bloco de notas', which(['notepad']), noApp).cmd).toBe('notepad')
    } else {
      expect(resolveOpenTarget('navegador', which(['google-chrome']), noApp).cmd).toBe('google-chrome')
      expect(resolveOpenTarget('firefox', which(['firefox']), noApp).cmd).toBe('firefox')
      expect(resolveOpenTarget('calculadora', which(['gnome-calculator']), noApp).cmd).toBe('gnome-calculator')
    }
  })

  it('apelido sem binário no PATH cai para o atalho do Menu Iniciar', () => {
    const apps = menu({ Spotify: 'C:\\SM\\Spotify.lnk', Word: 'C:\\SM\\Word.lnk' })
    const spotify = resolveOpenTarget('spotify', which([]), apps)
    expect(spotify.kind).toBe('app')
    expect(spotify.label).toBe('Spotify')
    expect((spotify.args || []).join(' ')).toContain('Spotify.lnk')
    expect(resolveOpenTarget('word', which([]), apps).label).toBe('Word')
  })

  it('nome falado de QUALQUER app instalado resolve pelo Menu Iniciar', () => {
    const apps = menu({ 'OBS Studio': 'C:\\SM\\OBS Studio.lnk' })
    const plan = resolveOpenTarget('obs', which([]), apps)
    expect(plan.kind).toBe('app')
    expect(plan.label).toBe('OBS Studio')
  })

  it('erro quando o app do apelido não está instalado em lugar nenhum', () => {
    expect(resolveOpenTarget('firefox', which([]), noApp).kind).toBe('error')
  })

  it('bloqueia esquemas perigosos', () => {
    expect(resolveOpenTarget('javascript:alert(1)', which([]), noApp).kind).toBe('error')
    expect(resolveOpenTarget('ssh://host', which([]), noApp).kind).toBe('error')
  })

  it.skipIf(process.platform !== 'win32')('abre as configurações do Windows via ms-settings:', () => {
    const direct = resolveOpenTarget('ms-settings:bluetooth', which([]), noApp)
    expect(direct.kind).toBe('url')
    const spoken = resolveOpenTarget('configurações', which([]), noApp)
    expect(spoken.kind).toBe('url')
    expect((spoken.args || []).join(' ')).toContain('ms-settings:')
  })

  it('aceita binário direto presente no PATH', () => {
    expect(resolveOpenTarget('htop', which(['htop']), noApp)).toMatchObject({ kind: 'app', cmd: 'htop' })
  })

  it('reclama quando não há alvo', () => {
    expect(resolveOpenTarget('', which([]), noApp).kind).toBe('error')
  })

  it('abre caminhos absolutos do Windows sem tratar letra de drive como esquema', () => {
    // Criamos um arquivo temporário físico para o existsSync retornar true
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-open-test-'))
    const tempFile = path.join(tempDir, 'jogo.html')
    fs.writeFileSync(tempFile, 'html content')

    const plan = resolveOpenTarget(tempFile, which([]), noApp)
    expect(plan.kind).toBe('path')
    if (process.platform === 'win32') {
      expect(plan.cmd).toBe('cmd')
      expect(plan.args).toContain(tempFile)
    }

    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})

describe('controle do computador — audioBackend', () => {
  it('retorna backend de áudio adequado à plataforma', () => {
    if (process.platform === 'win32') {
      expect(audioBackend(which([]))).toBe('powershell')
    } else {
      expect(audioBackend(which(['wpctl', 'pactl', 'amixer']))).toBe('wpctl')
      expect(audioBackend(which(['pactl', 'amixer']))).toBe('pactl')
      expect(audioBackend(which(['amixer']))).toBe('amixer')
      expect(audioBackend(which([]))).toBeNull()
    }
  })
})

describe('controle do computador — buildVolume', () => {
  it('wpctl: set/up/down/toggle', () => {
    expect(buildVolume('wpctl', { action: 'set', level: 50 }).args).toContain('50%')
    expect(buildVolume('wpctl', { action: 'up' }).args).toContain('5%+')
    expect(buildVolume('wpctl', { action: 'down' }).args).toContain('5%-')
    expect(buildVolume('wpctl', { action: 'toggle' })).toEqual({
      cmd: 'wpctl',
      args: ['set-mute', '@DEFAULT_AUDIO_SINK@', 'toggle']
    })
  })

  it('pactl: +/-% e sink padrão', () => {
    expect(buildVolume('pactl', { action: 'up' }).args).toEqual(['set-sink-volume', '@DEFAULT_SINK@', '+5%'])
    expect(buildVolume('pactl', { action: 'set', level: 30 }).args).toEqual(['set-sink-volume', '@DEFAULT_SINK@', '30%'])
    expect(buildVolume('pactl', { action: 'mute' }).args).toEqual(['set-sink-mute', '@DEFAULT_SINK@', '1'])
  })

  it('amixer: Master', () => {
    expect(buildVolume('amixer', { action: 'mute' }).args).toEqual(['-q', 'set', 'Master', 'mute'])
    expect(buildVolume('amixer', { action: 'unmute' }).args).toEqual(['-q', 'set', 'Master', 'unmute'])
  })

  it('clampa o nível entre 0 e 100', () => {
    expect(buildVolume('pactl', { action: 'set', level: 250 }).args).toContain('100%')
    expect(buildVolume('pactl', { action: 'set', level: -5 }).args).toContain('0%')
  })
})

describe('controle do computador — mídia', () => {
  it('mediaBackend retorna backend adequado à plataforma', () => {
    if (process.platform === 'win32') {
      expect(mediaBackend(which([]))).toBe('winkeys')
    } else {
      expect(mediaBackend(which(['playerctl', 'dbus-send']))).toBe('playerctl')
      expect(mediaBackend(which(['dbus-send']))).toBe('dbus')
      expect(mediaBackend(which([]))).toBeNull()
    }
  })

  it('buildMedia: playerctl usa verbos', () => {
    expect(buildMedia('playerctl', 'playpause')).toEqual({ cmd: 'playerctl', args: ['play-pause'] })
    expect(buildMedia('playerctl', 'next')).toEqual({ cmd: 'playerctl', args: ['next'] })
  })

  it('buildMedia: dbus chama o método MPRIS no player', () => {
    const plan = buildMedia('dbus', 'pause', 'org.mpris.MediaPlayer2.vlc')
    expect(plan.cmd).toBe('dbus-send')
    expect(plan.args).toContain('--dest=org.mpris.MediaPlayer2.vlc')
    expect(plan.args).toContain('org.mpris.MediaPlayer2.Player.Pause')
  })
})

describe('controle do computador — brilho', () => {
  it('set converte 0-100 em fração e clampa em [0.1, 1]', () => {
    expect(buildBrightness('eDP', { action: 'set', level: 50 }).fraction).toBe(0.5)
    expect(buildBrightness('eDP', { action: 'set', level: 0 }).fraction).toBe(0.1) // nunca apaga a tela
    expect(buildBrightness('eDP', { action: 'set', level: 200 }).fraction).toBe(1)
  })

  it('up/down ajustam a partir do brilho atual', () => {
    expect(buildBrightness('eDP', { action: 'up', current: 0.5 }).fraction).toBe(0.6)
    expect(buildBrightness('eDP', { action: 'down', current: 0.5 }).fraction).toBe(0.4)
    expect(buildBrightness('eDP', { action: 'down', current: 0.15 }).fraction).toBe(0.1) // piso
  })

  it('monta o comando xrandr para a saída', () => {
    const plan = buildBrightness('eDP', { action: 'set', level: 70 })
    expect(plan.cmd).toBe('xrandr')
    expect(plan.args).toEqual(['--output', 'eDP', '--brightness', '0.70'])
  })
})
