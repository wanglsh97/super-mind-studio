import type { AgentSkillFileEntry } from '@supermind/sdk'

export const SKILL_OBJECT_STORE_PORT = Symbol('SKILL_OBJECT_STORE_PORT')

export type SkillStoredObjectKind = 'skill-package' | 'user-input' | 'user-output'

export interface SkillStoredObjectMetadata {
  objectKey: string
  kind: SkillStoredObjectKind
  contentType: string
  sizeBytes: number
  sha256: string
  updatedAt: string
}

export interface StoredSkillPackage {
  metadata: SkillStoredObjectMetadata & { kind: 'skill-package' }
  archive: Uint8Array
  /** 已完成结构检查的根 SKILL.md 文本。 */
  skillMarkdown: string
  /** 安全、稳定排序的包目录投影，不包含文件正文。 */
  files: AgentSkillFileEntry[]
}

export interface StoredUserFile {
  metadata: SkillStoredObjectMetadata & { kind: 'user-input' | 'user-output' }
  fileName: string
  bytes: Uint8Array
}

export interface WriteUserFileInput {
  objectKey: string
  direction: 'input' | 'output'
  fileName: string
  contentType: string
  bytes: Uint8Array
  signal?: AbortSignal
}

/**
 * Skill 与 Agent 文件使用的私有对象存储边界。
 *
 * 生产 Adapter 可以在内部组合 OSS 对象与持久化的检查结果，但不得向调用方暴露
 * OSS 凭证、签名 URL 或厂商响应类型。
 */
export interface SkillObjectStorePort {
  statObject(objectKey: string, signal?: AbortSignal): Promise<SkillStoredObjectMetadata | null>
  loadSkillPackage(objectKey: string, signal?: AbortSignal): Promise<StoredSkillPackage | null>
  loadUserFile(objectKey: string, signal?: AbortSignal): Promise<StoredUserFile | null>
  writeUserFile(input: WriteUserFileInput): Promise<StoredUserFile>
  deleteObject(objectKey: string, signal?: AbortSignal): Promise<void>
}
