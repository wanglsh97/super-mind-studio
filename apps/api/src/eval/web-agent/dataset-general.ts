export interface AgentEvalExample {
  inputs: {
    prompt: string
    expectedTrajectory: string[]
  }
  outputs: {
    expectedTrajectory: string[]
    referenceAnswer: string
    maxLatencyMs: number
  }
  metadata: { kind: 'web-agent'; suite: 'general' | 'website' }
}

function example(
  prompt: string,
  expectedTrajectory: string[],
  referenceAnswer: string,
  maxLatencyMs = 180_000,
): AgentEvalExample {
  return {
    inputs: { prompt, expectedTrajectory: [...expectedTrajectory] },
    outputs: {
      expectedTrajectory: [...expectedTrajectory],
      referenceAnswer,
      maxLatencyMs,
    },
    metadata: { kind: 'web-agent', suite: 'general' },
  }
}

/** general suite：偏 web_search / web_fetch，约 8 条手工例子。 */
export const GENERAL_AGENT_EVAL_EXAMPLES: readonly AgentEvalExample[] = [
  example(
    `优先使用 web_search 工具完成任务（可以额外调用其它工具，但至少要搜索一次）。
搜索关键词：OpenTelemetry Tempo。
用中文两句话总结最相关的一点。`,
    ['web_search'],
    '回答应基于网页搜索，提及 Tempo 作为分布式追踪后端或类似要点。',
  ),
  example(
    `优先使用 web_search 工具完成任务（可以额外调用其它工具，但至少要搜索一次）。
搜索关键词：LangSmith evaluation dataset。
用中文一句话说明一个核心能力。`,
    ['web_search'],
    '回答应提到 Dataset、Experiment、evaluator 或离线评测等相关能力之一。',
  ),
  example(
    `优先使用 web_search 工具完成任务（可以额外调用其它工具，但至少要搜索一次）。
搜索关键词：PostgreSQL JSONB。
用一句话说明 JSONB 是什么。`,
    ['web_search'],
    '回答应说明 JSONB 是 PostgreSQL 的二进制 JSON 存储类型或等价表述。',
  ),
  example(
    `优先使用 web_search 工具完成任务（可以额外调用其它工具，但至少要搜索一次）。
搜索关键词：Server-Sent Events。
用一句话说明 SSE 的用途。`,
    ['web_search'],
    '回答应提到服务器向客户端推送事件流或实时更新。',
  ),
  example(
    `请使用 web_fetch 抓取 https://example.com/ （可以额外调用其它工具，但至少 fetch 一次）。
用中文一句话概括页面主题。`,
    ['web_fetch'],
    '回答应概括 example.com 示例域页面（例如 Example Domain）。',
  ),
  example(
    `请先 web_search 搜索 example.com，再 web_fetch https://example.com/ ，然后用中文两句话说明页面内容。
允许额外工具，但轨迹中至少按顺序出现这两次调用。`,
    ['web_search', 'web_fetch'],
    '回答应结合搜索与 example.com 页面内容，提到 Example Domain 或示例域。',
  ),
  example(
    `请先 web_search 搜索 IANA example domains，再 web_fetch https://example.com/ ，说明该域用途。
允许额外工具，但轨迹中至少按顺序出现 search 然后 fetch。`,
    ['web_search', 'web_fetch'],
    '回答应说明 example.com 用于文档示例等用途。',
  ),
  example(
    `请使用 web_fetch 抓取 https://example.com/ ，提取页面主标题或主文案。
允许额外工具，但至少 fetch 一次。`,
    ['web_fetch'],
    '回答应包含 Example Domain 或与 example.com 页面主文案一致的内容。',
  ),
]
