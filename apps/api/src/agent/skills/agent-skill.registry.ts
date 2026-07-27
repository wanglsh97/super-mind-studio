export interface AgentSkillCandidate {
  id: string
  name: string
  description: string
}

/** Legacy repository-owned descriptor retained until migration task 7.1 removes the old catalog. */
export interface AgentSkillDescriptor extends AgentSkillCandidate {
  version: string
  category: string
  instructions: string
  allowedTools: readonly string[]
}

export interface AgentSkillRegistry {
  listCandidates(userId: string): Promise<readonly AgentSkillCandidate[]>
}

export const AGENT_SKILL_REGISTRY = Symbol('AGENT_SKILL_REGISTRY')
