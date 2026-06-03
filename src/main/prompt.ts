// Mantido apenas para compatibilidade com imports antigos.
// O prompt ativo do agente vive em main/agent.ts e usa o envelope JSON
// { "fala": "...", "acoes": [...] } documentado no README.
export function buildSystemPrompt(boardSummary: string): string {
  return `ARES usa o protocolo JSON atual. Estado atual das tarefas:\n${boardSummary}`
}
