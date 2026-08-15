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

export interface SkillPackageDownload {
  metadata: SkillStoredObjectMetadata & { kind: 'skill-package' }
  url: string
  expiresAt: string
}

export interface UserFileDownload {
  metadata: SkillStoredObjectMetadata & { kind: 'user-input' | 'user-output' }
  url: string
  expiresAt: string
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
 * 生产 Adapter 以 OSS 对象为包内容真源。它只可向 Run 安装链路返回短时、单对象、
 * 只读下载 URL，不得暴露 OSS 管理凭证、持久化该 URL 或泄漏厂商响应类型。
 */
export interface SkillObjectStorePort {
  statObject(objectKey: string, signal?: AbortSignal): Promise<SkillStoredObjectMetadata | null>
  createSkillPackageDownload(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<SkillPackageDownload | null>
  loadSkillPackage(objectKey: string, signal?: AbortSignal): Promise<StoredSkillPackage | null>
  loadUserFile(objectKey: string, signal?: AbortSignal): Promise<StoredUserFile | null>
  createUserFileDownload(
    objectKey: string,
    expiresInSeconds: number,
    signal?: AbortSignal,
  ): Promise<UserFileDownload | null>
  writeUserFile(input: WriteUserFileInput): Promise<StoredUserFile>
  deleteObject(objectKey: string, signal?: AbortSignal): Promise<void>
}
