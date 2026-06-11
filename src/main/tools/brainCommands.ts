// Cérebro/configuração: troca de raciocínio/modelo por voz, desfazer, busca em
// memória. Todas curtas.

import { undoLast } from '../history'
import { searchSessions, userDataDir } from '../data'
import { applyModelAction, applyReasoningAction } from '../agent/prompt'
import { toolErr, toolOk } from '../agent/types'
import type { ToolCommand } from './types'

export const brainCommands: ToolCommand[] = [
  {
    tipo: 'ia.raciocinio',
    category: 'brain',
    run(a, { cfg }) {
      const r = applyReasoningAction(cfg, a)
      return r.erro ? toolErr(a.tipo, r.erro) : toolOk(a.tipo, r.resultado)
    }
  },
  {
    tipo: 'ia.modelo',
    category: 'brain',
    run(a, { cfg }) {
      const r = applyModelAction(cfg, a)
      return r.erro ? toolErr(a.tipo, r.erro) : toolOk(a.tipo, r.resultado)
    }
  },
  {
    tipo: 'desfazer',
    category: 'brain',
    run(a) {
      const r = undoLast(userDataDir())
      return r.ok
        ? toolOk(a.tipo, { ok: true, desfeito: r.label || 'a última alteração' })
        : toolErr(a.tipo, 'Não há nada para desfazer.')
    }
  },
  {
    tipo: 'memoria.buscar',
    category: 'brain',
    run(a) {
      return toolOk(
        a.tipo,
        searchSessions(String(a.consulta || a.query || a.texto || ''), Number(a.limite || a.limit || 5))
      )
    }
  }
]
