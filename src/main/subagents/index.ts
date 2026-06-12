// Colmeia: o Ares (Manager) despacha tarefas a subagentes especialistas (Workers)
// que devolvem relatórios técnicos; o Ares sintetiza e fala com o usuário.
export type {
  EvidencePackage,
  EvidenceSection,
  SubagentProblem,
  SubagentProfile,
  SubagentReportTags,
  SubagentResult,
  SubagentTask
} from './types'
export { RESEARCHER, ENGINEER, AUDITOR, DEBUGGER, SUBAGENT_PROFILES, getSubagentProfile } from './profiles'
export {
  executeSubagentTask,
  buildTaskPrompt,
  missingReportTags,
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
