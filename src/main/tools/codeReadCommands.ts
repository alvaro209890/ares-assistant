// Código: leitura / navegação. workspace, busca, listar, ler, esboço, referências,
// git, índice. Indexar é o único razoavelmente longo (reportsProgress).

import {
  buildCodeIndex,
  explainCode,
  findCodeReferences,
  gitStructuredDiff,
  listCodeFiles,
  outlineCodeFile,
  readCodeFile,
  runCodeGit,
  searchCode,
  summarizeCodeWorkspace
} from '../code'
import { toolOk } from '../agent/types'
import { argFile, argLimit, argRoot } from './util'
import type { ToolCommand } from './types'

export const codeReadCommands: ToolCommand[] = [
  {
    tipo: 'codigo.workspace',
    category: 'code-read',
    run: (a, { cfg }) => toolOk(a.tipo, summarizeCodeWorkspace(cfg, argRoot(a)))
  },
  {
    tipo: 'codigo.buscar',
    category: 'code-read',
    run: (a, { cfg }) =>
      toolOk(
        a.tipo,
        searchCode(cfg, {
          root: argRoot(a),
          query: String(a.consulta || a.query || a.simbolo || ''),
          filter: a.filtro ? String(a.filtro) : a.glob ? String(a.glob) : undefined,
          maxResults: argLimit(a)
        })
      )
  },
  {
    tipo: 'codigo.ler',
    category: 'code-read',
    run: (a, { cfg }) =>
      toolOk(
        a.tipo,
        readCodeFile(cfg, {
          root: argRoot(a),
          file: argFile(a),
          startLine: Number(a.inicio || a.start || 0) || undefined,
          lines: Number(a.linhas || a.lines || 0) || undefined
        })
      )
  },
  {
    tipo: 'codigo.listar',
    category: 'code-read',
    run: (a, { cfg }) =>
      toolOk(
        a.tipo,
        listCodeFiles(cfg, {
          root: argRoot(a),
          pattern: String(a.padrao || a.pattern || a.filtro || a.glob || ''),
          maxResults: argLimit(a)
        })
      )
  },
  {
    tipo: 'codigo.esboco',
    category: 'code-read',
    run: (a, { cfg }) => toolOk(a.tipo, outlineCodeFile(cfg, { root: argRoot(a), file: argFile(a) }))
  },
  {
    tipo: 'codigo.explicar',
    category: 'code-read',
    run: (a, { cfg }) =>
      toolOk(
        a.tipo,
        explainCode(cfg, {
          root: argRoot(a),
          file: argFile(a),
          startLine: Number(a.inicio || a.start || a.startLine || 0) || undefined,
          endLine: Number(a.fim || a.end || a.endLine || 0) || undefined
        })
      )
  },
  {
    tipo: 'codigo.referencias',
    category: 'code-read',
    run: (a, { cfg }) =>
      toolOk(
        a.tipo,
        findCodeReferences(cfg, {
          root: argRoot(a),
          symbol: String(a.simbolo || a.symbol || a.nome || a.consulta || ''),
          maxResults: argLimit(a)
        })
      )
  },
  {
    tipo: 'codigo.git',
    category: 'code-read',
    async run(a, { cfg, signal, pipeProgress }) {
      const operation = String(a.operacao || a.operation || 'status')
      const file = a.arquivo || a.file ? String(a.arquivo || a.file) : undefined
      // diff estruturado (arquivos + totais + commit semântico sugerido)
      if (/^diff(struct|estruturado)$/i.test(operation)) {
        return toolOk(
          a.tipo,
          await gitStructuredDiff(cfg, { root: argRoot(a), file, signal, onProgress: pipeProgress })
        )
      }
      return toolOk(
        a.tipo,
        await runCodeGit(cfg, {
          root: argRoot(a),
          operation,
          file,
          signal,
          onProgress: pipeProgress
        })
      )
    }
  },
  {
    tipo: 'codigo.indexar',
    category: 'code-read',
    reportsProgress: true,
    progressLabel: () => 'Indexando projeto...',
    run(a, { cfg, reportProgress }) {
      reportProgress('Lendo árvore de arquivos...')
      return toolOk(
        a.tipo,
        buildCodeIndex(cfg, {
          root: argRoot(a),
          refresh: a.refresh === true || a.atualizar === true
        })
      )
    }
  }
]
