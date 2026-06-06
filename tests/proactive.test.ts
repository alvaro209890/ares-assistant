import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BatteryInfo, ProactiveState } from '../src/main/proactive'
import { buildNudges, pickProactiveNudge, readBattery, readBatteryFrom } from '../src/main/proactive'

const battery = (over: Partial<BatteryInfo> = {}): BatteryInfo => ({
  present: true,
  percent: 80,
  status: 'Discharging',
  charging: false,
  discharging: true,
  full: false,
  ...over
})

const noBattery: BatteryInfo = { present: false, percent: 0, status: '', charging: false, discharging: false, full: false }

// Um horário de DIA fixo (14h) para sair do silêncio noturno nos testes.
const DAYTIME = new Date('2026-06-06T14:00:00').getTime()
const NIGHT = new Date('2026-06-06T23:30:00').getTime()

const state = (over: Partial<ProactiveState> = {}): ProactiveState => ({
  now: DAYTIME,
  battery: noBattery,
  events: [],
  overdueCount: 0,
  eventHeadsUpMin: 10,
  ...over
})

describe('proatividade — leitura de bateria', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ares-bat-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('lê capacidade e status (descarregando)', () => {
    const bat = join(dir, 'BAT0')
    mkdirSync(bat)
    writeFileSync(join(bat, 'capacity'), '15\n')
    writeFileSync(join(bat, 'status'), 'Discharging\n')
    const info = readBatteryFrom(bat)
    expect(info).toMatchObject({ present: true, percent: 15, discharging: true, charging: false })
  })

  it('detecta carregando', () => {
    const bat = join(dir, 'BAT0')
    mkdirSync(bat)
    writeFileSync(join(bat, 'capacity'), '95')
    writeFileSync(join(bat, 'status'), 'Charging')
    expect(readBatteryFrom(bat)).toMatchObject({ charging: true, discharging: false })
  })

  it('present:false quando não há bateria', () => {
    expect(readBatteryFrom(join(dir, 'inexistente')).present).toBe(false)
    expect(readBattery(join(dir, 'inexistente')).present).toBe(false)
  })
})

describe('proatividade — buildNudges', () => {
  it('avisa bateria crítica (<=10%, descarregando)', () => {
    const n = buildNudges(state({ battery: battery({ percent: 8 }) }))
    expect(n.find((x) => x.id === 'battery-critical')?.priority).toBe(100)
  })

  it('avisa bateria fraca (<=20%) e não quando está carregando', () => {
    expect(buildNudges(state({ battery: battery({ percent: 18 }) })).some((x) => x.id === 'battery-low')).toBe(true)
    expect(
      buildNudges(state({ battery: battery({ percent: 18, charging: true, discharging: false }) })).some((x) => x.id === 'battery-low')
    ).toBe(false)
  })

  it('avisa bateria cheia ao carregar (>=97%)', () => {
    const n = buildNudges(state({ battery: battery({ percent: 99, charging: true, discharging: false }) }))
    expect(n.some((x) => x.id === 'battery-full')).toBe(true)
  })

  it('dá heads-up de evento sem lembrete configurado, e ignora os com lead', () => {
    const soon = new Date(DAYTIME + 7 * 60_000).toISOString()
    const semLead = buildNudges(state({ events: [{ id: 'e1', title: 'Reunião', whenISO: soon }] }))
    expect(semLead.find((x) => x.id === 'event-e1')?.text).toMatch(/em 7 minutos: Reunião/)
    const comLead = buildNudges(state({ events: [{ id: 'e2', title: 'X', whenISO: soon, remindMinutes: 30 }] }))
    expect(comLead.some((x) => x.id === 'event-e2')).toBe(false)
  })

  it('não dá heads-up de evento fora da janela', () => {
    const longe = new Date(DAYTIME + 40 * 60_000).toISOString()
    expect(buildNudges(state({ events: [{ id: 'e3', title: 'X', whenISO: longe }] })).length).toBe(0)
  })

  it('avisa tarefas vencidas', () => {
    const n = buildNudges(state({ overdueCount: 3 }))
    expect(n.find((x) => x.id === 'overdue')?.text).toMatch(/3 tarefas vencidas/)
  })
})

describe('proatividade — pickProactiveNudge', () => {
  it('escolhe o de maior prioridade', () => {
    const s = state({ battery: battery({ percent: 5 }), overdueCount: 2 })
    expect(pickProactiveNudge(s, {}, 0, 8 * 60_000)?.id).toBe('battery-critical')
  })

  it('respeita o cooldown por aviso', () => {
    const s = state({ overdueCount: 1 })
    const picked = pickProactiveNudge(s, {}, 0, 0)
    expect(picked?.id).toBe('overdue')
    // dentro do cooldown -> não repete
    expect(pickProactiveNudge(s, { overdue: s.now - 1000 }, 0, 0)).toBeNull()
  })

  it('no silêncio (22h–7h) só passa o crítico', () => {
    const baixa = state({ now: NIGHT, battery: battery({ percent: 18 }) })
    expect(pickProactiveNudge(baixa, {}, 0, 0)).toBeNull()
    const critica = state({ now: NIGHT, battery: battery({ percent: 6 }) })
    expect(pickProactiveNudge(critica, {}, 0, 0)?.id).toBe('battery-critical')
  })

  it('intervalo mínimo evita tagarelar (exceto crítico)', () => {
    const s = state({ overdueCount: 1 })
    // último aviso há 1 min, intervalo mínimo 8 min -> segura
    expect(pickProactiveNudge(s, {}, s.now - 60_000, 8 * 60_000)).toBeNull()
    // mas o crítico fura o intervalo
    const crit = state({ battery: battery({ percent: 5 }) })
    expect(pickProactiveNudge(crit, {}, crit.now - 60_000, 8 * 60_000)?.id).toBe('battery-critical')
  })

  it('sem gatilhos, não fala', () => {
    expect(pickProactiveNudge(state(), {}, 0, 0)).toBeNull()
  })
})
