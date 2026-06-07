import { describe, expect, it } from 'vitest'
import { normalizeTemplate, slug, templateFiles } from '../src/main/scaffold'

describe('scaffold — slug', () => {
  it('vira kebab-case sem acentos', () => {
    expect(slug('Meu Site Legal')).toBe('meu-site-legal')
    expect(slug('Olá Mundo!')).toBe('ola-mundo')
    expect(slug('  café com leite  ')).toBe('cafe-com-leite')
  })
  it('cai em "projeto" quando vazio', () => {
    expect(slug('')).toBe('projeto')
    expect(slug('!!!')).toBe('projeto')
  })
})

describe('scaffold — normalizeTemplate', () => {
  it('reconhece apelidos', () => {
    expect(normalizeTemplate('html')).toBe('pagina')
    expect(normalizeTemplate('página')).toBe('pagina')
    expect(normalizeTemplate('nodejs')).toBe('node')
    expect(normalizeTemplate('qualquer')).toBe('site')
  })
})

describe('scaffold — templateFiles', () => {
  it('site traz os 4 arquivos com o título', () => {
    const files = templateFiles('site', 'Minha Loja')
    expect(Object.keys(files).sort()).toEqual(['README.md', 'index.html', 'script.js', 'styles.css'])
    expect(files['index.html']).toContain('<title>Minha Loja</title>')
    expect(files['index.html']).toContain('script.js')
    expect(files['index.html']).toContain('styles.css')
    expect(files['script.js']).toContain('getElementById')
  })

  it('node traz package.json válido com scripts', () => {
    const files = templateFiles('node', 'Meu Pacote')
    const pkg = JSON.parse(files['package.json'])
    expect(pkg.name).toBe('meu-pacote')
    expect(pkg.scripts.start).toBe('node index.js')
    expect(pkg.scripts.test).toBe('node --test')
    expect(files['index.js']).toContain('export function saudar')
  })

  it('pagina é um único HTML', () => {
    const files = templateFiles('pagina', 'Oi')
    expect(Object.keys(files)).toEqual(['index.html'])
    expect(files['index.html']).toContain('<title>Oi</title>')
  })
})
