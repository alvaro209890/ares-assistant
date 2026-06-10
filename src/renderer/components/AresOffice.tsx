import { useEffect, useRef, useState } from 'react'
import type { AresState, SystemMetrics } from '../../shared/types'

/**
 * Escritório do Ares — cenário 2D animado e interativo na sidebar.
 *
 * Uma "janela" para a sala de controle do Ares: o personagem (silhueta neon
 * estilo holograma) trabalha numa bancada futurista, reage ao estado do
 * assistente (idle/listening/thinking/speaking), segue o mouse com os olhos,
 * responde a cliques e dorme se ficar muito tempo ocioso.
 *
 * Tudo é desenhado proceduralmente em Canvas 2D (sem sprites, sem WebGL),
 * com loop limitado a ~22fps e estado mutável fora do React (refs).
 */

interface AresOfficeProps {
  state: AresState // estado atual do assistente
  userName?: string // nome do usuário (vem de config.ui.userName)
  metrics?: SystemMetrics // CPU/RAM/uptime (para tooltip do monitor)
}

// ---------------------------------------------------------------------------
// Tipos internos da animação (mutáveis via ref — NÃO são React state)
// ---------------------------------------------------------------------------

type RGB = [number, number, number]
type IdleAction = 'head-turn' | 'look-monitor' | 'sip' | 'stretch' | 'nod'
type ClickReaction = 'wave' | 'stop'
type Region = 'character' | 'monitor' | 'monitor2' | 'mug' | 'clock' | null

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  alpha: number
  size: number
  life: number
  maxLife: number
  seed: number
  burst: boolean
}

interface FloatingSymbol {
  x: number
  y: number
  char: string
  alpha: number
  rotation: number
  vy: number
  life: number
  maxLife: number
  size: number
}

interface SpeechDot {
  x: number
  y: number
  r: number
  alpha: number
  vy: number
  life: number
}

/** Pose do personagem — valores suavizados a cada frame (transições 300-400ms). */
interface Pose {
  turn: number // -1..1 — virado pro monitor (negativo) ou pra caneca (positivo)
  lean: number // px de inclinação pra frente
  eyeOpen: number // 0..1.45 — abertura dos olhos
  headTilt: number // px de inclinação lateral da cabeça
  headDrop: number // px da cabeça caindo (sono / nod)
  shoulder: number // px de elevação dos ombros (negativo = sobe)
  mouth: number // 0..1.7 — abertura da boca
  look: number // px de offset X dos olhos (eye tracking)
  lookY: number // px de offset Y dos olhos
  hlx: number // mão esquerda (posição absoluta suavizada)
  hly: number
  hrx: number // mão direita
  hry: number
  halo: number // opacidade do halo
  init: boolean // primeira inicialização das mãos
}

interface OfficeState {
  time: number // tempo acumulado em segundos
  state: AresState // estado atual
  stateTime: number // tempo desde a última troca de estado
  color: RGB // cor do tema suavizada (transição entre estados)
  breathOff: number // offset Y de respiração no frame atual
  pose: Pose

  // Piscada / expressões
  blinkTimer: number // contagem até a próxima piscada
  blinkT: number // >0 enquanto pisca
  happyT: number // >0 — olhos "felizes" (arco sorridente)
  startleT: number // >0 — sobressalto ao acordar

  // Comportamento ocioso / sono
  idleFor: number // segundos em idle sem interação
  idleActTimer: number // contagem até a próxima micro-ação
  idleAction: IdleAction | null
  idleActionT: number // progresso da ação atual (s)
  yawnT: number // -1 inativo; >=0 bocejo em andamento
  yawnPlayed: boolean
  sleepBubbleShown: boolean
  zzzTimer: number

  // Interação
  mouseX: number
  mouseY: number
  mouseInside: boolean
  hoverChar: boolean
  hoverClock: boolean
  clockGlow: number // 0..1 suavizado
  mugReachT: number // 0 inativo; >0 gesto de pegar a caneca
  lastClickAt: number // performance.now() do último click
  clickCount: number // clicks rápidos acumulados
  reaction: ClickReaction | null
  reactionT: number
  waveT: number // -1 inativo; >=0 onda de energia (double-click)
  panelBoost: number // segundos restantes de brilho extra nos painéis

  // Bolha de status
  bubble: string | null
  bubbleQueue: string[]
  bubbleT: number
  bubbleAlpha: number
  lastHoverBubbleAt: number

  // Ambiente
  particles: Particle[]
  symbols: FloatingSymbol[]
  dots: SpeechDot[]
  dotTimer: number
  symbolTimer: number
  monitorScroll: number
  slideIndex: number
  slideTimer: number
  steam: number // 0..1 — opacidade do vapor da caneca
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Posições do cenário, derivadas do tamanho atual do canvas. */
interface Layout {
  w: number
  h: number
  cx: number
  headCY: number
  headR: number
  shoulderY: number
  deskTop: number
  deskFront: number
  deskBottom: number
  ledY: number
  mon1: Rect
  mon2: Rect
  mug: Rect
  clock: Rect
  panelA: Rect
  panelB: Rect
}

/** Fatores de iluminação conforme a hora do dia. */
interface Ambient {
  wall: number // multiplicador de brilho da parede
  warm: number // tom quente extra (manhã)
  led: number // boost dos LEDs (noite)
  psp: number // velocidade das partículas (madrugada = mais lentas)
}

// ---------------------------------------------------------------------------
// Constantes e helpers
// ---------------------------------------------------------------------------

const STATE_COLOR: Record<AresState, string> = {
  idle: '#38e1ff',
  listening: '#5ef0ff',
  thinking: '#6a78ff',
  speaking: '#7df0ff'
}

const IDLE_ACTIONS: IdleAction[] = ['head-turn', 'look-monitor', 'sip', 'stretch', 'nod']
const IDLE_ACT_DUR: Record<IdleAction, number> = {
  'head-turn': 2,
  'look-monitor': 2.2,
  sip: 2,
  stretch: 1.6,
  nod: 1.2
}

const THINK_SYMBOLS = ['⚙', '⚡', '{ }', '→', '</>']
const PARTICLE_TARGET: Record<AresState, number> = { idle: 6, listening: 7, thinking: 14, speaking: 9 }

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgba(c: RGB, a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`
}

/** Escurece/clareia um hex multiplicando os canais por `f`. */
function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`
}

function approach(cur: number, target: number, k: number): number {
  return cur + (target - cur) * k
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Pseudo-random determinístico (estável por índice — para padrões nos monitores). */
function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Caminho de retângulo arredondado (sem depender de ctx.roundRect). */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

/** Estágio de sono conforme tempo ocioso: 0 normal, 1 bocejo, 2 dormindo, 3 Zzz, 4 screensaver. */
function sleepStage(idleFor: number): number {
  if (idleFor >= 150) return 4
  if (idleFor >= 120) return 3
  if (idleFor >= 90) return 2
  if (idleFor >= 45) return 1
  return 0
}

function computeLayout(w: number, h: number): Layout {
  const cx = w * 0.5
  // h*0.16 mantém o personagem legível em alturas compactas (~70px);
  // o teto de 14 preserva as proporções no tamanho ideal (200px)
  const headR = Math.min(w * 0.07, h * 0.16, 14)
  const deskTop = h * 0.7
  return {
    w,
    h,
    cx,
    headCY: h * 0.4,
    headR,
    shoulderY: h * 0.53,
    deskTop,
    deskFront: h * 0.755,
    deskBottom: h * 0.86,
    ledY: h * 0.895,
    mon1: { x: w * 0.06, y: deskTop - h * 0.15, w: cx - headR * 2.4 - w * 0.06, h: h * 0.14 },
    mon2: { x: cx + headR * 2.3, y: deskTop - h * 0.11, w: w * 0.85 - (cx + headR * 2.3) + w * 0.04, h: h * 0.1 },
    mug: { x: w * 0.89, y: deskTop - h * 0.045, w: w * 0.055, h: h * 0.05 },
    clock: { x: w - 46, y: 6, w: 40, h: 14 },
    panelA: { x: w * 0.05, y: h * 0.08, w: w * 0.2, h: h * 0.15 },
    panelB: { x: w * 0.29, y: h * 0.11, w: w * 0.16, h: h * 0.1 }
  }
}

function charRect(L: Layout): Rect {
  const top = L.headCY - L.headR - 16
  return { x: L.cx - 32, y: top, w: 64, h: L.deskTop - top }
}

function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

function hitRegion(x: number, y: number, L: Layout): Region {
  if (inRect(x, y, charRect(L))) return 'character'
  if (inRect(x, y, L.mon1)) return 'monitor'
  if (inRect(x, y, L.mon2)) return 'monitor2'
  if (inRect(x, y, L.mug)) return 'mug'
  if (inRect(x, y, L.clock)) return 'clock'
  return null
}

function ambientForHour(hour: number): Ambient {
  if (hour >= 6 && hour < 12) return { wall: 1.08, warm: 0.04, led: 1, psp: 1 } // manhã, tom quente
  if (hour >= 12 && hour < 18) return { wall: 1, warm: 0, led: 1, psp: 1 } // tarde, padrão
  if (hour >= 18 && hour < 23) return { wall: 0.85, warm: 0, led: 1.25, psp: 1 } // noite, LEDs em destaque
  return { wall: 0.72, warm: 0, led: 1.35, psp: 0.6 } // madrugada, trabalho noturno
}

function greetingForHour(hour: number): string {
  if (hour >= 6 && hour < 12) return 'Bom dia.'
  if (hour >= 12 && hour < 18) return 'Boa tarde.'
  return 'Boa noite.'
}

function makeOfficeState(state: AresState): OfficeState {
  return {
    time: 0,
    state,
    stateTime: 0,
    color: hexToRgb(STATE_COLOR[state]),
    breathOff: 0,
    pose: {
      turn: 0,
      lean: 0,
      eyeOpen: 1,
      headTilt: 0,
      headDrop: 0,
      shoulder: 0,
      mouth: 0,
      look: 0,
      lookY: 0,
      hlx: 0,
      hly: 0,
      hrx: 0,
      hry: 0,
      halo: 0.3,
      init: false
    },
    blinkTimer: 2.5,
    blinkT: 0,
    happyT: 0,
    startleT: 0,
    idleFor: 0,
    idleActTimer: 9,
    idleAction: null,
    idleActionT: 0,
    yawnT: -1,
    yawnPlayed: false,
    sleepBubbleShown: false,
    zzzTimer: 0,
    mouseX: 0,
    mouseY: 0,
    mouseInside: false,
    hoverChar: false,
    hoverClock: false,
    clockGlow: 0,
    mugReachT: 0,
    lastClickAt: 0,
    clickCount: 0,
    reaction: null,
    reactionT: 0,
    waveT: -1,
    panelBoost: 0,
    bubble: null,
    bubbleQueue: [],
    bubbleT: 0,
    bubbleAlpha: 0,
    lastHoverBubbleAt: -999,
    particles: [],
    symbols: [],
    dots: [],
    dotTimer: 0,
    symbolTimer: 0,
    monitorScroll: 0,
    slideIndex: 0,
    slideTimer: 0,
    steam: 1
  }
}

function showBubble(s: OfficeState, text: string): void {
  s.bubble = text
  s.bubbleT = 0
  s.bubbleAlpha = 0
}

/** Registra interação do usuário: zera ociosidade e acorda com sobressalto se dormia. */
function wake(s: OfficeState): void {
  if (sleepStage(s.idleFor) >= 2) {
    s.startleT = 0.35
    showBubble(s, '!')
  }
  s.idleFor = 0
  s.yawnPlayed = false
  s.sleepBubbleShown = false
  if (s.yawnT >= 0) s.yawnT = -1
}

function spawnAmbientParticle(s: OfficeState, L: Layout): void {
  s.particles.push({
    x: Math.random() * L.w,
    y: L.h * 0.45 + Math.random() * L.h * 0.5,
    vx: (Math.random() - 0.5) * 8,
    vy: -(3 + Math.random() * 6),
    alpha: 0.2 + Math.random() * 0.3,
    size: 1 + Math.random(),
    life: 6 + Math.random() * 6,
    maxLife: 12,
    seed: Math.random() * 100,
    burst: false
  })
}

/** Explosão de partículas a partir do peito do personagem (click/double-click). */
function spawnBurst(s: OfficeState, L: Layout, count: number, speed: number): void {
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5
    const v = speed * (0.6 + Math.random() * 0.7)
    s.particles.push({
      x: L.cx,
      y: L.shoulderY,
      vx: Math.cos(ang) * v,
      vy: Math.sin(ang) * v,
      alpha: 0.8,
      size: 1 + Math.random() * 1.4,
      life: 0.7 + Math.random() * 0.3,
      maxLife: 1,
      seed: Math.random() * 100,
      burst: true
    })
  }
  // Mantém o pool sob controle (máx ~15 ambientes + rajada curta)
  if (s.particles.length > 30) s.particles.splice(0, s.particles.length - 30)
}

// ---------------------------------------------------------------------------
// Atualização da simulação (1x por frame)
// ---------------------------------------------------------------------------

function updateOffice(s: OfficeState, dt: number, L: Layout, amb: Ambient): void {
  s.time += dt
  s.stateTime += dt
  const p = s.pose

  // Cor do tema interpolada — transição suave (~350ms) entre estados
  const target = hexToRgb(STATE_COLOR[s.state])
  const ck = 1 - Math.exp(-dt * 9)
  s.color = [
    approach(s.color[0], target[0], ck),
    approach(s.color[1], target[1], ck),
    approach(s.color[2], target[2], ck)
  ]

  // Ociosidade / sono (só conta em idle)
  if (s.state === 'idle') s.idleFor += dt
  else s.idleFor = 0
  const stage = sleepStage(s.idleFor)
  if (stage >= 1 && !s.yawnPlayed) {
    s.yawnPlayed = true
    s.yawnT = 0
  }
  if (stage >= 1 && !s.sleepBubbleShown) {
    s.sleepBubbleShown = true
    showBubble(s, '💤')
  }
  if (s.yawnT >= 0) {
    s.yawnT += dt
    if (s.yawnT > 1.2) s.yawnT = -1
  }
  if (stage >= 3) {
    s.zzzTimer -= dt
    if (s.zzzTimer <= 0) {
      s.zzzTimer = 1.6
      s.symbols.push({
        x: L.cx + L.headR + 4 + Math.random() * 6,
        y: L.headCY - L.headR,
        char: 'Z',
        alpha: 0,
        rotation: -0.3 + Math.random() * 0.6,
        vy: -9,
        life: 2.4,
        maxLife: 2.4,
        size: 7 + Math.random() * 4
      })
    }
  }

  // Piscada (não pisca dormindo — olhos já fechados)
  if (s.blinkT > 0) s.blinkT -= dt
  else if (stage < 2 && s.yawnT < 0) {
    s.blinkTimer -= dt
    if (s.blinkTimer <= 0) {
      s.blinkT = 0.15
      s.blinkTimer = 3 + Math.random() * 3
    }
  }
  if (s.happyT > 0) s.happyT -= dt
  if (s.startleT > 0) s.startleT -= dt

  // Micro-ações de idle (a cada 8-15s, se acordado e sem reação em curso)
  if (s.state === 'idle' && stage === 0 && !s.reaction && !s.idleAction) {
    s.idleActTimer -= dt
    if (s.idleActTimer <= 0) {
      s.idleAction = pick(IDLE_ACTIONS)
      s.idleActionT = 0
    }
  }
  if (s.idleAction) {
    s.idleActionT += dt
    if (s.idleActionT >= IDLE_ACT_DUR[s.idleAction] || s.state !== 'idle') {
      s.idleAction = null
      s.idleActTimer = 8 + Math.random() * 7
    }
  }

  // Timers de reações/efeitos
  if (s.reaction) {
    s.reactionT += dt
    if (s.reactionT > 1) s.reaction = null
  }
  if (s.mugReachT > 0) {
    s.mugReachT += dt
    if (s.mugReachT > 2) s.mugReachT = 0
  }
  if (s.waveT >= 0) {
    s.waveT += dt
    if (s.waveT > 0.8) s.waveT = -1
  }
  if (s.panelBoost > 0) s.panelBoost -= dt
  s.clockGlow = approach(s.clockGlow, s.hoverClock ? 1 : 0, 1 - Math.exp(-dt * 8))

  // Respiração por estado
  let cycle = 3
  let amp = 1.6
  if (s.state === 'listening') {
    cycle = 1.8
    amp = 1
  } else if (s.state === 'thinking') {
    cycle = 2.6
    amp = 0.4
  } else if (s.state === 'speaking') {
    cycle = 1.5
    amp = 1.1
  }
  if (stage >= 2) {
    cycle = 4.2
    amp = 2.2
  }
  s.breathOff = Math.sin((s.time * Math.PI * 2) / cycle) * amp

  // Boca — pulso de fala com amplitude variável (parece natural)
  let mouthT = 0
  if (s.state === 'speaking') {
    mouthT = 0.2 + 0.8 * Math.abs(Math.sin(s.time * 7.8) * (0.55 + 0.45 * Math.sin(s.time * 2.3)))
  } else if (s.state === 'listening') {
    mouthT = 0.18
  }
  if (s.yawnT >= 0) mouthT = Math.sin(Math.min(s.yawnT / 1.2, 1) * Math.PI) * 1.7

  // ----- Alvos de pose por estado -----
  const restLX = L.cx - 13
  const restRX = L.cx + 13
  const restY = L.deskTop - 3
  let tTurn = 0
  let tLean = 0
  let tEye = 1
  let tTilt = 0
  let tDrop = 0
  let tShoulder = 0
  let hlX = restLX
  let hlY = restY
  let hrX = restRX
  let hrY = restY
  let tHalo = 0.28 + 0.07 * Math.sin((s.time * Math.PI * 2) / 4)

  if (s.state === 'listening') {
    tEye = 1.25
    tTilt = 2
    tLean = 2
    hrX = L.cx + 25
    hrY = L.shoulderY - 5 // mão levemente erguida: "estou ouvindo"
    tHalo = 0.4 + 0.1 * Math.sin(s.time * Math.PI)
  } else if (s.state === 'thinking') {
    tTurn = -0.6 // virado pro monitor esquerdo
    tEye = 0.55 // olhos semi-cerrados, concentração
    tLean = 3.2
    const bob = Math.sin(s.time * 25) * 1.1 // dedos digitando, mãos alternando
    hlX = L.cx - 12
    hlY = L.deskTop - 5 + bob
    hrX = L.cx + 8
    hrY = L.deskTop - 5 - bob
    tHalo = 0.5 + 0.1 * Math.sin(s.time * 5)
  } else if (s.state === 'speaking') {
    tEye = 1.05
    const side = Math.floor(s.time / 2) % 2 // alterna o braço a cada gesto de 2s
    const g = Math.max(0, Math.sin(s.time * Math.PI))
    if (side === 0) {
      hrX = L.cx + 24
      hrY = L.shoulderY + 4 - g * 14
    } else {
      hlX = L.cx - 24
      hlY = L.shoulderY + 4 - g * 14
    }
    tHalo = 0.42 + 0.13 * (0.4 + 0.6 * p.mouth)
  }

  // Micro-ações de idle sobrepõem a pose base
  if (s.idleAction) {
    const pr = clamp(s.idleActionT / IDLE_ACT_DUR[s.idleAction], 0, 1)
    if (s.idleAction === 'head-turn') tTilt = Math.sin(pr * Math.PI) * 3.5
    else if (s.idleAction === 'look-monitor') tTurn = -0.4
    else if (s.idleAction === 'sip' && pr < 0.8) {
      hrX = L.mug.x + 3
      hrY = L.mug.y + 2
      tTurn = 0.35
      tTilt = 2
    } else if (s.idleAction === 'stretch') tShoulder = -2.5 * Math.sin(pr * Math.PI)
    else if (s.idleAction === 'nod') tDrop = Math.max(0, Math.sin(pr * Math.PI * 2)) * 3
  }
  // Hover na caneca: gesto de "pegar"
  if (s.mugReachT > 0) {
    hrX = L.mug.x + 3
    hrY = L.mug.y + 2
    tTurn = 0.35
    tTilt = 2
  }

  // Sono / bocejo / sobressalto
  if (stage >= 2) {
    tDrop = 10
    tEye = 0
    tLean = 4
  }
  if (s.yawnT >= 0) {
    tEye = 0.12
    tShoulder = -2
  }
  if (s.startleT > 0) {
    tEye = 1.45
    tDrop = -2
  }

  // Reações ao click (prioridade máxima)
  if (s.reaction === 'wave') {
    hrX = L.cx + 30
    hrY = L.shoulderY - 22 + Math.sin(s.time * 14) * 2.5 // aceno
    tEye = 1.1
  } else if (s.reaction === 'stop') {
    hlX = L.cx - 16
    hlY = L.shoulderY + 2
    hrX = L.cx + 16
    hrY = L.shoulderY + 2 // mãos pra frente: "para!"
    tTilt = Math.sin(s.reactionT * 22) * 2.5 // balança a cabeça
  }

  // Eye tracking — olhos seguem o cursor dentro do canvas
  let tLook = 0
  let tLookY = 0
  if (s.mouseInside) {
    tLook = clamp(((s.mouseX - L.cx) / (L.w * 0.5)) * 3, -3, 3)
    tLookY = clamp(((s.mouseY - L.headCY) / L.h) * 4, -1.5, 1.5)
  } else if (s.state === 'thinking') {
    tLook = -2 // olhando pro monitor
  }
  if (s.idleAction === 'look-monitor') tLook = -2.5
  if (s.idleAction === 'sip' || s.mugReachT > 0) {
    tLook = 2.5
    tLookY = 1
  }
  if (s.hoverChar) tHalo += 0.15

  // Suavização exponencial (≈300-400ms de acomodação)
  const k = 1 - Math.exp(-dt * 8)
  const kh = 1 - Math.exp(-dt * 10)
  if (!p.init) {
    p.init = true
    p.hlx = hlX
    p.hly = hlY
    p.hrx = hrX
    p.hry = hrY
  }
  p.turn = approach(p.turn, tTurn, k)
  p.lean = approach(p.lean, tLean, k)
  p.eyeOpen = approach(p.eyeOpen, tEye, kh)
  p.headTilt = approach(p.headTilt, tTilt, k)
  p.headDrop = approach(p.headDrop, tDrop, k)
  p.shoulder = approach(p.shoulder, tShoulder, k)
  p.mouth = approach(p.mouth, mouthT, 1 - Math.exp(-dt * 18))
  p.look = approach(p.look, tLook, 1 - Math.exp(-dt * 12))
  p.lookY = approach(p.lookY, tLookY, 1 - Math.exp(-dt * 12))
  p.hlx = approach(p.hlx, hlX, kh)
  p.hly = approach(p.hly, hlY, kh)
  p.hrx = approach(p.hrx, hrX, kh)
  p.hry = approach(p.hry, hrY, kh)
  p.halo = approach(p.halo, tHalo, kh)

  // Vapor da caneca: some quando focado (listening/thinking) ou dormindo
  const steamTarget = (s.state === 'idle' || s.state === 'speaking') && stage < 2 ? 1 : 0
  s.steam = approach(s.steam, steamTarget, 1 - Math.exp(-dt * 2.5))

  // Bolha de status (fade in 300ms, dura 3s, fade out)
  if (s.bubble) {
    s.bubbleT += dt
    const D = 3
    if (s.bubbleT < 0.3) s.bubbleAlpha = s.bubbleT / 0.3
    else if (s.bubbleT > D - 0.3) s.bubbleAlpha = Math.max(0, (D - s.bubbleT) / 0.3)
    else s.bubbleAlpha = 1
    if (s.bubbleT >= D) s.bubble = null
  } else if (s.bubbleQueue.length > 0) {
    s.bubble = s.bubbleQueue.shift() ?? null
    s.bubbleT = 0
    s.bubbleAlpha = 0
  }

  // Conteúdo dos monitores
  const scrollSpeed = s.state === 'thinking' ? 60 : s.state === 'listening' ? 20 : s.state === 'speaking' ? 14 : 8
  s.monitorScroll += dt * scrollSpeed
  s.slideTimer += dt
  if (s.slideTimer >= 2) {
    s.slideTimer = 0
    s.slideIndex = (s.slideIndex + 1) % 4
  }

  // Partículas — quantidade e comportamento por estado
  const want = PARTICLE_TARGET[s.state]
  let ambientCount = 0
  for (const pt of s.particles) if (!pt.burst) ambientCount++
  if (ambientCount < Math.min(want, 15)) spawnAmbientParticle(s, L)

  for (let i = s.particles.length - 1; i >= 0; i--) {
    const pt = s.particles[i]
    pt.life -= dt
    if (pt.burst) {
      pt.x += pt.vx * dt
      pt.y += pt.vy * dt
      pt.vx *= Math.pow(0.25, dt)
      pt.vy *= Math.pow(0.25, dt)
      pt.alpha = (pt.life / pt.maxLife) * 0.8
      if (pt.life <= 0) s.particles.splice(i, 1)
      continue
    }
    const speed = (s.state === 'thinking' ? 2.6 : s.state === 'speaking' ? 1.4 : 1) * amb.psp
    pt.y += pt.vy * dt * speed
    pt.x += pt.vx * dt * (s.state === 'thinking' ? 1.6 : 0.4)
    if (pt.life <= 0 || pt.y < -4 || (!pt.burst && ambientCount > want)) {
      s.particles.splice(i, 1)
      ambientCount--
    }
  }

  // Símbolos flutuantes (⚙ ⚡ { } → durante thinking)
  if (s.state === 'thinking') {
    s.symbolTimer -= dt
    if (s.symbolTimer <= 0) {
      s.symbolTimer = 0.8 + Math.random() * 0.7
      s.symbols.push({
        x: L.cx - 14 + Math.random() * 28,
        y: L.headCY - L.headR - 6,
        char: pick(THINK_SYMBOLS),
        alpha: 0,
        rotation: -0.5 + Math.random(),
        vy: -13,
        life: 2,
        maxLife: 2,
        size: 8
      })
    }
  }
  for (let i = s.symbols.length - 1; i >= 0; i--) {
    const sym = s.symbols[i]
    sym.life -= dt
    sym.y += sym.vy * dt
    sym.rotation += dt * 1.5
    const t = 1 - sym.life / sym.maxLife
    sym.alpha = t < 0.2 ? t / 0.2 : Math.max(0, sym.life / (sym.maxLife * 0.6))
    if (sym.life <= 0) s.symbols.splice(i, 1)
  }

  // Balões de fala (· ○ subindo perto da boca em speaking)
  if (s.state === 'speaking' && p.mouth > 0.45) {
    s.dotTimer -= dt
    if (s.dotTimer <= 0) {
      s.dotTimer = 0.28
      s.dots.push({
        x: L.cx + 9 + Math.random() * 4,
        y: L.headCY + 7,
        r: 1 + (s.dots.length % 3) * 0.8,
        alpha: 0.7,
        vy: -14,
        life: 0.9
      })
    }
  }
  for (let i = s.dots.length - 1; i >= 0; i--) {
    const d = s.dots[i]
    d.life -= dt
    d.y += d.vy * dt
    d.x += dt * 6
    d.alpha = Math.max(0, d.life) * 0.8
    if (d.life <= 0) s.dots.splice(i, 1)
  }
}

// ---------------------------------------------------------------------------
// Desenho (Canvas 2D procedural)
// ---------------------------------------------------------------------------

interface DrawEnv {
  ctx: CanvasRenderingContext2D
  L: Layout
  s: OfficeState
  amb: Ambient
  C: (a: number) => string // cor do estado atual com alpha
  stage: number // estágio de sono
}

function drawBackground(d: DrawEnv): void {
  const { ctx, L, amb } = d
  const g = ctx.createLinearGradient(0, 0, 0, L.h)
  g.addColorStop(0, shade('#11233f', amb.wall))
  g.addColorStop(0.55, shade('#0a1628', amb.wall))
  g.addColorStop(1, shade('#060d1c', amb.wall))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, L.w, L.h)
  // Luz suave vindo de cima
  const lg = ctx.createRadialGradient(L.cx, -30, 10, L.cx, -30, L.h * 0.95)
  lg.addColorStop(0, 'rgba(120,200,255,0.10)')
  lg.addColorStop(1, 'rgba(120,200,255,0)')
  ctx.fillStyle = lg
  ctx.fillRect(0, 0, L.w, L.h)
  if (amb.warm > 0) {
    ctx.fillStyle = `rgba(255,170,90,${amb.warm})`
    ctx.fillRect(0, 0, L.w, L.h)
  }
  // Chão
  const fg = ctx.createLinearGradient(0, L.ledY, 0, L.h)
  fg.addColorStop(0, shade('#070d18', amb.wall))
  fg.addColorStop(1, shade('#04070f', amb.wall))
  ctx.fillStyle = fg
  ctx.fillRect(0, L.ledY, L.w, L.h - L.ledY)
}

function drawWallPanels(d: DrawEnv): void {
  const { ctx, L, s, C } = d
  const boost = s.panelBoost > 0 ? 0.5 : 0
  const bright = clamp((s.state === 'thinking' ? 1 : 0.45) + boost, 0, 1.2)
  const speed = s.state === 'thinking' ? 3 : 1

  // Painel A — linhas de "código" scrollando pra cima
  const a = L.panelA
  ctx.fillStyle = C(0.05 * bright)
  rr(ctx, a.x, a.y, a.w, a.h, 3)
  ctx.fill()
  ctx.strokeStyle = C(0.25 * bright)
  ctx.lineWidth = 0.8
  ctx.stroke()
  ctx.save()
  rr(ctx, a.x + 2, a.y + 2, a.w - 4, a.h - 4, 2)
  ctx.clip()
  const rows = Math.ceil(a.h / 5) + 1
  const span = rows * 5
  for (let i = 0; i < rows; i++) {
    const yy = a.y + a.h - ((i * 5 + s.monitorScroll * speed * 0.4) % span)
    const wdt = (0.3 + hash(i * 7) * 0.55) * (a.w - 10)
    ctx.fillStyle = C((0.18 + hash(i * 3) * 0.2) * bright)
    ctx.fillRect(a.x + 4 + hash(i * 11) * 6, yy, wdt, 1.4)
  }
  ctx.restore()

  // Painel B — waveform/barras pulsando
  const b = L.panelB
  ctx.fillStyle = C(0.05 * bright)
  rr(ctx, b.x, b.y, b.w, b.h, 3)
  ctx.fill()
  ctx.strokeStyle = C(0.25 * bright)
  ctx.stroke()
  const nb = 6
  for (let i = 0; i < nb; i++) {
    const hh = (0.25 + 0.75 * Math.abs(Math.sin(s.time * (1.5 + speed) + i * 0.9))) * (b.h - 8)
    ctx.fillStyle = C((0.3 + 0.15 * Math.sin(s.time * 3 + i)) * bright)
    ctx.fillRect(b.x + 4 + i * ((b.w - 8) / nb), b.y + b.h - 4 - hh, (b.w - 8) / nb - 1.5, hh)
  }
}

function drawClock(d: DrawEnv): void {
  const { ctx, L, s } = d
  const now = new Date()
  const txt = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  ctx.save()
  ctx.font = '600 9px Orbitron, ui-monospace, monospace'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const glow = 0.45 + s.clockGlow * 0.5
  ctx.shadowColor = 'rgba(56,225,255,0.8)'
  ctx.shadowBlur = 4 + s.clockGlow * 8
  ctx.fillStyle = `rgba(125,240,255,${glow})`
  ctx.fillText(txt, L.clock.x + L.clock.w - 4, L.clock.y + L.clock.h / 2)
  ctx.restore()
}

/** Planta holográfica — triângulos de linha girando devagar no canto esquerdo. */
function drawHoloPlant(d: DrawEnv): void {
  const { ctx, L, s, C } = d
  const baseX = L.w * 0.085
  const baseY = L.mon1.y - 5
  const sx = 0.4 + 0.6 * Math.abs(Math.cos(s.time * 0.5)) // "rotação" em torno do eixo Y
  ctx.save()
  ctx.translate(baseX, baseY)
  ctx.scale(sx, 1)
  ctx.strokeStyle = C(0.35 + 0.1 * Math.sin(s.time * 2))
  ctx.lineWidth = 0.9
  ctx.shadowColor = C(0.5)
  ctx.shadowBlur = 4
  for (let i = 0; i < 3; i++) {
    const ww = 7 - i * 1.8
    const yy = -i * 5.5
    ctx.beginPath()
    ctx.moveTo(-ww, yy)
    ctx.lineTo(0, yy - 7)
    ctx.lineTo(ww, yy)
    ctx.closePath()
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(-3, 2)
  ctx.lineTo(3, 2)
  ctx.stroke()
  ctx.restore()
}

function drawChair(d: DrawEnv): void {
  const { ctx, L } = d
  const top = L.headCY - L.headR * 1.9
  ctx.fillStyle = 'rgba(7,17,32,0.88)'
  ctx.strokeStyle = 'rgba(86,200,255,0.1)'
  ctx.lineWidth = 1
  rr(ctx, L.cx - 24, top, 48, L.deskTop - top, 9)
  ctx.fill()
  ctx.stroke()
  // Encosto alto estilo gaming — "asas" laterais
  rr(ctx, L.cx - 28, top + 8, 8, 26, 3)
  ctx.fill()
  rr(ctx, L.cx + 20, top + 8, 8, 26, 3)
  ctx.fill()
}

function drawHalo(d: DrawEnv, hx: number, hy: number): void {
  const { ctx, L, s, C } = d
  const p = s.pose
  const r = L.headR * 2.1
  const g = ctx.createRadialGradient(hx, hy, 1, hx, hy, r)
  g.addColorStop(0, C(p.halo * 0.5))
  g.addColorStop(0.55, C(p.halo * 0.18))
  g.addColorStop(1, C(0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(hx, hy, r, 0, Math.PI * 2)
  ctx.fill()
  // Anel do halo — em thinking, gira (tracejado com offset animado)
  ctx.save()
  ctx.strokeStyle = C(p.halo * 0.55)
  ctx.lineWidth = 1
  if (s.state === 'thinking') {
    ctx.setLineDash([5, 7])
    ctx.lineDashOffset = -s.time * 16
  }
  ctx.beginPath()
  ctx.arc(hx, hy, L.headR * 1.55, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** Um braço: curva do ombro até a mão, com brilho sutil por baixo. */
function drawArm(d: DrawEnv, sx: number, sy: number, hx: number, hy: number, elbowOut: number): void {
  const { ctx, C } = d
  const mx = (sx + hx) / 2 + elbowOut
  const my = (sy + hy) / 2 + 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.quadraticCurveTo(mx, my, hx, hy)
  ctx.strokeStyle = C(0.14)
  ctx.lineWidth = 8
  ctx.stroke()
  ctx.strokeStyle = '#0d1b33'
  ctx.lineWidth = 6.2
  ctx.stroke()
  // Mão
  ctx.beginPath()
  ctx.arc(hx, hy, 3.4, 0, Math.PI * 2)
  ctx.fillStyle = '#0f1f3a'
  ctx.fill()
  ctx.strokeStyle = C(0.4)
  ctx.lineWidth = 0.9
  ctx.stroke()
}

function drawCharacterBody(d: DrawEnv, hx: number, hy: number): void {
  const { ctx, L, s, C } = d
  const p = s.pose
  const tx = L.cx + p.turn * 3
  const sy = L.shoulderY + s.breathOff * 0.6 + p.shoulder + p.lean * 0.3
  const sw = 24 // meia largura dos ombros

  // Braços (atrás do torso)
  drawArm(d, tx - sw + 5, sy + 4, p.hlx, p.hly, -9)
  drawArm(d, tx + sw - 5, sy + 4, p.hrx, p.hry, 9)

  // Pescoço
  ctx.fillStyle = '#0c1a31'
  ctx.fillRect(hx - 3.5, hy + L.headR * 0.7, 7, L.headR * 0.85)

  // Torso — jaqueta tech com ombros arredondados
  const grad = ctx.createLinearGradient(tx, sy - 12, tx, L.deskTop)
  grad.addColorStop(0, '#11233f')
  grad.addColorStop(1, '#0a1426')
  ctx.beginPath()
  ctx.moveTo(tx - sw, L.deskTop + 2)
  ctx.lineTo(tx - sw + 1, sy + 5)
  ctx.quadraticCurveTo(tx - sw + 1, sy - 9, tx - 9, sy - 9)
  ctx.lineTo(tx + 9, sy - 9)
  ctx.quadraticCurveTo(tx + sw - 1, sy - 9, tx + sw - 1, sy + 5)
  ctx.lineTo(tx + sw, L.deskTop + 2)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()
  ctx.strokeStyle = C(0.45)
  ctx.lineWidth = 1
  ctx.shadowColor = C(0.5)
  ctx.shadowBlur = 6
  ctx.stroke()
  ctx.shadowBlur = 0

  // Gola
  ctx.strokeStyle = C(0.3)
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.moveTo(tx - 8, sy - 8)
  ctx.lineTo(tx - 4, sy - 2)
  ctx.moveTo(tx + 8, sy - 8)
  ctx.lineTo(tx + 4, sy - 2)
  ctx.stroke()

  // Linhas de circuito no torso — pulsam com o estado
  const pulseSpeed = s.state === 'thinking' ? 7 : s.state === 'speaking' ? 4.5 : 2
  const ca = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(s.time * pulseSpeed))
  ctx.strokeStyle = C(ca)
  ctx.lineWidth = 0.8
  ctx.shadowColor = C(ca)
  ctx.shadowBlur = 3
  ctx.beginPath()
  ctx.moveTo(tx - 6, sy - 4)
  ctx.lineTo(tx - 6, sy + 9)
  ctx.lineTo(tx - 12, sy + 15)
  ctx.moveTo(tx + 4, sy - 2)
  ctx.lineTo(tx + 4, sy + 12)
  ctx.moveTo(tx + 4, sy + 5)
  ctx.lineTo(tx + 11, sy + 5)
  ctx.stroke()
  ctx.shadowBlur = 0
  for (const [nx, ny] of [
    [tx - 12, sy + 15],
    [tx + 4, sy + 12],
    [tx + 11, sy + 5]
  ]) {
    ctx.beginPath()
    ctx.arc(nx, ny, 1, 0, Math.PI * 2)
    ctx.fillStyle = C(ca + 0.15)
    ctx.fill()
  }
}

function drawCharacterHead(d: DrawEnv, hx: number, hy: number): void {
  const { ctx, L, s, C } = d
  const p = s.pose
  const r = L.headR

  // Crânio com queixo sutil
  const grad = ctx.createLinearGradient(hx, hy - r, hx, hy + r)
  grad.addColorStop(0, '#13284a')
  grad.addColorStop(1, '#0a1426')
  ctx.beginPath()
  ctx.moveTo(hx - r * 0.85, hy - r * 0.1)
  ctx.bezierCurveTo(hx - r * 0.95, hy - r * 1.25, hx + r * 0.95, hy - r * 1.25, hx + r * 0.85, hy - r * 0.1)
  ctx.bezierCurveTo(hx + r * 0.78, hy + r * 0.6, hx + r * 0.4, hy + r * 0.95, hx, hy + r * 0.95)
  ctx.bezierCurveTo(hx - r * 0.4, hy + r * 0.95, hx - r * 0.78, hy + r * 0.6, hx - r * 0.85, hy - r * 0.1)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()
  ctx.strokeStyle = C(0.7)
  ctx.lineWidth = 1.1
  ctx.shadowColor = C(0.6)
  ctx.shadowBlur = 7
  ctx.stroke()
  ctx.shadowBlur = 0

  // Olhos — LEDs horizontais (estilo visor); felizes = arcos sorridentes
  const blinkFactor = s.blinkT > 0 ? 0.12 : 1
  const eo = Math.max(0.05, p.eyeOpen * blinkFactor)
  const eyeY = hy - 1 + p.lookY - Math.max(0, p.eyeOpen - 1) * 1.2
  const ex = p.look
  ctx.lineCap = 'round'
  ctx.shadowColor = C(0.9)
  ctx.shadowBlur = 6
  ctx.strokeStyle = C(0.95)
  if (s.happyT > 0) {
    ctx.lineWidth = 1.6
    for (const sgn of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(hx + sgn * 5 + ex, eyeY + 1.5, 2.8, Math.PI * 1.15, Math.PI * 1.85)
      ctx.stroke()
    }
  } else {
    const ew = 4.4 + Math.max(0, p.eyeOpen - 1) * 2
    ctx.lineWidth = Math.max(0.8, 2.3 * Math.min(eo, 1.1))
    for (const sgn of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(hx + sgn * 5 + ex - ew / 2, eyeY)
      ctx.lineTo(hx + sgn * 5 + ex + ew / 2, eyeY)
      ctx.stroke()
    }
  }
  ctx.shadowBlur = 0

  // Boca — linha em repouso; elipse pulsando quando fala/boceja
  const my = hy + r * 0.5
  const mo = p.mouth
  if (mo > 0.14) {
    ctx.beginPath()
    ctx.ellipse(hx + ex * 0.3, my, 2.4 + mo * 1.6, 0.8 + mo * 2.6, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(4,9,18,0.9)'
    ctx.fill()
    ctx.strokeStyle = C(0.7)
    ctx.lineWidth = 0.9
    ctx.stroke()
  } else {
    const ml = s.state === 'listening' ? 7 : s.state === 'thinking' ? 4 : 5.5
    ctx.strokeStyle = C(0.55)
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.moveTo(hx + ex * 0.3 - ml / 2, my)
    ctx.lineTo(hx + ex * 0.3 + ml / 2, my)
    ctx.stroke()
  }

  // Ondas sonoras perto da "orelha" em listening (tipo sinal WiFi)
  if (s.state === 'listening') {
    for (let i = 0; i < 3; i++) {
      const ph = (s.time * 1.4 + i / 3) % 1
      ctx.strokeStyle = C((1 - ph) * 0.55)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(hx + r + 2, hy - 2, 3 + ph * 8, -0.6, 0.6)
      ctx.stroke()
    }
  }
}

function drawCharacter(d: DrawEnv): void {
  const { L, s } = d
  const p = s.pose
  const hx = L.cx + p.turn * 5 + p.headTilt
  const hy = L.headCY + s.breathOff + p.headDrop + p.lean * 0.35
  drawHalo(d, hx, hy)
  drawCharacterBody(d, hx, hy)
  drawCharacterHead(d, hx, hy)
}

function drawDesk(d: DrawEnv): void {
  const { ctx, L, C } = d
  // Tampo (trapézio sutil — leve profundidade)
  ctx.beginPath()
  ctx.moveTo(L.w * 0.05, L.deskTop)
  ctx.lineTo(L.w * 0.95, L.deskTop)
  ctx.lineTo(L.w * 0.975, L.deskFront)
  ctx.lineTo(L.w * 0.025, L.deskFront)
  ctx.closePath()
  ctx.fillStyle = '#13233f'
  ctx.fill()
  // Borda brilhante do tampo
  ctx.strokeStyle = C(0.4)
  ctx.lineWidth = 1
  ctx.shadowColor = C(0.45)
  ctx.shadowBlur = 5
  ctx.beginPath()
  ctx.moveTo(L.w * 0.05, L.deskTop)
  ctx.lineTo(L.w * 0.95, L.deskTop)
  ctx.stroke()
  ctx.shadowBlur = 0
  // Painel frontal
  ctx.fillStyle = '#0f1d35'
  ctx.fillRect(L.w * 0.025, L.deskFront, L.w * 0.95, L.deskBottom - L.deskFront)
  ctx.strokeStyle = C(0.12)
  ctx.lineWidth = 0.8
  ctx.strokeRect(L.w * 0.025, L.deskFront, L.w * 0.95, L.deskBottom - L.deskFront)
  // Teclado
  rr(ctx, L.cx - 17, L.deskTop + 2, 34, 4.5, 2)
  ctx.fillStyle = '#0a1426'
  ctx.fill()
  ctx.strokeStyle = C(0.2)
  ctx.stroke()
}

/** Conteúdo da tela do monitor principal conforme o estado (ou screensaver). */
function drawMonitorContent(d: DrawEnv, ix: number, iy: number, iw: number, ih: number): void {
  const { ctx, s, C, stage } = d
  if (stage >= 4) {
    // Screensaver — bolinha quicando
    const tri = (t: number): number => Math.abs((t % 2) - 1)
    const bx = ix + 3 + tri(s.time * 0.55) * (iw - 6)
    const by = iy + 3 + tri(s.time * 0.83) * (ih - 6)
    ctx.beginPath()
    ctx.arc(bx, by, 1.8, 0, Math.PI * 2)
    ctx.fillStyle = C(0.85)
    ctx.shadowColor = C(0.9)
    ctx.shadowBlur = 5
    ctx.fill()
    ctx.shadowBlur = 0
    return
  }
  if (s.state === 'listening') {
    // Waveform ao vivo
    const nb = Math.floor(iw / 4)
    for (let i = 0; i < nb; i++) {
      const hh = (0.15 + 0.85 * Math.abs(Math.sin(s.time * 5 + i * 0.9) * Math.sin(s.time * 2.7 + i * 0.37))) * ih * 0.8
      ctx.fillStyle = C(0.5 + 0.2 * Math.sin(s.time * 6 + i))
      ctx.fillRect(ix + 1 + i * 4, iy + (ih - hh) / 2, 2.4, hh)
    }
    return
  }
  if (s.state === 'thinking') {
    // Chuva de dados estilo matrix
    const nc = Math.floor(iw / 5)
    for (let c = 0; c < nc; c++) {
      const speed = 20 + hash(c * 13) * 45
      const head = ((s.time * speed + hash(c) * 50) % (ih + 22)) - 11
      for (let k = 0; k < 5; k++) {
        const yy = head - k * 4
        if (yy < 0 || yy > ih - 3) continue
        ctx.fillStyle = C((0.75 - k * 0.15) * (0.6 + hash(c * 3 + k) * 0.4))
        ctx.fillRect(ix + 2 + c * 5, iy + yy, 2, 2.6)
      }
    }
    return
  }
  if (s.state === 'speaking') {
    // Slides/apresentação alternando
    const palette = [0.7, 0.45, 0.55, 0.35]
    const base = palette[s.slideIndex]
    ctx.fillStyle = C(base)
    ctx.fillRect(ix + 3, iy + 3, iw * 0.55, 3)
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = C(0.25 + 0.12 * ((s.slideIndex + i) % 3))
      ctx.fillRect(ix + 3, iy + 9 + i * 5, iw - 8 - hash(s.slideIndex * 5 + i) * iw * 0.3, 2.4)
    }
    return
  }
  // idle — código scrollando devagar
  const rows = Math.ceil(ih / 5) + 1
  const span = rows * 5
  for (let i = 0; i < rows; i++) {
    const yy = iy + ih - ((i * 5 + s.monitorScroll * 0.6) % span)
    if (yy < iy || yy > iy + ih - 2) continue
    ctx.fillStyle = C(0.22 + hash(i * 5) * 0.3)
    ctx.fillRect(ix + 2 + hash(i * 9) * 7, yy, (0.25 + hash(i * 7) * 0.55) * (iw - 12), 1.6)
  }
}

function drawMonitors(d: DrawEnv): void {
  const { ctx, L, s, C } = d
  const flicker = 0.9 + 0.1 * Math.sin(s.time * 9)

  // Monitor principal (esquerda)
  const m = L.mon1
  rr(ctx, m.x, m.y, m.w, m.h, 3)
  ctx.fillStyle = '#0a1426'
  ctx.fill()
  ctx.strokeStyle = C(0.45 * flicker)
  ctx.lineWidth = 1
  ctx.shadowColor = C(0.5)
  ctx.shadowBlur = 7
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.save()
  rr(ctx, m.x + 2.5, m.y + 2.5, m.w - 5, m.h - 5, 2)
  ctx.clip()
  ctx.fillStyle = 'rgba(5,12,24,0.9)'
  ctx.fillRect(m.x, m.y, m.w, m.h)
  drawMonitorContent(d, m.x + 2.5, m.y + 2.5, m.w - 5, m.h - 5)
  ctx.restore()
  // Pé do monitor
  ctx.fillStyle = '#0c1830'
  ctx.fillRect(m.x + m.w / 2 - 2, m.y + m.h, 4, L.deskTop - (m.y + m.h))

  // Monitor secundário (direita) — métricas/barras
  const n = L.mon2
  rr(ctx, n.x, n.y, n.w, n.h, 2.5)
  ctx.fillStyle = '#0a1426'
  ctx.fill()
  ctx.strokeStyle = C(0.35 * flicker)
  ctx.lineWidth = 0.9
  ctx.stroke()
  ctx.save()
  rr(ctx, n.x + 2, n.y + 2, n.w - 4, n.h - 4, 2)
  ctx.clip()
  if (s.state === 'thinking') {
    // Barras de progresso correndo
    for (let i = 0; i < 3; i++) {
      const prog = (s.time * 0.5 + i * 0.33) % 1
      ctx.fillStyle = C(0.18)
      ctx.fillRect(n.x + 3, n.y + 3 + i * 4.5, n.w - 8, 2.2)
      ctx.fillStyle = C(0.6)
      ctx.fillRect(n.x + 3, n.y + 3 + i * 4.5, (n.w - 8) * prog, 2.2)
    }
  } else {
    const nb = 5
    for (let i = 0; i < nb; i++) {
      const hh = (0.3 + 0.7 * Math.abs(Math.sin(s.time * 1.2 + i * 1.3))) * (n.h - 7)
      ctx.fillStyle = C(0.35 + 0.12 * Math.sin(s.time * 2 + i))
      ctx.fillRect(n.x + 3 + i * ((n.w - 6) / nb), n.y + n.h - 3 - hh, (n.w - 6) / nb - 1.5, hh)
    }
  }
  ctx.restore()
  ctx.fillStyle = '#0c1830'
  ctx.fillRect(n.x + n.w / 2 - 1.5, n.y + n.h, 3, L.deskTop - (n.y + n.h))
}

function drawMug(d: DrawEnv): void {
  const { ctx, L, s, C } = d
  const m = L.mug
  // Corpo da caneca
  rr(ctx, m.x, m.y + 2, m.w * 0.78, m.h - 2, 1.5)
  ctx.fillStyle = '#0e1c34'
  ctx.fill()
  ctx.strokeStyle = C(0.3)
  ctx.lineWidth = 0.8
  ctx.stroke()
  // Alça
  ctx.beginPath()
  ctx.arc(m.x + m.w * 0.78, m.y + m.h * 0.5 + 1, m.w * 0.22, -Math.PI / 2, Math.PI / 2)
  ctx.stroke()
  // Vapor — some quando o Ares está focado
  if (s.steam > 0.03) {
    ctx.strokeStyle = C(0.3 * s.steam)
    ctx.lineWidth = 0.8
    for (let i = 0; i < 3; i++) {
      const ph = (s.time * 0.5 + i / 3) % 1
      const sx = m.x + 2 + i * 2.2
      const sy = m.y + 1 - ph * 8
      ctx.globalAlpha = (1 - ph) * s.steam
      ctx.beginPath()
      ctx.moveTo(sx, sy + 4)
      ctx.quadraticCurveTo(sx + Math.sin(s.time * 2 + i * 2) * 1.6, sy + 2, sx, sy)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
}

function drawLedStrip(d: DrawEnv): void {
  const { ctx, L, s, C, amb } = d
  const speed = s.state === 'thinking' ? 5 : s.state === 'listening' ? 3.4 : s.state === 'speaking' ? 0 : 1.5
  let pulse = 0.5 + 0.5 * Math.sin(s.time * speed)
  if (s.state === 'speaking') pulse = 0.35 + 0.65 * s.pose.mouth // sincronizado com a boca
  const a = (0.35 + 0.45 * pulse) * amb.led
  ctx.save()
  ctx.shadowColor = C(Math.min(1, a))
  ctx.shadowBlur = 12
  ctx.fillStyle = C(Math.min(1, a))
  rr(ctx, L.w * 0.04, L.ledY, L.w * 0.92, 2.4, 1.2)
  ctx.fill()
  ctx.restore()
}

function drawParticles(d: DrawEnv): void {
  const { ctx, s, C } = d
  for (const pt of s.particles) {
    // Em listening, as partículas "vibram" no lugar
    const jx = s.state === 'listening' && !pt.burst ? Math.sin(s.time * 30 + pt.seed) * 1.1 : 0
    let a = pt.alpha
    if (s.state === 'speaking' && !pt.burst) a *= 0.6 + 0.4 * s.pose.mouth // pulsa no ritmo da fala
    ctx.beginPath()
    ctx.arc(pt.x + jx, pt.y, pt.size, 0, Math.PI * 2)
    ctx.fillStyle = C(Math.max(0, a))
    ctx.fill()
  }
}

function drawFloatingSymbols(d: DrawEnv): void {
  const { ctx, s, C } = d
  for (const sym of s.symbols) {
    ctx.save()
    ctx.translate(sym.x, sym.y)
    ctx.rotate(sym.char === 'Z' ? sym.rotation * 0.3 : sym.rotation)
    ctx.font = `600 ${sym.size}px ${sym.char === 'Z' ? 'Orbitron,' : ''} system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = C(0.7)
    ctx.shadowBlur = 4
    ctx.fillStyle = C(Math.max(0, Math.min(1, sym.alpha)) * 0.85)
    ctx.fillText(sym.char, 0, 0)
    ctx.restore()
  }
}

function drawSpeechBubbles(d: DrawEnv): void {
  const { ctx, s, C } = d
  for (const dot of s.dots) {
    ctx.beginPath()
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2)
    ctx.strokeStyle = C(dot.alpha)
    ctx.lineWidth = 0.8
    if (dot.r > 2) ctx.stroke()
    else {
      ctx.fillStyle = C(dot.alpha)
      ctx.fill()
    }
  }
}

/** Onda de energia do double-click — anel que expande e some. */
function drawWaveReaction(d: DrawEnv): void {
  const { ctx, L, s, C } = d
  if (s.waveT < 0) return
  const t = clamp(s.waveT / 0.8, 0, 1)
  const ease = 1 - Math.pow(1 - t, 3)
  ctx.beginPath()
  ctx.arc(L.cx, L.shoulderY, 10 + ease * L.w * 0.45, 0, Math.PI * 2)
  ctx.strokeStyle = C((1 - t) * 0.6)
  ctx.lineWidth = 2
  ctx.shadowColor = C(0.6)
  ctx.shadowBlur = 8
  ctx.stroke()
  ctx.shadowBlur = 0
}

function drawStatusBubble(d: DrawEnv): void {
  const { ctx, L, s, C } = d
  if (!s.bubble || s.bubbleAlpha <= 0.01) return
  const a = s.bubbleAlpha
  ctx.save()
  ctx.font = '600 10px Rajdhani, system-ui'
  const tw = ctx.measureText(s.bubble).width
  const bw = tw + 16
  const bx = (L.w - bw) / 2
  const by = 4
  rr(ctx, bx, by, bw, 17, 8.5)
  ctx.fillStyle = `rgba(4,10,22,${0.92 * a})`
  ctx.fill()
  ctx.strokeStyle = C(0.45 * a)
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = `rgba(214,243,255,${a})`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(s.bubble, L.w / 2, by + 8.5)
  ctx.restore()
}

function drawOffice(ctx: CanvasRenderingContext2D, L: Layout, s: OfficeState): void {
  const amb = ambientForHour(new Date().getHours())
  const C = (a: number): string => rgba(s.color, a)
  const d: DrawEnv = { ctx, L, s, amb, C, stage: sleepStage(s.idleFor) }

  ctx.clearRect(0, 0, L.w, L.h)
  drawBackground(d)
  drawWallPanels(d)
  drawClock(d)
  drawHoloPlant(d)
  drawLedStrip(d)
  drawChair(d)
  drawCharacter(d)
  drawDesk(d)
  drawMonitors(d)
  drawMug(d)
  drawParticles(d)
  drawFloatingSymbols(d)
  drawSpeechBubbles(d)
  drawWaveReaction(d)
  drawStatusBubble(d)
}

// ---------------------------------------------------------------------------
// Componente React
// ---------------------------------------------------------------------------

const FRAME_MS = 1000 / 22 // ~22fps — suficiente para animação de personagem

export default function AresOffice({ state, userName, metrics }: AresOfficeProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const officeRef = useRef<OfficeState>(makeOfficeState(state))
  const sizeRef = useRef({ w: 0, h: 0 })
  const visibleRef = useRef(true)
  const metricsRef = useRef<SystemMetrics | undefined>(metrics)
  const userNameRef = useRef<string | undefined>(userName)
  const lastRegionRef = useRef<Region>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    metricsRef.current = metrics
  }, [metrics])
  useEffect(() => {
    userNameRef.current = userName
  }, [userName])

  // Reage à troca de estado do assistente
  useEffect(() => {
    const s = officeRef.current
    if (s.state === state) return
    wake(s)
    s.state = state
    s.stateTime = 0
    if (state === 'listening') showBubble(s, 'Ouvindo...')
    else if (state === 'thinking') showBubble(s, 'Processando...')
    else if (state === 'speaking') s.bubble = null
  }, [state])

  // Setup do canvas: resize, visibilidade, eventos e loop de animação
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const s = officeRef.current

    // Saudação inicial (espera a config carregar para ter o nome)
    const greetTimer = window.setTimeout(() => {
      const name = userNameRef.current?.trim()
      s.bubbleQueue.push(greetingForHour(new Date().getHours()))
      s.bubbleQueue.push(name ? `Pronto, ${name}.` : 'Pronto.')
    }, 1200)

    // Canvas nítido em HiDPI + responsivo ao container.
    // Sem espaço suficiente na sidebar (janela baixa), esconde o escritório.
    const MIN_H = 64
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      sizeRef.current = { w: rect.width, h: rect.height }
      wrap.style.visibility = rect.height < MIN_H ? 'hidden' : 'visible'
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    // Pausa o loop quando fora de vista (modo simples, janela minimizada etc.)
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry) visibleRef.current = entry.isIntersecting
    })
    io.observe(canvas)

    const layoutNow = (): Layout => computeLayout(sizeRef.current.w, sizeRef.current.h)

    const onMove = (e: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      s.mouseX = x
      s.mouseY = y
      s.mouseInside = true
      wake(s)
      const L = layoutNow()
      const region = hitRegion(x, y, L)
      if (region === lastRegionRef.current) return
      lastRegionRef.current = region
      canvas.style.cursor = region === 'character' ? 'pointer' : 'default'
      s.hoverChar = region === 'character'
      s.hoverClock = region === 'clock'
      if (region === 'character' && s.time - s.lastHoverBubbleAt > 8) {
        s.lastHoverBubbleAt = s.time
        showBubble(s, pick(['Sim?', 'Olá!']))
      }
      if (region === 'mug' && s.mugReachT <= 0) s.mugReachT = 0.001
      if (region === 'monitor') setTooltipPos({ x: L.mon1.x, y: Math.max(2, L.mon1.y - 24) })
      else if (region === 'monitor2') setTooltipPos({ x: L.mon2.x - 30, y: Math.max(2, L.mon2.y - 24) })
      else setTooltipPos(null)
    }

    const onLeave = (): void => {
      s.mouseInside = false
      s.hoverChar = false
      s.hoverClock = false
      lastRegionRef.current = null
      canvas.style.cursor = 'default'
      setTooltipPos(null)
    }

    const onClick = (e: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect()
      const L = layoutNow()
      const region = hitRegion(e.clientX - rect.left, e.clientY - rect.top, L)
      wake(s)
      if (region !== 'character') return
      const now = performance.now()
      if (now - s.lastClickAt < 2000) s.clickCount++
      else s.clickCount = 1
      s.lastClickAt = now
      if (s.clickCount >= 3) {
        // Clicks rápidos demais: gesto de "para!"
        s.reaction = 'stop'
        s.reactionT = 0
      } else {
        s.reaction = 'wave'
        s.reactionT = 0
        s.happyT = 0.5
        spawnBurst(s, L, 8, 30)
        showBubble(s, pick(['Às ordens.', 'Diga.']))
      }
    }

    const onDblClick = (e: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect()
      const L = layoutNow()
      const region = hitRegion(e.clientX - rect.left, e.clientY - rect.top, L)
      if (region !== 'character') return
      s.waveT = 0
      s.panelBoost = 1.5
      spawnBurst(s, L, 14, 60)
    }

    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('dblclick', onDblClick)

    // Loop com limite de fps (delta-time check)
    let raf = 0
    let last = performance.now()
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      const elapsed = now - last
      if (elapsed < FRAME_MS) return
      last = now - (elapsed % FRAME_MS)
      if (!visibleRef.current) return
      const { w, h } = sizeRef.current
      if (w < 10 || h < MIN_H) return
      const dt = Math.min(elapsed / 1000, 0.1)
      const L = computeLayout(w, h)
      updateOffice(s, dt, L, ambientForHour(new Date().getHours()))
      drawOffice(ctx, L, s)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(greetTimer)
      ro.disconnect()
      io.disconnect()
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('dblclick', onDblClick)
    }
  }, [])

  const m = metrics
  const tooltipText = m ? `CPU: ${Math.round(m.cpuPercent)}% · RAM: ${Math.round(m.memPercent)}%` : 'CPU: — · RAM: —'

  return (
    <div ref={wrapRef} className="ares-office-wrapper">
      <canvas ref={canvasRef} className="ares-office-canvas" role="img" aria-label="Escritório do Ares" />
      {tooltipPos && (
        <div className="ares-office-tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
          {tooltipText}
        </div>
      )}
    </div>
  )
}
