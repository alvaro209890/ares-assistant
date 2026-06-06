import os from 'os'
import { clipboard } from 'electron'
import type { SystemMetrics } from '../shared/types'

// Telemetria leve do computador (estilo JARVIS) e leitura da área de transferência.
// Tudo local: nada sai do PC.

// Amostra acumulada de tempos de CPU para calcular o uso entre duas leituras.
function sampleCpu(): { idle: number; total: number } {
  let idle = 0
  let total = 0
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t
    idle += c.times.idle
  }
  return { idle, total }
}
let lastCpu = sampleCpu()

/**
 * Uso atual de CPU/memória, tempo ligado e carga. O percentual de CPU é a média
 * desde a última chamada (o renderer consulta em intervalos), então reflete o uso
 * recente em vez de um pico instantâneo.
 */
export function getSystemMetrics(): SystemMetrics {
  const now = sampleCpu()
  const idleDiff = now.idle - lastCpu.idle
  const totalDiff = now.total - lastCpu.total
  lastCpu = now
  const cpuPercent =
    totalDiff > 0 ? Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100))) : 0

  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const gb = (n: number): number => Math.round((n / 1024 ** 3) * 10) / 10

  return {
    cpuPercent,
    memPercent: Math.round((usedMem / totalMem) * 100),
    memUsedGB: gb(usedMem),
    memTotalGB: gb(totalMem),
    uptimeSec: Math.round(os.uptime()),
    loadAvg1: Math.round((os.loadavg()[0] || 0) * 100) / 100,
    cores: os.cpus().length,
    hostname: os.hostname(),
    platform: process.platform
  }
}

/** Lê o texto da área de transferência (truncado), para o agente resumir/traduzir/explicar. */
export function readClipboard(): { texto: string; vazio: boolean } {
  const t = (clipboard.readText() || '').trim()
  return { texto: t.slice(0, 4000), vazio: !t }
}

/** Escreve um texto na área de transferência (ex.: rascunho/código gerado pelo Ares). */
export function writeClipboard(text: string): { ok: boolean; chars: number } {
  const t = String(text ?? '')
  if (!t.trim()) throw new Error('Não há texto para copiar.')
  clipboard.writeText(t)
  return { ok: true, chars: t.length }
}
