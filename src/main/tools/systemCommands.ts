// Controle de sistema: status, área de transferência, abrir app, volume, mídia,
// brilho, bloqueio e screenshot. Tudo curto — sem reportProgress.

import { getSystemMetrics, readClipboard, writeClipboard } from '../system'
import { runBrightness, runLock, runMedia, runOpen, runScreenshot, runVolume } from '../control'
import { toolErr, toolOk } from '../agent/types'
import { normBrightnessAction, normMediaAction, normVolumeAction } from './util'
import type { ToolCommand } from './types'

export const systemCommands: ToolCommand[] = [
  {
    tipo: 'sistema.status',
    category: 'system',
    run: (a) => toolOk(a.tipo, getSystemMetrics())
  },
  {
    tipo: 'area.ler',
    category: 'system',
    run(a) {
      const c = readClipboard()
      return c.vazio ? toolErr(a.tipo, 'A área de transferência está vazia.') : toolOk(a.tipo, c)
    }
  },
  {
    tipo: 'area.escrever',
    category: 'system',
    run: (a) => toolOk(a.tipo, writeClipboard(String(a.texto || a.text || a.conteudo || a.content || '')))
  },
  {
    tipo: 'sistema.abrir',
    category: 'system',
    run: (a, { cfg }) =>
      toolOk(a.tipo, runOpen(cfg, String(a.alvo || a.target || a.app || a.aplicativo || a.url || a.programa || '')))
  },
  {
    tipo: 'sistema.volume',
    category: 'system',
    run(a, { cfg }) {
      const level = Number(a.nivel ?? a.level ?? a.valor ?? a.percentual)
      const action = normVolumeAction(a.acao ?? a.action ?? a.direcao)
      if (action === 'set' && !Number.isFinite(level)) {
        return toolErr(a.tipo, 'Diga o nível (0 a 100) ou se é para aumentar, diminuir ou mutar.')
      }
      return toolOk(a.tipo, runVolume(cfg, { action, level }))
    }
  },
  {
    tipo: 'sistema.bloquear',
    category: 'system',
    run: (a, { cfg }) => toolOk(a.tipo, runLock(cfg))
  },
  {
    tipo: 'sistema.captura',
    category: 'system',
    run: (a, { cfg }) => toolOk(a.tipo, runScreenshot(cfg))
  },
  {
    tipo: 'sistema.midia',
    category: 'system',
    run: (a, { cfg }) => toolOk(a.tipo, runMedia(cfg, normMediaAction(a.acao ?? a.action ?? a.comando)))
  },
  {
    tipo: 'sistema.brilho',
    category: 'system',
    run(a, { cfg }) {
      const level = Number(a.nivel ?? a.level ?? a.valor ?? a.percentual)
      const action = normBrightnessAction(a.acao ?? a.action ?? a.direcao)
      if (action === 'set' && !Number.isFinite(level)) {
        return toolErr(a.tipo, 'Diga o nível do brilho (0 a 100) ou se é para clarear ou escurecer.')
      }
      return toolOk(a.tipo, runBrightness(cfg, { action, level }))
    }
  }
]
