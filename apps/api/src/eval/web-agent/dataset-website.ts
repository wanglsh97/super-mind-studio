import type { AgentEvalExample } from './dataset-general'

function example(
  prompt: string,
  expectedTrajectory: string[],
  referenceAnswer: string,
  maxLatencyMs = 600_000,
): AgentEvalExample {
  return {
    inputs: { prompt, expectedTrajectory: [...expectedTrajectory] },
    outputs: {
      expectedTrajectory: [...expectedTrajectory],
      referenceAnswer,
      maxLatencyMs,
    },
    metadata: { kind: 'web-agent', suite: 'website' },
  }
}

/**
 * website suite 手工例子（显式 `--suite=website` 才跑）。
 * 轨迹期望保持宽松子序列，避免绑定易变的内部工具名过多。
 */
export const WEBSITE_AGENT_EVAL_EXAMPLES: readonly AgentEvalExample[] = [
  example(
    `你正在 website 建站模式。不要向用户提问、不要调用 ask_user_question。
直接用中文给出一个「个人作品集」落地页的 3 段文案大纲（标题+一句话说明）。`,
    [],
    '回答应给出个人作品集落地页的三段文案大纲。',
  ),
  example(
    `帮我规划一个单页个人作品集网站的信息架构（中文）。
若需要外部资料可用 web_search；完成后给出 3 个区块标题即可，不必真正写完整站代码。`,
    [],
    '回答应给出清晰的作品集站点区块/信息架构（至少若干标题）。',
  ),
  example(
    `使用 web_search 检索「personal portfolio website structure」，
然后用中文给出适合个人作品集的 4 个页面区块建议。`,
    ['web_search'],
    '回答应包含基于搜索的页面/区块建议。',
  ),
  example(
    `抓取 https://example.com/ 作为极简参考页，用中文说明若改成作品集首页会保留哪些元素。
至少调用一次 web_fetch。`,
    ['web_fetch'],
    '回答应结合 example.com 页面元素给出作品集首页取舍。',
  ),
]
