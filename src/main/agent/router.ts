// Roteador de ferramentas: fachada finíssima sobre o `CommandRegistry`.
//
// A partir da v0.37 o despacho deixou de ser um `switch` gigante: cada ferramenta
// vira um `ToolCommand` registrado em src/main/tools/. Este arquivo só mantém o
// contrato `runQuery(a, ctx)` e delega ao `dispatchCommand` com o registro
// padrão, preservando todas as decorations cruzadas (atividade/trace/progresso).

import type { Acao } from '../../shared/types'
import { defaultRegistry } from '../tools/index'
import { dispatchCommand, type DispatchContext } from '../tools/dispatcher'
import type { ToolResult } from './types'

// RouterContext continua exportado para preservar a superfície pública anterior.
// É um alias do DispatchContext (mesmos campos) — quem importa não precisa mudar.
export type RouterContext = DispatchContext

/**
 * Despacha uma ação para a ferramenta correspondente. Sempre devolve um
 * ToolResult — falhas viram `erro` no envelope, nunca propagam como exception.
 * Decora a chamada com activity (start/output/done/error), trace e progresso.
 */
export async function runQuery(a: Acao, ctx: RouterContext): Promise<ToolResult> {
  return dispatchCommand(defaultRegistry, a, ctx)
}
