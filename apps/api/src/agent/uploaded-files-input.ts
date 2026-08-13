const FILES_START = '[[supermind-files]]'
const FILES_END = '[[/supermind-files]]'

interface UploadedFileMetadata {
  name?: unknown
  path?: unknown
}

/** 将前端用于渲染附件卡片的消息编码，转换成模型可执行的文件路径说明。 */
export function prepareAgentInput(input: string): string {
  const start = input.indexOf(FILES_START)
  const end = input.indexOf(FILES_END, start + FILES_START.length)
  if (start < 0 || end < start) return input

  try {
    const files = JSON.parse(
      input.slice(start + FILES_START.length, end),
    ) as unknown
    if (!Array.isArray(files)) return input

    const paths = files
      .map((file) => {
        if (!file || typeof file !== 'object') return null
        const metadata = file as UploadedFileMetadata
        return typeof metadata.path === 'string' && metadata.path.trim()
          ? `- ${typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim() : metadata.path.trim()}: ${metadata.path.trim()}`
          : null
      })
      .filter((path): path is string => path !== null)

    const prompt = input.slice(end + FILES_END.length).trim()
    if (paths.length === 0) return prompt
    return `Uploaded files in the Sandbox:\n${paths.join('\n')}\n\nUser request:\n${prompt}`
  } catch {
    return input
  }
}
