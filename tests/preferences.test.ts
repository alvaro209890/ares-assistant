import { describe, expect, it } from 'vitest'
import type { MemoryCategory, MemoryFact } from '../src/shared/types'
import { filterCodingPreferences, formatCodingPreferences } from '../src/main/preferences'

let n = 0
function fact(text: string, category: MemoryCategory, status: 'active' | 'pending' = 'active'): MemoryFact {
  return { id: `f${n++}`, text, category, source: 'manual', status, createdAt: Date.now() }
}

describe('pílulas de contexto — preferências de código', () => {
  it('captura preferências de estilo declaradas pelo usuário', () => {
    const facts = [
      fact('sempre use aspas simples', 'preferencias'),
      fact('prefiro funções nomeadas em vez de anônimas', 'preferencias'),
      fact('indentação com 2 espaços', 'preferencias')
    ]
    const prefs = filterCodingPreferences(facts)
    expect(prefs).toHaveLength(3)
  })

  it('ignora fatos pendentes e preferências não relacionadas a código', () => {
    const facts = [
      fact('sempre use aspas simples', 'preferencias', 'pending'),
      fact('gosta de café pela manhã', 'interesses'),
      fact('prefere música clássica', 'preferencias')
    ]
    expect(filterCodingPreferences(facts)).toHaveLength(0)
  })

  it('em categorias genéricas exige sinal de código + verbo de preferência', () => {
    expect(filterCodingPreferences([fact('prefiro usar TypeScript no código', 'outros')])).toHaveLength(1)
    expect(filterCodingPreferences([fact('o céu é azul', 'outros')])).toHaveLength(0)
  })

  it('formata um resumo curto e falável com marcadores', () => {
    const out = formatCodingPreferences([
      fact('sempre use aspas simples', 'preferencias'),
      fact('prefira funções nomeadas', 'preferencias')
    ])
    expect(out).toContain('- sempre use aspas simples')
    expect(out).toContain('- prefira funções nomeadas')
    expect(formatCodingPreferences([])).toBe('')
  })
})
