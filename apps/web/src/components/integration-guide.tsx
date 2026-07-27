'use client'

import { useState } from 'react'

import { cn } from '../lib/cn'

const curlExample = `curl -N 'http://localhost:3000/api/v1/chat/completions' \\
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
  }'`

const sdkExample = `import { createAIGatewayClient } from '@supermind/sdk'

const gateway = createAIGatewayClient()

const events = gateway.chat.stream({
  model: 'qwen',
  messages: [
    { role: 'user', content: '解释什么是统一模型网关' },
  ],
  stream: true,
  maxTokens: 512,
})

for await (const event of events) {
  if (event.type === 'delta') console.log(event.content)
  if (event.type === 'usage') console.log(event.usage)
}`

const focusRing =
  'focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-3'

function GuidePanel({
  code,
  command,
  description,
  index,
  language,
  title,
}: Readonly<{
  code: string
  command: string
  description: string
  index: string
  language: string
  title: string
}>) {
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <article className="liquid-glass min-w-0 rounded-[2rem] p-5 sm:p-6">
      <div className="flex items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-subtle font-mono text-[0.62rem] font-extrabold text-brand">
          {index}
        </span>
        <div>
          <p className="liquid-label text-[0.54rem]">{language}</p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight">{title}</h3>
        </div>
      </div>
      <p className="mt-5 min-h-[3.2rem] text-[0.76rem] leading-relaxed text-ink-muted">
        {description}
      </p>
      <div className="relative z-1 mt-5 overflow-hidden rounded-2xl border border-[#d7e2ef] bg-[#142033] shadow-[0_18px_38px_rgb(20_32_51/0.14)]">
        <div className="flex min-h-[2.65rem] items-center justify-between gap-4 border-b border-white/10 px-3.5 font-mono text-[0.56rem] text-[#91a2bb]">
          <span>{command}</span>
          <button
            type="button"
            onClick={() => void copyCode()}
            className={cn(
              'rounded-lg px-2 py-1.5 text-[#c8d6e9] transition-[background,color] hover:bg-white/10 hover:text-white',
              focusRing,
            )}
          >
            {copied ? '已复制' : '复制代码'}
          </button>
        </div>
        <pre className="m-0 min-h-96 overflow-x-auto p-4 font-mono text-[0.66rem] leading-relaxed whitespace-pre text-[#dce7f5] [tab-size:2]">
          <code>{code}</code>
        </pre>
      </div>
    </article>
  )
}

export function IntegrationGuide() {
  return (
    <section
      id="integration"
      className="relative mx-auto max-w-[82rem] px-5 py-24 sm:px-8 lg:px-12 lg:py-32"
    >
      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[0.7fr_1.3fr_1fr]">
        <p className="liquid-label flex items-center gap-3">从体验到接入</p>
        <h2 className="-mt-1 font-display text-[clamp(2.1rem,4vw,3.8rem)] leading-tight font-semibold tracking-[-0.045em]">
          用你熟悉的方式，
          <br />
          发出第一条请求。
        </h2>
        <div className="grid grid-cols-[auto_1fr] gap-3 pt-0.5">
          <span className="rounded-lg bg-brand-subtle px-2 py-1 font-mono text-[0.55rem] font-extrabold tracking-wider text-brand">
            AUTH
          </span>
          <p className="text-[0.78rem] leading-relaxed text-ink-muted">
            Chat、文生图和 Prompt 优化均需要 GitHub 登录。下方示例使用同一个用户会话。
          </p>
        </div>
      </div>

      <div className="mt-16 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GuidePanel
          index="HTTP"
          language="Terminal / cURL"
          title="直接调用流式接口"
          description="适合调试协议或从任意服务端接入。-N 会关闭 cURL 缓冲，让 SSE 内容逐段显示。"
          command="POST /api/v1/chat/completions"
          code={curlExample}
        />
        <GuidePanel
          index="SDK"
          language="TypeScript"
          title="通过统一 SDK 调用"
          description="适合仓库内的 Web 应用。SDK 负责解析 SSE、校验 [DONE]，并返回带类型的事件。"
          command="@supermind/sdk · workspace"
          code={sdkExample}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 items-center gap-8 rounded-2xl border border-white/70 bg-white/40 p-5 text-[0.64rem] leading-relaxed text-ink-muted backdrop-blur-xl md:grid-cols-[1fr_1fr_auto]">
        <p className="m-0 flex gap-2.5">
          <span className="font-mono text-brand">01</span>
          先完成 GitHub 登录，浏览器调用会自动携带 HttpOnly Session Cookie。
        </p>
        <p className="m-0 flex gap-2.5">
          <span className="font-mono text-brand">02</span>
          服务端调用请安全传递会话 Cookie；不要把 Cookie、模型 Key 写入前端代码。
        </p>
        <a
          href="/api/docs"
          className="inline-flex w-max items-center gap-2 border-b border-brand/30 pb-1 font-bold text-ink-secondary hover:border-brand hover:text-brand"
        >
          查看完整 API 文档 <span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  )
}
