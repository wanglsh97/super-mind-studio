import { AGENT_DEFAULT_THREAD_TITLE, AGENT_DERIVED_TITLE_MAX_LENGTH } from './agent.constants'

const FILES_START = '[[supermind-files]]'
const FILES_END = '[[/supermind-files]]'
const VIDEO_REFERENCE_PATTERN =
  /\n*\[当前视频首帧资产ID:\s*[0-9a-f-]{36}\]\s*$/i

/**
 * 从用户首条输入派生会话标题：压缩空白，超长截断并加省略号。
 * 空输入回退到默认标题。
 */
export function deriveAgentThreadTitle(input: string): string {
  const normalized = extractPrompt(input)
    .replace(VIDEO_REFERENCE_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length === 0) return AGENT_DEFAULT_THREAD_TITLE
  if (normalized.length <= AGENT_DERIVED_TITLE_MAX_LENGTH) return normalized
  return `${normalized.slice(0, AGENT_DERIVED_TITLE_MAX_LENGTH)}…`
}

function extractPrompt(input: string): string {
  const start = input.indexOf(FILES_START)
  const end = input.indexOf(FILES_END, start + FILES_START.length)
  if (start < 0 || end < start) return input
  return input.slice(end + FILES_END.length)
}
