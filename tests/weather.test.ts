import { describe, it, expect } from 'vitest'
import { parseCityQuery, pickGeoResult } from '../src/main/tools'

describe('parseCityQuery', () => {
  it('separa "Cidade, UF" e expande a UF para o nome do estado', () => {
    expect(parseCityQuery('Querência, MT')).toEqual({ city: 'Querência', region: 'Mato Grosso' })
  })

  it('aceita separadores variados (barra e hífen)', () => {
    expect(parseCityQuery('Curitiba/PR')).toEqual({ city: 'Curitiba', region: 'Paraná' })
    expect(parseCityQuery('Querência - Mato Grosso')).toEqual({ city: 'Querência', region: 'Mato Grosso' })
  })

  it('cidade pura fica sem região', () => {
    expect(parseCityQuery('São Paulo')).toEqual({ city: 'São Paulo', region: '' })
  })

  it('tolera espaços e string vazia', () => {
    expect(parseCityQuery('  Belém ,  PA ')).toEqual({ city: 'Belém', region: 'Pará' })
    expect(parseCityQuery('')).toEqual({ city: '', region: '' })
  })
})

describe('pickGeoResult', () => {
  const querenciaMT = { name: 'Querência', admin1: 'Mato Grosso', country_code: 'BR' }
  const querenciaRS = { name: 'Querência', admin1: 'Rio Grande do Sul', country_code: 'BR' }
  const querenciaES = { name: 'Querencia', admin1: 'Castilla-La Mancha', country_code: 'ES' }

  it('desambigua cidades homônimas pela região (ignorando acentos)', () => {
    expect(pickGeoResult([querenciaES, querenciaRS, querenciaMT], 'Mato Grosso')).toBe(querenciaMT)
    expect(pickGeoResult([querenciaES, querenciaMT, querenciaRS], 'Rio Grande do Sul')).toBe(querenciaRS)
  })

  it('sem região, prefere o resultado do Brasil', () => {
    expect(pickGeoResult([querenciaES, querenciaMT], '')).toBe(querenciaMT)
  })

  it('cai no primeiro resultado quando nada combina', () => {
    expect(pickGeoResult([querenciaES], 'Mato Grosso')).toBe(querenciaES)
  })

  it('retorna undefined para lista vazia', () => {
    expect(pickGeoResult([], 'Mato Grosso')).toBeUndefined()
  })
})
