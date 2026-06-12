// Ponto de montagem do registro de ferramentas. Cada categoria registra suas
// commands aqui — para adicionar uma ferramenta nova basta criar/expandir um
// módulo de categoria e incluí-lo em `createDefaultRegistry`.

import { CommandRegistry } from './types'
import { brainCommands } from './brainCommands'
import { briefingCommands } from './briefingCommands'
import { codeExecCommands } from './codeExecCommands'
import { codeQualityCommands } from './codeQualityCommands'
import { codeReadCommands } from './codeReadCommands'
import { codeWriteCommands } from './codeWriteCommands'
import { conversationCommands } from './conversationCommands'
import { hiveCommands } from './hiveCommands'
import { systemCommands } from './systemCommands'

export { CommandRegistry } from './types'
export type { ToolCommand, ToolContext, ToolCategory } from './types'
export { dispatchCommand } from './dispatcher'
export type { DispatchContext } from './dispatcher'

export function createDefaultRegistry(): CommandRegistry {
  return new CommandRegistry()
    .registerAll(conversationCommands)
    .registerAll(systemCommands)
    .registerAll(brainCommands)
    .registerAll(codeReadCommands)
    .registerAll(codeExecCommands)
    .registerAll(codeWriteCommands)
    .registerAll(codeQualityCommands)
    .registerAll(hiveCommands)
    .registerAll(briefingCommands)
}

// Instância padrão usada pelo router. Tests podem criar um registry separado e
// chamar `dispatchCommand(localRegistry, ...)` para isolar.
export const defaultRegistry = createDefaultRegistry()


