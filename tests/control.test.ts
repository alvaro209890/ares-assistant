import { describe, expect, it } from 'vitest'
import { audioBackend, buildVolume, resolveOpenTarget } from '../src/main/control'

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
