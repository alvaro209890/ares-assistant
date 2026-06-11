import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const mockAres = vi.hoisted(() => ({
  conversation: [{ id: 'm1', role: 'assistant' as const, content: 'Resposta no chat compartilhado.' }],
  sessions: [{ id: 's1', title: 'Chat principal', updatedAt: Date.now(), messageCount: 1 }],
  currentSessionId: 's1',
  createSession: async () => undefined,
  openSession: async () => undefined,
  renameSession: async () => undefined,
  deleteSession: async () => undefined,
  aresState: 'idle',
  recording: false,
  continuous: false,
  beginPushToTalk: async () => undefined,
  endPushToTalk: async () => undefined,
  sendText: async () => undefined,
  toggleContinuous: () => undefined,
  config: { ui: { wakeWord: 'ares', wakeWordEnabled: false } },
  saveConfig: async () => undefined
}))

vi.mock('../src/renderer/lib/store', () => ({
  useAres: () => mockAres
}))

import ChatPanel from '../src/renderer/components/ChatPanel'

describe('ChatPanel compartilhado', () => {
  it('renderiza conversa, historico, nova conversa, status e controles no mesmo painel', () => {
    const html = renderToStaticMarkup(<ChatPanel title="CONVERSA COM O ARES" status="Atena pesquisando" controls />)

    expect(html).toContain('CONVERSA COM O ARES')
    expect(html).toContain('Atena pesquisando')
    expect(html).toContain('HISTÓRICO (1)')
    expect(html).toContain('NOVA')
    expect(html).toContain('Resposta no chat compartilhado.')
    expect(html).toContain('ENVIAR')
  })
})
