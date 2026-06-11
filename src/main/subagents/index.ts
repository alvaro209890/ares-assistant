// Colmeia: o Ares (Manager) despacha tarefas a subagentes especialistas (Workers)
// que devolvem relatórios técnicos; o Ares sintetiza e fala com o usuário.
export type {
  EvidencePackage,
  EvidenceSection,
  SubagentProfile,
  SubagentReportTags,
  SubagentResult,
  SubagentTask
} from './types'
export { RESEARCHER, ENGINEER, AUDITOR, SUBAGENT_PROFILES, getSubagentProfile } from './profiles'
export {
  executeSubagentTask,
  buildTaskPrompt,
  parseReportTags,
  relevantMemories,
  summarizeReport,
  type HiveStatusFn
} from './executor'
export {
  evidenceOf,
  parseGitStatusFiles,
  pickRelevantFiles,
  renderEvidencePackage,
  truncateSmart
} from './evidence'
