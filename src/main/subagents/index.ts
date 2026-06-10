// Colmeia: o Ares (Manager) despacha tarefas a subagentes especialistas (Workers)
// que devolvem relatórios técnicos; o Ares sintetiza e fala com o usuário.
export type { SubagentProfile, SubagentResult, SubagentTask } from './types'
export { RESEARCHER, ENGINEER, AUDITOR, SUBAGENT_PROFILES, getSubagentProfile } from './profiles'
export { executeSubagentTask, buildTaskPrompt, relevantMemories, summarizeReport, type HiveStatusFn } from './executor'
