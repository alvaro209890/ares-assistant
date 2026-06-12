import { describe, expect, it } from 'vitest'
import { chatDeltaPayload } from '../src/main/ipcPayloads'

describe('ipc payloads', () => {
  it('preserva o marcador done no payload de chat:delta', () => {
    expect(chatDeltaPayload('', 2, 'both', true)).toEqual({
      chunk: '',
      phase: 2,
      kind: 'both',
      done: true
    })
  })
})
