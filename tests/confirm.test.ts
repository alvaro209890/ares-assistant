import { afterEach, describe, expect, it } from 'vitest'
import type { Acao } from '../src/shared/types'
import {
  clearPendingConfirm,
  decideConfirmation,
  describeConfirm,
  getPendingConfirm,
  isAffirmative,
  isDestructive,
  isNegative,
  setPendingConfirm,
  splitDestructive
} from '../src/main/confirm'

const del = (titulo: string): Acao => ({ tipo: 'tarefa.remover', titulo })
const add = (titulo: string): Acao => ({ tipo: 'tarefa.criar', titulo })
const clearList = (lista: string): Acao => ({ tipo: 'lista.limpar', lista })

describe('confiança — classificação', () => {
  it('reconhece ações destrutivas', () => {
    expect(isDestructive(del('x'))).toBe(true)
    expect(isDestructive(clearList('compras'))).toBe(true)
    expect(isDestructive({ tipo: 'memoria.remover', fato: 'y' })).toBe(true)
    expect(isDestructive(add('x'))).toBe(false)
    expect(isDestructive({ tipo: 'tarefa.concluir', titulo: 'x' })).toBe(false)
  })

  it('separa destrutivas de seguras', () => {
    const { destructive, safe } = splitDestructive([add('a'), del('b'), clearList('c')])
    expect(destructive).toHaveLength(2)
    expect(safe).toHaveLength(1)
  })

  it('descreve a confirmação de forma legível', () => {
    expect(describeConfirm([del('comprar café')])).toBe('Confirma que eu vou apagar a tarefa "comprar café"?')
    expect(describeConfirm([del('a'), clearList('compras')])).toMatch(/apagar a tarefa "a" e limpar a lista "compras"/)
  })
})

describe('confiança — afirmativo/negativo', () => {
  it('detecta confirmações', () => {
    for (const t of ['sim', 'Sim.', 'pode', 'pode apagar', 'confirmo', 'isso', 'claro', 'ok', 'certo', 'com certeza'])
      expect(isAffirmative(t)).toBe(true)
  })
  it('detecta recusas', () => {
    for (const t of ['não', 'nao', 'deixa', 'cancela', 'esquece', 'melhor não']) expect(isNegative(t)).toBe(true)
  })
  it('não confunde um comando novo com confirmação', () => {
    expect(isAffirmative('apaga a tarefa comprar café')).toBe(false)
    expect(isAffirmative('cria uma tarefa nova')).toBe(false)
    expect(isNegative('cria uma tarefa nova')).toBe(false)
  })
})

describe('confiança — decideConfirmation', () => {
  it('segura uma ação destrutiva e pergunta', () => {
    const d = decideConfirmation({ pending: null, proposed: [add('a'), del('b')], userText: 'apaga a tarefa b' })
    expect(d.outcome).toBe('held')
    expect(d.apply.map((x) => x.tipo)).toEqual(['tarefa.criar']) // só a segura roda
    expect(d.hold?.map((x) => x.tipo)).toEqual(['tarefa.remover'])
    expect(d.question).toMatch(/Confirma/)
  })

  it('aplica direto quando o usuário já confirma no mesmo pedido', () => {
    const d = decideConfirmation({ pending: null, proposed: [del('b')], userText: 'pode apagar' })
    expect(d.outcome).toBe('applied')
    expect(d.apply).toHaveLength(1)
    expect(d.hold).toBeNull()
  })

  it('confirma o pendente quando o usuário diz sim', () => {
    const d = decideConfirmation({ pending: [del('b')], proposed: [], userText: 'sim' })
    expect(d.outcome).toBe('confirmed')
    expect(d.apply.map((x) => x.tipo)).toEqual(['tarefa.remover'])
  })

  it('cancela o pendente quando o usuário diz não', () => {
    const d = decideConfirmation({ pending: [del('b')], proposed: [], userText: 'não' })
    expect(d.outcome).toBe('cancelled')
    expect(d.apply).toHaveLength(0)
  })

  it('descarta o pendente se o usuário muda de assunto', () => {
    const d = decideConfirmation({ pending: [del('b')], proposed: [add('novo')], userText: 'cria a tarefa novo' })
    expect(d.outcome).toBe('none')
    expect(d.apply.map((x) => x.tipo)).toEqual(['tarefa.criar'])
    expect(d.hold).toBeNull()
  })

  it('não segura ações seguras', () => {
    const d = decideConfirmation({ pending: null, proposed: [add('a')], userText: 'cria a tarefa a' })
    expect(d.outcome).toBe('none')
    expect(d.apply).toHaveLength(1)
  })
})

describe('confiança — store por sessão', () => {
  afterEach(() => clearPendingConfirm('s1'))

  it('guarda e recupera o pendente', () => {
    expect(getPendingConfirm('s1')).toBeUndefined()
    setPendingConfirm('s1', [del('b')], 'Confirma?')
    expect(getPendingConfirm('s1')?.actions).toHaveLength(1)
    expect(clearPendingConfirm('s1')).toBe(true)
    expect(getPendingConfirm('s1')).toBeUndefined()
  })
})
