import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Conversation from '../src/renderer/components/Conversation'

describe('Conversation', () => {
  it('renderiza timeline de atividades no balão do Ares', () => {
    const html = renderToStaticMarkup(
      <Conversation
        messages={[
          {
            id: 'm1',
            role: 'assistant',
            content: 'Concluído.',
            activities: [
              {
                id: 'act-1',
                kind: 'read',
                status: 'done',
                phase: 1,
                title: 'Lendo arquivo',
                target: 'src/main.ts',
                detail: 'src/main.ts',
                ts: 1,
                ok: true
              },
              {
                id: 'act-2',
                kind: 'command',
                status: 'output',
                phase: 1,
                title: 'Rodando testes',
                command: 'npm test',
                stream: 'stdout',
                output: 'Tests passed',
                ts: 2
              }
            ]
          }
        ]}
      />
    )

    expect(html).toContain('Lendo arquivo')
    expect(html).toContain('src/main.ts')
    expect(html).toContain('Tests passed')
    expect(html).toContain('Concluído.')
  })
})
