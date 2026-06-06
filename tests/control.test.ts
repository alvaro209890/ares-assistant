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

describe('controle do computador — resolveOpenTarget', () => {
  it('abre URL http(s) com xdg-open', () => {
    expect(resolveOpenTarget('https://example.com', which([]))).toMatchObject({
      kind: 'url',
      cmd: 'xdg-open',
      args: ['https://example.com']
    })
  })

  it('completa domínio sem esquema para https', () => {
    const p = resolveOpenTarget('youtube.com', which([]))
    expect(p.kind).toBe('url')
    expect(p.args).toEqual(['https://youtube.com'])
  })

  it('resolve apelido de app para o primeiro binário existente', () => {
    expect(resolveOpenTarget('navegador', which(['google-chrome'])).cmd).toBe('google-chrome')
    expect(resolveOpenTarget('firefox', which(['firefox'])).cmd).toBe('firefox')
    expect(resolveOpenTarget('calculadora', which(['gnome-calculator'])).cmd).toBe('gnome-calculator')
  })

  it('erro quando o app do apelido não está instalado', () => {
    expect(resolveOpenTarget('firefox', which([])).kind).toBe('error')
  })

  it('bloqueia esquemas perigosos', () => {
    expect(resolveOpenTarget('javascript:alert(1)', which([])).kind).toBe('error')
    expect(resolveOpenTarget('ssh://host', which([])).kind).toBe('error')
  })

  it('aceita binário direto presente no PATH', () => {
    expect(resolveOpenTarget('htop', which(['htop']))).toMatchObject({ kind: 'app', cmd: 'htop' })
  })

  it('reclama quando não há alvo', () => {
    expect(resolveOpenTarget('', which([])).kind).toBe('error')
  })
})

describe('controle do computador — audioBackend', () => {
  it('prioriza wpctl > pactl > amixer', () => {
    expect(audioBackend(which(['wpctl', 'pactl', 'amixer']))).toBe('wpctl')
    expect(audioBackend(which(['pactl', 'amixer']))).toBe('pactl')
    expect(audioBackend(which(['amixer']))).toBe('amixer')
    expect(audioBackend(which([]))).toBeNull()
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
  it('mediaBackend prioriza playerctl, depois dbus', () => {
    expect(mediaBackend(which(['playerctl', 'dbus-send']))).toBe('playerctl')
    expect(mediaBackend(which(['dbus-send']))).toBe('dbus')
    expect(mediaBackend(which([]))).toBeNull()
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
