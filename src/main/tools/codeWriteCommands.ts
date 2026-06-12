// Código: escrita / scaffold / patches. Sem reportsProgress (curtos demais para
// valer a pena uma barra; a timeline de atividades já mostra "Escrevendo arquivo X").

import type { CodeEditMode } from '../../shared/types'
import {
  applyCodePatch,
  editCodeFile,
  previewCodePatch,
  replaceInProject,
  scaffoldProject,
  writeCodeFile
} from '../code'
import { toolOk } from '../agent/types'
import { argFile, argRoot } from './util'
import type { ToolCommand } from './types'

export const codeWriteCommands: ToolCommand[] = [
  {
    tipo: 'codigo.scaffold',
    category: 'code-write',
    run(a, { cfg }) {
      const resultado = scaffoldProject(cfg, {
        tipo: String(a.tipo_projeto || a.template || a.modelo || a.kind || 'site'),
        nome: String(a.nome || a.name || a.projeto || ''),
        path: String(a.path || a.raiz || a.destino || a.onde || ''),
        force: a.force === true || a.forcar === true
      })
      return toolOk(a.tipo, resultado)
    }
  },
  {
    tipo: 'codigo.criar',
    category: 'code-write',
    run(a, { cfg }) {
      const resultado = writeCodeFile(cfg, {
        root: argRoot(a),
        file: argFile(a),
        content: String(a.conteudo ?? a.content ?? a.texto ?? ''),
        overwrite: a.sobrescrever === true || a.overwrite === true
      })
      return toolOk(a.tipo, resultado)
    }
  },
  {
    tipo: 'codigo.editar',
    category: 'code-write',
    run(a, { cfg }) {
      const mode = String(a.modo || a.mode || '') as CodeEditMode
      const resultado = editCodeFile(cfg, {
        root: argRoot(a),
        file: argFile(a),
        mode,
        oldText: a.antigo || a.oldText || a.find ? String(a.antigo || a.oldText || a.find) : undefined,
        newText: String(a.novo ?? a.newText ?? a.replace ?? ''),
        anchor: a.ancora || a.anchor ? String(a.ancora || a.anchor) : undefined,
        startLine: Number(a.inicio || a.startLine || a.start || 0) || undefined,
        endLine: Number(a.fim || a.endLine || a.end || 0) || undefined,
        replaceAll: a.todos === true || a.replaceAll === true || a.all === true,
        expectedMatches: Number.isFinite(Number(a.esperado ?? a.expectedMatches))
          ? Number(a.esperado ?? a.expectedMatches)
          : undefined
      })
      return toolOk(a.tipo, resultado)
    }
  },
  {
    tipo: 'codigo.substituir',
    category: 'code-write',
    run(a, { cfg }) {
      const apply = a.confirmado === true || a.aplicar === true || a.apply === true
      const resultado = replaceInProject(cfg, {
        root: argRoot(a),
        find: String(a.de ?? a.find ?? a.antigo ?? ''),
        replace: String(a.para ?? a.replace ?? a.novo ?? ''),
        filter: a.filtro || a.filter ? String(a.filtro || a.filter) : undefined,
        apply
      })
      return toolOk(a.tipo, resultado)
    }
  },
  {
    tipo: 'codigo.patch.preview',
    category: 'code-write',
    run: (a, { cfg }) =>
      toolOk(a.tipo, previewCodePatch(cfg, { root: argRoot(a), diff: a.diff, patches: a.patches }))
  },
  {
    tipo: 'codigo.patch.aplicar',
    category: 'code-write',
    run(a, { cfg }) {
      const resultado = applyCodePatch(cfg, { root: argRoot(a), diff: a.diff, patches: a.patches })
      return toolOk(a.tipo, resultado)
    }
  }
]
