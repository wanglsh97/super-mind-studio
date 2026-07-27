'use client'

import { useState } from 'react'

import { cn } from '../../lib/cn'

type ExampleKind = 'sdk' | 'curl'

const examples: Record<ExampleKind, { label: string; meta: string; code: string }> = {
  sdk: {
    label: 'TypeScript SDK',
    meta: '@supermind/sdk',
    code: `import { createAIGatewayClient } from '@supermind/sdk'

const gateway = createAIGatewayClient()

for await (const event of gateway.chat.stream({
  model: 'qwen',
  messages: [
    { role: 'user', content: '解释什么是统一模型网关' },
  ],
  stream: true,
  maxTokens: 512,
})) {
  if (event.type === 'delta') process.stdout.write(event.content)
  if (event.type === 'usage') console.log(event.usage)
}`,
  },
  curl: {
    label: 'cURL',
    meta: 'POST · SSE',
    code: `curl -N '/api/v1/chat/completions' \\
  -H 'Accept: text/event-stream' \\
  -H 'Content-Type: application/json' \\
  -H 'Cookie: aigateway_user_session=<SESSION_COOKIE>' \\
  --data-raw '{
    "model": "qwen",
    "messages": [
      { "role": "user", "content": "解释什么是统一模型网关" }
    ],
    "stream": true,
    "maxTokens": 512
  }'`,
  },
}

const endpoints = [
  {
    method: 'POST',
    path: '/api/v1/chat/completions',
    name: '流式对话',
    detail: 'SSE · 以 data: [DONE] 结束',
  },
  {
    method: 'POST',
    path: '/api/v1/images/generations',
    name: '创建图片任务',
    detail: 'JSON · 返回平台 taskId',
  },
  {
    method: 'GET',
    path: '/api/v1/images/generations/:taskId',
    name: '查询图片任务',
    detail: 'JSON · 支持轮询终态',
  },
  {
    method: 'POST',
    path: '/api/v1/prompts/optimize',
    name: '优化 Prompt',
    detail: 'JSON · expand / simplify / structure',
  },
  {
    method: 'GET',
    path: '/api/v1/models',
    name: '模型列表',
    detail: 'JSON · 别名、能力与健康状态',
  },
]

const methodTone = {
  POST: 'bg-brand-muted text-[#5a43c5]',
  GET: 'bg-[#dcefeb] text-[#26735f]',
}

export default function ApiPage() {
  const [kind, setKind] = useState<ExampleKind>('sdk')
  const [copied, setCopied] = useState(false)
  const example = examples[kind]

  async function copyExample() {
    try {
      await navigator.clipboard.writeText(example.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <main className="mx-auto max-w-[76rem] px-5 py-12 md:px-14 md:py-[6.5rem]">
      <header className="grid grid-cols-1 items-end gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)] lg:gap-16">
        <p className="liquid-label col-span-full mb-4 text-brand">GATEWAY INTERFACE</p>
        <h1 className="m-0 font-display text-[clamp(3rem,6vw,5.6rem)] leading-[0.94] font-semibold tracking-[-0.06em]">
          接入网关，
          <br />
          只选一种方式。
        </h1>
        <p className="mb-1 max-w-[29rem] text-[0.95rem] leading-relaxed text-ink-muted">
          使用仓库内的类型安全 SDK，或直接通过 HTTP 调用同一套网关能力。
        </p>
      </header>

      <section
        className="mt-20 grid grid-cols-1 gap-12 border-t border-line pt-8 lg:grid-cols-[0.62fr_1.38fr] lg:gap-20"
        aria-label="调用示例"
      >
        <div>
          <span className="font-mono text-[0.65rem] font-extrabold tracking-widest text-brand">
            01
          </span>
          <h2 className="mt-3 text-[1.65rem] tracking-tight">发送第一条请求</h2>
          <p className="mt-4 text-[0.82rem] leading-relaxed text-ink-muted">
            Chat 强制使用流式响应。SDK 负责解析 SSE 和终止标记；cURL 使用{' '}
            <code className="font-mono text-[0.9em]">-N</code> 关闭输出缓冲。
          </p>
          <div className="mt-8 grid gap-1 border-l-2 border-coral pl-3.5">
            <strong className="text-[0.68rem]">认证</strong>
            <span className="text-[0.7rem] leading-relaxed text-ink-faint">
              付费能力需要 GitHub 用户 Session。浏览器会自动携带 HttpOnly Cookie。
            </span>
          </div>
        </div>

        <div>
          <div
            className="liquid-glass-soft flex gap-1 rounded-t-2xl border-b-0 p-1.5"
            role="tablist"
            aria-label="接入方式"
          >
            {(Object.keys(examples) as ExampleKind[]).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={kind === value}
                onClick={() => {
                  setKind(value)
                  setCopied(false)
                }}
                className={cn(
                  'grid min-w-36 flex-1 gap-0.5 rounded-xl px-3.5 py-2.5 text-left text-ink-faint md:flex-none',
                  kind === value &&
                    'bg-brand-muted text-brand-hover dark:bg-brand-muted dark:text-brand-light',
                )}
              >
                <span className="text-[0.76rem] font-bold">{examples[value].label}</span>
                <small className="font-mono text-[0.56rem]">{examples[value].meta}</small>
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-b-2xl border border-console-border bg-console text-console-text shadow-[0_20px_50px_rgb(31_23_47/0.14)]">
            <div className="flex items-center justify-between border-b border-console-border px-4 py-3 font-mono text-[0.6rem] tracking-wide text-console-muted">
              <span>{example.meta}</span>
              <button
                type="button"
                onClick={() => void copyExample()}
                className="rounded-md border border-[#44395f] px-2.5 py-1.5 text-[#c5b9d3] hover:border-brand hover:text-white"
              >
                {copied ? '已复制' : '复制代码'}
              </button>
            </div>
            <pre className="m-0 min-h-[25rem] overflow-auto p-5 font-mono text-[0.72rem] leading-relaxed">
              <code>{example.code}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="mt-20" aria-labelledby="api-reference-title">
        <div className="flex items-start gap-5">
          <span className="font-mono text-[0.65rem] font-extrabold tracking-widest text-brand">
            02
          </span>
          <div>
            <h2 id="api-reference-title" className="m-0 text-[1.65rem] tracking-tight">
              能力端点
            </h2>
            <p className="mt-1.5 text-xs text-ink-faint">
              所有浏览器请求始终使用同源 <code className="font-mono text-[0.9em]">/api</code>。
            </p>
          </div>
        </div>
        <div className="liquid-glass-soft mt-7 overflow-hidden rounded-[1.6rem] px-5">
          {endpoints.map((endpoint) => (
            <article
              key={`${endpoint.method}-${endpoint.path}`}
              className="grid grid-cols-[3.7rem_minmax(0,1fr)] items-center gap-4 border-b border-line py-4 md:grid-cols-[4.4rem_minmax(15rem,1fr)_minmax(13rem,0.7fr)]"
            >
              <span
                className={cn(
                  'w-fit rounded-md px-1.5 py-1 font-mono text-[0.58rem] font-extrabold',
                  methodTone[endpoint.method as keyof typeof methodTone],
                )}
              >
                {endpoint.method}
              </span>
              <code className="text-[0.72rem] text-ink-secondary dark:text-[#eee9f8]">
                {endpoint.path}
              </code>
              <div className="col-start-2 grid gap-0.5 md:col-start-3">
                <strong className="text-[0.76rem]">{endpoint.name}</strong>
                <small className="text-[0.66rem] text-ink-faint">{endpoint.detail}</small>
              </div>
            </article>
          ))}
        </div>
        <a
          className="mt-6 inline-flex items-center gap-2.5 text-[0.76rem] font-bold text-brand-hover dark:text-brand-light"
          href="/api/docs"
        >
          打开 Swagger API 文档 <span aria-hidden="true">↗</span>
        </a>
      </section>
    </main>
  )
}
