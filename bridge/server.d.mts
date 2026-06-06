import type { Server } from 'node:http'

export interface BridgeConfig {
  port: number
  host: string
  nineRouterUrl: string
  model: string
  apiKey: string
  token: string
  timeoutMs: number
}

export function resolveConfig(env?: Record<string, string | undefined>): BridgeConfig
export function createBridgeServer(opts?: Partial<BridgeConfig>): Server
export function startBridge(env?: Record<string, string | undefined>): Server
