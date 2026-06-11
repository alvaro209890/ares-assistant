// Código: qualidade / diagnóstico / coder autônomo. Quase todo mundo aqui é longo:
// diagnóstico, testes, lint, formatar, typecheck, deps e o coder. Todos reportam
// progresso pra HUD ficar útil — o usuário enxerga "Rodando testes..." em vez de
// uma orbe pensando em silêncio.

import {
  checkDependencies,
  diagnoseProject,
  runFormat,
  runLint,
  runTests,
  runTypecheck,
  scanTodos
} from '../code'
import { runCoderTask } from '../coder'
import { toolOk } from '../agent/types'
import { argLimit, argRoot } from './util'
import type { ToolCommand } from './types'

export const codeQualityCommands: ToolCommand[] = [
  {
    tipo: 'codigo.diagnostico',
    category: 'code-quality',
    reportsProgress: true,
    progressLabel: () => 'Diagnosticando projeto...',
    async run(a, { cfg, signal, beating, pipeProgress, reportProgress }) {
      reportProgress('Coletando saúde estrutural e dependências...')
      return toolOk(
        a.tipo,
        await beating(diagnoseProject(cfg, { root: argRoot(a), signal, onProgress: pipeProgress }))
      )
    }
  },
  {
    tipo: 'codigo.testar',
    category: 'code-quality',
    reportsProgress: true,
    progressLabel: () => 'Rodando testes...',
    async run(a, { cfg, signal, beating, pipeProgress, reportProgress }) {
      reportProgress('Executando suite de testes...')
      return toolOk(
        a.tipo,
        await beating(runTests(cfg, { root: argRoot(a), signal, onProgress: pipeProgress }))
      )
    }
  },
  {
    tipo: 'codigo.lint',
    category: 'code-quality',
    reportsProgress: true,
    progressLabel: () => 'Rodando lint...',
    async run(a, { cfg, signal, beating, pipeProgress, reportProgress }) {
      reportProgress('Analisando código com o linter...')
      return toolOk(
        a.tipo,
        await beating(runLint(cfg, { root: argRoot(a), signal, onProgress: pipeProgress }))
      )
    }
  },
  {
    tipo: 'codigo.formatar',
    category: 'code-quality',
    reportsProgress: true,
    progressLabel: () => 'Formatando projeto...',
    async run(a, { cfg, signal, beating, pipeProgress, reportProgress }) {
      reportProgress('Aplicando formatador...')
      return toolOk(
        a.tipo,
        await beating(runFormat(cfg, { root: argRoot(a), signal, onProgress: pipeProgress }))
      )
    }
  },
  {
    tipo: 'codigo.typecheck',
    category: 'code-quality',
    reportsProgress: true,
    progressLabel: () => 'Checando tipos...',
    async run(a, { cfg, signal, beating, pipeProgress, reportProgress }) {
      reportProgress('Rodando o type-checker...')
      return toolOk(
        a.tipo,
        await beating(runTypecheck(cfg, { root: argRoot(a), signal, onProgress: pipeProgress }))
      )
    }
  },
  {
    tipo: 'codigo.deps',
    category: 'code-quality',
    reportsProgress: true,
    progressLabel: () => 'Checando dependências...',
    async run(a, { cfg, signal, beating, pipeProgress, reportProgress }) {
      reportProgress('Consultando dependências e versões...')
      return toolOk(
        a.tipo,
        await beating(checkDependencies(cfg, { root: argRoot(a), signal, onProgress: pipeProgress }))
      )
    }
  },
  {
    tipo: 'codigo.todo',
    category: 'code-quality',
    run: (a, { cfg }) =>
      toolOk(
        a.tipo,
        scanTodos(cfg, {
          root: argRoot(a),
          filter: a.filtro || a.filter ? String(a.filtro || a.filter) : undefined,
          maxResults: argLimit(a)
        })
      )
  },
  {
    tipo: 'codigo.projeto',
    category: 'code-quality',
    reportsProgress: true,
    progressLabel: (a) => `Coder autônomo: ${String(a.objetivo || a.tarefa || '').slice(0, 60)}`,
    async run(a, { cfg, signal, beating, reportProgress }) {
      reportProgress('Planejando e executando passos...')
      return toolOk(
        a.tipo,
        await beating(
          runCoderTask(cfg, {
            objetivo: String(a.objetivo || a.tarefa || a.descricao || a.texto || ''),
            root: String(a.path || a.raiz || a.destino || a.onde || a.nome || ''),
            passos: Number(a.passos || a.steps || 0) || undefined,
            signal
          })
        )
      )
    }
  }
]
