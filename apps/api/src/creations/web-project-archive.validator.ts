import { SkillZipInspectionError, SkillZipInspector } from '../agent/skills/package/skill-zip-inspector'

export class WebProjectArchiveValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'WebProjectArchiveValidationError'
  }
}

export class WebProjectArchiveValidator {
  private readonly zip = new SkillZipInspector(undefined, false)

  async validateSource(archive: Uint8Array): Promise<void> {
    const inspected = await this.inspect(archive)
    const files = new Set(inspected.files.filter((file) => file.type === 'file').map((file) => file.path))
    if (!files.has('package.json')) {
      throw new WebProjectArchiveValidationError('WEB_PROJECT_PACKAGE_MISSING', '源码 ZIP 根目录必须包含 package.json')
    }
    if (!['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'].some((name) => files.has(name))) {
      throw new WebProjectArchiveValidationError('WEB_PROJECT_LOCKFILE_MISSING', '源码 ZIP 根目录必须包含依赖锁文件')
    }
  }

  async validateDist(archive: Uint8Array): Promise<void> {
    const inspected = await this.inspect(archive)
    const files = new Set(inspected.files.filter((file) => file.type === 'file').map((file) => file.path))
    if (!files.has('index.html')) {
      throw new WebProjectArchiveValidationError('WEB_PROJECT_STATIC_ENTRY_MISSING', '构建 ZIP 根目录必须包含 index.html')
    }
  }

  private async inspect(archive: Uint8Array) {
    try {
      return await this.zip.inspect(archive)
    } catch (error) {
      if (error instanceof SkillZipInspectionError) {
        throw new WebProjectArchiveValidationError('WEB_PROJECT_ZIP_INVALID', error.message)
      }
      throw error
    }
  }
}
