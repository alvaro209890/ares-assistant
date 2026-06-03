import type { AresApi } from '../preload'

// Disponibiliza window.ares com tipagem no renderer.
declare global {
  interface Window {
    ares: AresApi
  }
}

export {}
