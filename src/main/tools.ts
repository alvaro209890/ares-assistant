import type { ReverseGeocodeResult, UserLocation, WeatherResult, WeatherPeriod, NewsItem, WebResult } from '../shared/types'

// Ferramentas de consulta externas (sem chave de API):
// - Clima: Open-Meteo (geocoding + forecast)
// - Notícias: Google News RSS
// - Busca web: DuckDuckGo HTML
// Todas tratam erros de forma amigável (sem internet, fora do ar, não encontrado).

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init?.headers || {}) } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// ---------------- Clima (Open-Meteo) ----------------
const WEATHER_CODES: Record<number, string> = {
  0: 'céu limpo',
  1: 'predomínio de sol',
  2: 'parcialmente nublado',
  3: 'nublado',
  45: 'névoa',
  48: 'névoa com geada',
  51: 'garoa fraca',
  53: 'garoa',
  55: 'garoa forte',
  61: 'chuva fraca',
  63: 'chuva',
  65: 'chuva forte',
  71: 'neve fraca',
  73: 'neve',
  75: 'neve forte',
  80: 'pancadas de chuva',
  81: 'pancadas de chuva',
  82: 'pancadas fortes de chuva',
  95: 'tempestade',
  96: 'tempestade com granizo',
  99: 'tempestade forte com granizo'
}

/** Média arredondada de uma lista de números (ignora nulos). */
function avg(values: number[]): number {
  const valid = values.filter((v) => typeof v === 'number' && !Number.isNaN(v))
  if (!valid.length) return 0
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
}
function maxOf(values: number[]): number {
  const valid = values.filter((v) => typeof v === 'number' && !Number.isNaN(v))
  return valid.length ? Math.max(...valid) : 0
}

// Quebra as horas de HOJE em manhã (06-12), tarde (12-18) e noite (18-24).
function buildPeriods(hourly: any): WeatherPeriod[] {
  const times: string[] = hourly?.time || []
  if (!times.length) return []
  const today = new Date().toISOString().slice(0, 10)
  const slots: { key: WeatherPeriod['key']; label: string; from: number; to: number }[] = [
    { key: 'manha', label: 'Manhã', from: 6, to: 12 },
    { key: 'tarde', label: 'Tarde', from: 12, to: 18 },
    { key: 'noite', label: 'Noite', from: 18, to: 24 }
  ]
  const periods: WeatherPeriod[] = []
  for (const s of slots) {
    const idx: number[] = []
    for (let i = 0; i < times.length; i++) {
      if (!times[i].startsWith(today)) continue
      const hour = Number(times[i].slice(11, 13))
      if (hour >= s.from && hour < s.to) idx.push(i)
    }
    if (!idx.length) continue
    const codes = idx.map((i) => hourly.weather_code?.[i]).filter((c: unknown) => typeof c === 'number')
    const code = maxOf(codes) // o código mais "severo" tende a ter número maior
    periods.push({
      key: s.key,
      label: s.label,
      temp: avg(idx.map((i) => hourly.temperature_2m?.[i])),
      code,
      desc: WEATHER_CODES[code] || 'tempo indefinido',
      precipProb: maxOf(idx.map((i) => hourly.precipitation_probability?.[i] ?? 0))
    })
  }
  return periods
}

function buildAlert(
  current: WeatherResult['current'],
  today: WeatherResult['today'],
  periods: WeatherPeriod[]
): string | undefined {
  const rain = Math.max(today.precipProb, ...periods.map((p) => p.precipProb), current.precipProb)
  if (rain >= 70) return 'Alta chance de chuva hoje — leve guarda-chuva.'
  if (current.code >= 95) return 'Risco de tempestade na região.'
  if (current.wind >= 45) return 'Ventos fortes na região.'
  if (today.max >= 36) return 'Calor intenso — hidrate-se e evite sol forte.'
  if (today.min <= 5) return 'Frio intenso — agasalhe-se bem.'
  if (rain >= 50) return 'Pode chover hoje — considere levar guarda-chuva.'
  return undefined
}

async function forecastByCoords(lat: number, lon: number, label: string): Promise<WeatherResult> {
  const fTxt = await fetchText(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation_probability` +
      `&hourly=temperature_2m,precipitation_probability,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=2&timezone=auto`
  )
  const f = JSON.parse(fTxt)
  const code = f.current.weather_code
  const current = {
    temp: Math.round(f.current.temperature_2m),
    feels: Math.round(f.current.apparent_temperature),
    code,
    desc: WEATHER_CODES[code] || 'tempo indefinido',
    wind: Math.round(f.current.wind_speed_10m),
    humidity: Math.round(f.current.relative_humidity_2m),
    precipProb: Math.round(f.current.precipitation_probability ?? 0)
  }
  const today = {
    min: Math.round(f.daily.temperature_2m_min[0]),
    max: Math.round(f.daily.temperature_2m_max[0]),
    precipProb: f.daily.precipitation_probability_max?.[0] ?? 0
  }
  const periods = buildPeriods(f.hourly)
  return {
    city: label,
    source: 'Open-Meteo',
    updatedAt: Date.now(),
    latitude: lat,
    longitude: lon,
    current,
    today,
    periods,
    alert: buildAlert(current, today, periods)
  }
}

export async function getWeather(city: string): Promise<WeatherResult> {
  const q = (city || '').trim()
  if (!q) throw new Error('Diga uma cidade para eu consultar o tempo.')
  let geo: any
  try {
    const txt = await fetchText(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=pt&format=json`
    )
    geo = JSON.parse(txt)
  } catch {
    throw new Error('Não consegui consultar o clima agora (sem internet ou serviço fora do ar).')
  }
  const loc = geo?.results?.[0]
  if (!loc) throw new Error(`Não encontrei a cidade "${q}".`)
  return forecastByCoords(loc.latitude, loc.longitude, `${loc.name}${loc.admin1 ? ', ' + loc.admin1 : ''}`)
}

export async function getWeatherAt(location: UserLocation): Promise<WeatherResult> {
  if (!location.enabled || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
    throw new Error('Localização precisa não está ativada.')
  }
  const label = location.label || location.city || 'sua localização'
  try {
    return await forecastByCoords(location.latitude, location.longitude, label)
  } catch {
    throw new Error('Não consegui consultar o clima pela sua localização agora.')
  }
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodeResult> {
  try {
    const txt = await fetchText(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}` +
        `&lon=${encodeURIComponent(longitude)}&zoom=10&accept-language=pt-BR`
    )
    const json = JSON.parse(txt)
    const addr = json?.address || {}
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county
    const region = addr.state || addr.region
    const country = addr.country
    const label = [city, region].filter(Boolean).join(', ') || json?.display_name || 'localização atual'
    return { city, region, country, label }
  } catch {
    return { label: 'localização atual' }
  }
}

// ---------------- Notícias (Google News RSS) ----------------
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim()
}

export async function getNews(topic = '', limit = 6): Promise<NewsItem[]> {
  const base = topic.trim()
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`
    : `https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419`
  let xml: string
  try {
    xml = await fetchText(base)
  } catch {
    throw new Error('Não consegui buscar as notícias agora (sem internet ou serviço fora do ar).')
  }
  const items: NewsItem[] = []
  const blocks = xml.split('<item>').slice(1)
  for (const b of blocks.slice(0, limit)) {
    const title = b.match(/<title>([\s\S]*?)<\/title>/)?.[1]
    const link = b.match(/<link>([\s\S]*?)<\/link>/)?.[1]
    const source = b.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]
    const pub = b.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]
    if (title) {
      items.push({
        title: decodeEntities(title),
        link: link ? decodeEntities(link) : '',
        source: source ? decodeEntities(source) : undefined,
        published: pub ? decodeEntities(pub) : undefined
      })
    }
  }
  if (!items.length) throw new Error('Nenhuma notícia encontrada.')
  return items
}

// ---------------- Busca web (DuckDuckGo HTML) ----------------
export async function webSearch(query: string, limit = 5): Promise<WebResult[]> {
  const q = (query || '').trim()
  if (!q) throw new Error('Diga o que devo procurar na web.')
  let html: string
  try {
    html = await fetchText('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `q=${encodeURIComponent(q)}&kl=br-pt`
    })
  } catch {
    throw new Error('Não consegui buscar na web agora (sem internet ou serviço fora do ar).')
  }
  const results: WebResult[] = []
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  const snippets: string[] = []
  let sm: RegExpExecArray | null
  while ((sm = snippetRe.exec(html))) snippets.push(decodeEntities(sm[1]))
  let lm: RegExpExecArray | null
  let i = 0
  while ((lm = linkRe.exec(html)) && results.length < limit) {
    let url = lm[1]
    const uddg = url.match(/[?&]uddg=([^&]+)/)
    if (uddg) url = decodeURIComponent(uddg[1])
    results.push({ title: decodeEntities(lm[2]), url, snippet: snippets[i] || '' })
    i++
  }
  if (!results.length) throw new Error('Nenhum resultado encontrado na web.')
  return results
}
