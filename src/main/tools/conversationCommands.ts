// Conversação / web / agenda: clima, busca, notícias, agenda, calc, conversões e
// leitura de página. Comandos curtos não emitem progresso; web.buscar/pagina.ler
// reportam pra HUD porque costumam levar 1-3s na rede.

import { boardSummary, loadBoard } from '../tasks'
import { loadEvents } from '../data'
import {
  calcExpression,
  convertCurrency,
  convertUnit,
  getNews,
  getWeather,
  getWeatherAt,
  readPage,
  webSearch
} from '../tools'
import { toolErr, toolOk } from '../agent/types'
import type { ToolCommand } from './types'

export const conversationCommands: ToolCommand[] = [
  {
    tipo: 'clima.consultar',
    category: 'conversation',
    async run(a, { cfg }) {
      const integrations = cfg.integrations
      const city = String(a.cidade || '').trim()
      const resultado = city
        ? await getWeather(city)
        : integrations.location.enabled && typeof integrations.location.latitude === 'number'
          ? await getWeatherAt(integrations.location)
          : await getWeather(integrations.weatherCity)
      return toolOk(a.tipo, resultado)
    }
  },
  {
    tipo: 'web.buscar',
    category: 'conversation',
    reportsProgress: true,
    progressLabel: (a) => `Buscando na web: "${String(a.consulta || a.query || '').slice(0, 60)}"`,
    async run(a, { reportProgress }) {
      reportProgress('Consultando provedor de busca...')
      const resultado = await webSearch(String(a.consulta || a.query || ''))
      return toolOk(a.tipo, resultado)
    }
  },
  {
    tipo: 'noticias.listar',
    category: 'conversation',
    reportsProgress: true,
    progressLabel: (a) => `Buscando notícias${a.tema ? ` (${String(a.tema)})` : ''}...`,
    async run(a, { cfg, reportProgress }) {
      reportProgress('Lendo feed de notícias...')
      const tema = String(a.tema || cfg.integrations.newsTopic || '')
      return toolOk(a.tipo, await getNews(tema))
    }
  },
  {
    tipo: 'agenda.listar',
    category: 'conversation',
    run(a) {
      const dia = a.dia ? String(a.dia).slice(0, 10) : null
      const evs = loadEvents().filter((e) => (dia ? e.whenISO.slice(0, 10) === dia : true))
      return toolOk(a.tipo, evs.map((e) => ({ titulo: e.title, quando: e.whenISO, descricao: e.description })))
    }
  },
  {
    tipo: 'tarefa.listar',
    category: 'conversation',
    run(a) {
      return toolOk(a.tipo, boardSummary(loadBoard()))
    }
  },
  {
    tipo: 'calcular',
    category: 'conversation',
    run(a) {
      return toolOk(a.tipo, calcExpression(String(a.expressao || a.conta || '')))
    }
  },
  {
    tipo: 'converter.moeda',
    category: 'conversation',
    async run(a) {
      return toolOk(a.tipo, await convertCurrency(String(a.de || ''), String(a.para || ''), Number(a.valor)))
    }
  },
  {
    tipo: 'converter.unidade',
    category: 'conversation',
    run(a) {
      const r = convertUnit(String(a.de || ''), String(a.para || ''), Number(a.valor))
      return toolOk(a.tipo, r)
    }
  },
  {
    tipo: 'pagina.ler',
    category: 'conversation',
    reportsProgress: true,
    progressLabel: (a) => {
      const url = String(a.url || a.endereco || a.link || '')
      return `Abrindo página: ${url.slice(0, 60)}`
    },
    async run(a, { reportProgress }) {
      const url = String(a.url || a.endereco || a.link || '')
      if (!url) return toolErr(a.tipo, 'Diga a URL que devo ler.')
      reportProgress('Baixando página e extraindo texto...')
      return toolOk(a.tipo, await readPage(url))
    }
  }
]
