import { uid } from '../data'
import type { Acao } from '../../shared/types'
import { toolOk, type ToolResult } from '../agent/types'
import type { ToolCommand } from './types'
import { demoManager } from '../demoManager'
import { logger } from '../logger'

export async function handleDemoSlide(acao: Acao): Promise<ToolResult> {
  const params = acao as unknown as {
    titulo: string
    pontos?: string[]
    codigo?: string
    arquivo?: string
    linhaInicial?: number
    linhaFinal?: number
  }

  if (!params.titulo) {
    throw new Error('Parâmetro "titulo" é obrigatório em demo.slide')
  }

  const linhaInicial = params.linhaInicial !== undefined ? Number(params.linhaInicial) : undefined
  const linhaFinal = params.linhaFinal !== undefined ? Number(params.linhaFinal) : undefined
  if (linhaInicial !== undefined && !Number.isFinite(linhaInicial)) {
    throw new Error('Parâmetro "linhaInicial" deve ser um número inteiro')
  }
  if (linhaFinal !== undefined && !Number.isFinite(linhaFinal)) {
    throw new Error('Parâmetro "linhaFinal" deve ser um número inteiro')
  }
  if (linhaInicial !== undefined && linhaFinal !== undefined && linhaInicial > linhaFinal) {
    throw new Error('linhaInicial não pode ser maior que linhaFinal')
  }

  const slide = {
    id: uid('demo'),
    title: params.titulo,
    points: Array.isArray(params.pontos) ? params.pontos : [],
    codeSnippet: params.codigo,
    filePath: params.arquivo,
    lineRange: (linhaInicial !== undefined && linhaFinal !== undefined)
      ? [linhaInicial, linhaFinal] as [number, number]
      : undefined
  }

  logger.info('demo', `Registrando novo slide: ${slide.title}`)
  demoManager.queueSlide(slide)

  return toolOk(acao.tipo, { ok: true })
}

export const demoCommands: readonly ToolCommand[] = [
  {
    tipo: 'demo.slide',
    category: 'system' as const,
    run: handleDemoSlide
  }
]

