import { EventEmitter } from 'events'
import type { DemoSlide, DemoState } from '../shared/types'
import { demoExporter } from './demoExporter'

class DemoManager extends EventEmitter {
  private state: DemoState = {
    isActive: false,
    isPaused: false
  }

  public getState(): DemoState {
    return { ...this.state }
  }

  public start(): void {
    this.state.isActive = true
    this.state.isPaused = false
    this.state.currentSlide = undefined
    this.emit('state-changed', this.getState())
    demoExporter.startRecording()
  }

  public stop(): void {
    this.state.isActive = false
    this.state.isPaused = false
    this.state.currentSlide = undefined
    this.emit('state-changed', this.getState())
    demoExporter.stopRecording()
  }

  public pause(): void {
    if (!this.state.isActive) return
    this.state.isPaused = true
    this.emit('state-changed', this.getState())
  }

  public resume(): void {
    if (!this.state.isActive) return
    this.state.isPaused = false
    this.emit('state-changed', this.getState())
  }

  public queueSlide(slide: DemoSlide): void {
    if (!this.state.isActive) this.start()
    this.showSlide(slide)
  }

  private showSlide(slide: DemoSlide): void {
    this.state.currentSlide = slide
    this.emit('slide', slide)
    this.emit('state-changed', this.getState())
    demoExporter.captureSlide(slide)
  }
}

export const demoManager = new DemoManager()
