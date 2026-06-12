import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Electron para podermos carregar e testar o sentinelManager
vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn(() => 'temp')
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => [])
    }
  }
})

import {
  extractErrorSignature,
  isRecoveryMessage,
  hasErrorIndicators,
  setPendingSentinelDebug,
  getPendingSentinelDebug,
  clearPendingSentinelDebug
} from '../src/main/sentinel'

import {
  startSentinel,
  stopSentinels,
  listSentinels,
  stopAllSentinels
} from '../src/main/sentinelManager'

describe('Sentinel de Execução - Módulo Puro', () => {
  describe('extractErrorSignature', () => {
    it('deve extrair a assinatura correta de um erro TypeScript compile', () => {
      const log = `
[vite] /project/src/App.tsx:10:15 - error TS2322: Type 'string' is not assignable to type 'number'.
10 const x: number = "hello";
      `
      const sig = extractErrorSignature(log)
      expect(sig).not.toBeNull()
      expect(sig?.type).toBe('TS2322')
      expect(sig?.fileLine).toBe('App.tsx:10')
      expect(sig?.message).toContain("Type 'string' is not assignable to type 'number'")
      expect(sig?.hash).toContain('ts2322|app.tsx:10')
    })

    it('deve extrair a assinatura correta de um erro ZeroDivisionError do Python', () => {
      const log = `
Traceback (most recent call last):
  File "app.py", line 10, in <module>
    print(1 / 0)
ZeroDivisionError: division by zero
      `
      const sig = extractErrorSignature(log)
      expect(sig).not.toBeNull()
      expect(sig?.type).toBe('ZeroDivisionError')
      expect(sig?.fileLine).toBe('app.py:10')
      expect(sig?.message).toBe('ZeroDivisionError: division by zero')
      expect(sig?.hash).toBe('zerodivisionerror|app.py:10|zerodivisionerror: division by zero')
    })

    it('deve extrair a assinatura correta de uma stack trace do Node.js', () => {
      const log = `
ReferenceError: x is not defined
    at Object.<anonymous> (C:\\GIS\\ares-assistant\\src\\main\\index.ts:15:20)
    at Module._compile (node:internal/modules/cjs/loader:1546:14)
      `
      const sig = extractErrorSignature(log)
      expect(sig).not.toBeNull()
      expect(sig?.type).toBe('ReferenceError')
      expect(sig?.fileLine).toBe('index.ts:15')
      expect(sig?.message).toBe('ReferenceError: x is not defined')
      expect(sig?.hash).toBe('referenceerror|index.ts:15|referenceerror: x is not defined')
    })

    it('deve retornar null se não houver indicadores ou arquivos reconhecíveis', () => {
      const log = `algum log informativo normal`
      const sig = extractErrorSignature(log)
      expect(sig).toBeNull()
    })
  })

  describe('isRecoveryMessage', () => {
    it('deve detectar mensagens de recuperação conhecidas', () => {
      expect(isRecoveryMessage('webpack compiled successfully')).toBe(true)
      expect(isRecoveryMessage('hmr update in progress')).toBe(true)
      expect(isRecoveryMessage('vite v5.0.0 ready in 300ms')).toBe(true)
      expect(isRecoveryMessage('compiled with success')).toBe(true)
      expect(isRecoveryMessage('some regular log')).toBe(false)
    })
  })

  describe('hasErrorIndicators', () => {
    it('deve detectar erros no fluxo de texto', () => {
      expect(hasErrorIndicators('Error: crashed')).toBe(true)
      expect(hasErrorIndicators('failed to compile')).toBe(true)
      expect(hasErrorIndicators('    at foo (app.ts:10)')).toBe(true)
      expect(hasErrorIndicators('normal log output')).toBe(false)
    })
  })

  describe('Gestão de Pendência do Prometeu', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('deve registrar, buscar e limpar pendências', () => {
      const sessionId = 'session-123'
      setPendingSentinelDebug(sessionId, {
        sentinelId: 'sentinel-1',
        command: 'npm run dev',
        logSnippet: 'ReferenceError: x is not defined'
      })

      const pending = getPendingSentinelDebug(sessionId)
      expect(pending).toBeDefined()
      expect(pending?.command).toBe('npm run dev')
      expect(pending?.logSnippet).toBe('ReferenceError: x is not defined')

      clearPendingSentinelDebug(sessionId)
      expect(getPendingSentinelDebug(sessionId)).toBeUndefined()
    })

    it('deve expirar pendências após o TTL de 5 minutos', () => {
      const sessionId = 'session-456'
      setPendingSentinelDebug(sessionId, {
        sentinelId: 'sentinel-2',
        command: 'npm run test',
        logSnippet: 'TypeError: undefined is not a function'
      })

      // Avançar relógio 4 minutos
      vi.advanceTimersByTime(4 * 60 * 1000)
      expect(getPendingSentinelDebug(sessionId)).toBeDefined()

      // Avançar mais 2 minutos (total 6 minutos, maior que TTL de 5 min)
      vi.advanceTimersByTime(2 * 60 * 1000)
      expect(getPendingSentinelDebug(sessionId)).toBeUndefined()
    })
  })

  describe('SentinelManager (Mocks do Processo)', () => {
    afterEach(() => {
      stopAllSentinels()
    })

    it('deve respeitar o limite máximo de 3 sentinelas por sessão', async () => {
      const sessionId = 'session-limit-test'

      // Cria 3 sentinelas bem-sucedidas (usando comando dummy rápido/inofensivo)
      const res1 = await startSentinel(sessionId, 'echo 1', '.')
      const res2 = await startSentinel(sessionId, 'echo 2', '.')
      const res3 = await startSentinel(sessionId, 'echo 3', '.')

      expect(res1).toHaveProperty('sentinelId')
      expect(res2).toHaveProperty('sentinelId')
      expect(res3).toHaveProperty('sentinelId')

      const list = listSentinels(sessionId)
      expect(list.length).toBe(3)

      // A quarta deve falhar pelo limite
      const res4 = await startSentinel(sessionId, 'echo 4', '.')
      expect(res4).toHaveProperty('erro')
      expect((res4 as any).erro).toContain('Limite de 3 sentinelas simultâneas atingido')

      // Parar todas
      stopSentinels(sessionId)
      expect(listSentinels(sessionId).length).toBe(0)
    })

    it('deve simular o fluxo "erro -> pendência -> sim -> Prometeu"', () => {
      const sessionId = 'session-flow-test'

      // 1. Simular erro detectado pela sentinela (gera a pendência)
      setPendingSentinelDebug(sessionId, {
        sentinelId: 'sentinel-flow',
        command: 'npm run build',
        logSnippet: 'SyntaxError: Unexpected token'
      })

      // 2. Simular entrada do usuário respondendo "sim" / "depura" no próximo turno
      const userText = 'sim, depura por favor'

      const checkInterception = (text: string, sid: string) => {
        const pend = getPendingSentinelDebug(sid)
        const isAffirmative = /^(sim|s|isso|claro|pode|confirmo|certo|ok|positivo|com certeza|exato|exatamente|vai|manda|beleza|ta|por favor|faz|faca|quero|isso ai)/i.test(text.trim())
        const isDebugWord = /(depura|corrija|conserta|resolve)/i.test(text.trim())

        if (pend && (isAffirmative || isDebugWord)) {
          clearPendingSentinelDebug(sid)
          return {
            shouldIntercept: true,
            action: {
              tipo: 'subagente.depurar',
              objetivo: `Corrigir erro no processo: ${pend.command}`,
              logs_erro: pend.logSnippet
            }
          }
        }
        return { shouldIntercept: false }
      }

      const interceptResult = checkInterception(userText, sessionId)
      expect(interceptResult.shouldIntercept).toBe(true)
      expect(interceptResult.action?.tipo).toBe('subagente.depurar')
      expect(interceptResult.action?.logs_erro).toBe('SyntaxError: Unexpected token')

      // Verificar que limpou a pendência
      expect(getPendingSentinelDebug(sessionId)).toBeUndefined()
    })
  })
})
