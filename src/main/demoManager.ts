import { EventEmitter } from 'events'
import type { DemoSlide, DemoState } from '../shared/types'
import { demoExporter } from './demoExporter'

// Tempo que cada slide fica na tela antes de avançar para o próximo.
// Espaçamento generoso (> debounce de 600 ms do exportador) garante que CADA
// slide seja capturado individualmente para a exportação.
const SLIDE_DURATION_MS = 7000

class DemoManager extends EventEmitter {
  private state: DemoState = {
    isActive: false,
    isPaused: false
  }
  // Fila de slides ainda não exibidos. queueSlides empilha aqui e o timer avança.
  private pending: DemoSlide[] = []
  private advanceTimer: ReturnType<typeof setTimeout> | null = null

  public getState(): DemoState {
    return { ...this.state }
  }

  public start(): void {
    this.state.isActive = true
    this.state.isPaused = false
    this.state.currentSlide = undefined
    this.pending = []
    this.clearTimer()
    this.emit('state-changed', this.getState())
    demoExporter.startRecording()
  }

  public stop(): void {
    this.state.isActive = false
    this.state.isPaused = false
    this.state.currentSlide = undefined
    this.pending = []
    this.clearTimer()
    this.emit('state-changed', this.getState())
    demoExporter.stopRecording()
  }

  public pause(): void {
    if (!this.state.isActive) return
    this.state.isPaused = true
    this.clearTimer()
    this.emit('state-changed', this.getState())
  }

  public resume(): void {
    if (!this.state.isActive) return
    this.state.isPaused = false
    this.emit('state-changed', this.getState())
    this.scheduleAdvance()
  }

  /** Enfileira UM slide (compat). Prefira queueSlides para uma apresentação. */
  public queueSlide(slide: DemoSlide): void {
    this.queueSlides([slide])
  }

  /**
   * Enfileira VÁRIOS slides de uma vez (uma apresentação). Exibe o primeiro na
   * hora e avança os demais por timer, dando tempo da narração acompanhar e de
   * o exportador capturar cada um.
   */
  public queueSlides(slides: DemoSlide[]): void {
    const valid = slides.filter((s) => s && s.title)
    if (!valid.length) return
    if (!this.state.isActive) this.start()
    this.pending.push(...valid)
    // Sem slide na tela ainda -> mostra o primeiro imediatamente.
    if (!this.state.currentSlide) this.advance()
    else this.scheduleAdvance()
  }

  private advance(): void {
    this.clearTimer()
    const next = this.pending.shift()
    if (!next) return
    this.showSlide(next)
    if (this.pending.length) this.scheduleAdvance()
  }

  private scheduleAdvance(): void {
    if (this.advanceTimer || this.state.isPaused || !this.pending.length) return
    this.advanceTimer = setTimeout(() => {
      this.advanceTimer = null
      if (!this.state.isPaused) this.advance()
    }, SLIDE_DURATION_MS)
  }

  private clearTimer(): void {
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer)
      this.advanceTimer = null
    }
  }

  private showSlide(slide: DemoSlide): void {
    this.state.currentSlide = slide
    this.emit('slide', slide)
    this.emit('state-changed', this.getState())
    demoExporter.captureSlide(slide)
  }
}

export const demoManager = new DemoManager()
