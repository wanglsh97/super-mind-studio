import Link from 'next/link'

import { IntegrationGuide } from '../components/integration-guide'
import { cn } from '../lib/cn'

const focusRing =
  'focus-visible:outline-3 focus-visible:outline-brand focus-visible:outline-offset-4'

function GatewayPrism() {
  const models = [
    { name: 'Qwen', detail: 'STREAM', color: 'bg-[#2764ff]' },
    { name: 'GLM', detail: 'READY', color: 'bg-[#8b7cff]' },
    { name: 'DeepSeek', detail: 'READY', color: 'bg-[#50d8c3]' },
  ]

  return (
    <div
      className="liquid-glass relative min-h-[31rem] overflow-hidden rounded-[2.2rem] p-5 sm:p-7"
      aria-label="请求经 AI Gateway 分发至多个模型"
    >
      <div className="pointer-events-none absolute -top-28 -right-24 size-72 rounded-full bg-[#8b7cff]/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-16 size-72 rounded-full bg-[#50d8c3]/20 blur-3xl" />

      <div className="relative z-1 flex items-center justify-between">
        <span className="liquid-label flex items-center gap-2 text-[0.56rem]">
          <i className="size-1.5 rounded-full bg-mint shadow-[0_0_0_5px_rgb(80_216_195/0.12)]" />
          Gateway online
        </span>
        <span className="rounded-full border border-white/80 bg-white/55 px-3 py-1.5 font-mono text-[0.52rem] tracking-widest text-ink-muted shadow-sm">
          CN · EAST
        </span>
      </div>

      <div className="relative z-1 mt-10 grid min-h-[22rem] grid-cols-[1fr_4.5rem_1fr] items-center gap-3 sm:grid-cols-[1fr_7rem_1fr]">
        <div className="liquid-glass-soft self-start rounded-2xl p-4 sm:p-5">
          <span className="liquid-label text-[0.5rem]">Your request</span>
          <p className="mt-3 text-sm font-semibold text-ink sm:text-base">
            帮我把想法
            <br />
            变成作品
            <span className="ml-1 inline-block h-4 w-0.5 animate-caret-blink rounded bg-brand align-[-0.2rem]" />
          </p>
        </div>

        <div className="relative grid place-items-center">
          <span className="absolute h-px w-[180%] liquid-spectrum opacity-40" />
          <span className="absolute h-[180%] w-px liquid-spectrum opacity-30" />
          <span className="liquid-glass relative grid size-[4.25rem] place-items-center rounded-[1.5rem] text-sm font-black text-brand shadow-[0_18px_40px_rgb(39_100_255/0.2)] sm:size-20">
            SM
          </span>
        </div>

        <div className="grid gap-2.5 self-end">
          {models.map((model) => (
            <div
              key={model.name}
              className="liquid-glass-soft flex min-w-0 items-center gap-2 rounded-xl px-3 py-3"
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', model.color)} />
              <strong className="min-w-0 flex-1 truncate text-[0.68rem] sm:text-xs">
                {model.name}
              </strong>
              <small className="hidden font-mono text-[0.46rem] text-ink-subtle sm:block">
                {model.detail}
              </small>
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-1 mt-2 flex flex-wrap gap-2">
        {['统一协议', '流式响应', '费用可见'].map((item) => (
          <span
            key={item}
            className="rounded-full border border-white/70 bg-white/45 px-3 py-1.5 font-mono text-[0.52rem] text-ink-muted"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function HomePage() {
  return (
    <main className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-24 -right-36 size-[30rem] animate-[liquid-drift_9s_ease-in-out_infinite] rounded-full bg-[#8b7cff]/10 blur-[80px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[35rem] -left-40 size-[28rem] animate-[liquid-drift_11s_ease-in-out_infinite_reverse] rounded-full bg-[#50d8c3]/12 blur-[90px]"
      />

      <section className="relative mx-auto grid min-h-[calc(100svh-72px)] max-w-[82rem] grid-cols-1 items-center gap-14 px-5 py-16 sm:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:gap-20 lg:px-12 lg:py-24">
        <div className="max-w-[43rem]">
          <p className="liquid-label flex items-center gap-3">
            <span className="h-px w-8 liquid-spectrum" />
            SUPER MIND STUDIO
          </p>
          <h1 className="mt-7 font-display text-[clamp(3.4rem,5.8vw,6.3rem)] leading-[0.92] font-semibold tracking-[-0.07em] text-ink">
            想法，穿过
            <br />
            <span className="bg-[linear-gradient(95deg,#2764ff_0%,#8b7cff_52%,#2bbba8_100%)] bg-clip-text text-transparent">
              一层透明界面。
            </span>
          </h1>
          <p className="mt-8 max-w-[36rem] text-[clamp(1rem,1.35vw,1.16rem)] leading-[1.85] text-ink-muted">
            从灵感探索到任务执行，对话、工具、Skill 与模型能力聚合在 Agent
            工作台。你专注表达目标，模型选择、流式传输和费用记录由网关安静处理。
          </p>

          <div className="mt-10">
            <Link
              href="/agent"
              className={cn(
                'liquid-button inline-flex min-h-14 items-center justify-center gap-6 rounded-2xl px-6 text-sm font-bold transition-[transform,box-shadow] hover:-translate-y-0.5',
                focusRing,
              )}
            >
              打开智能体
              <span className="text-lg" aria-hidden="true">
                ↗
              </span>
            </Link>
          </div>

          <div className="mt-12 flex flex-wrap gap-x-6 gap-y-3 text-xs text-ink-muted">
            {['多模型接入', '结果实时返回', '人民币费用估算'].map((item) => (
              <span key={item} className="flex items-center gap-2">
                <i className="size-1 rounded-full bg-brand" />
                {item}
              </span>
            ))}
          </div>
        </div>

        <GatewayPrism />
      </section>

      <IntegrationGuide />

      <section className="mx-auto max-w-[82rem] px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
        <div className="liquid-glass relative overflow-hidden rounded-[2.5rem] px-6 py-20 text-center sm:px-12">
          <div className="pointer-events-none absolute inset-x-[15%] top-0 h-px liquid-spectrum" />
          <p className="liquid-label">Ready when you are</p>
          <h2 className="mx-auto mt-5 max-w-4xl font-display text-[clamp(2.5rem,5vw,5rem)] leading-[1.04] font-semibold tracking-[-0.06em]">
            不必研究每一家模型。
            <br />
            先说你想完成什么。
          </h2>
          <Link
            href="/agent"
            className={cn(
              'liquid-button mt-10 inline-flex min-h-14 items-center gap-6 rounded-2xl px-7 text-sm font-bold',
              focusRing,
            )}
          >
            打开工作台 <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[82rem] flex-col justify-between gap-2 border-t border-line-soft px-5 py-8 font-mono text-[0.6rem] tracking-wide text-ink-muted sm:flex-row sm:px-8 lg:px-12">
        <span>Super Mind Studio</span>
        <span>Ideas, amplified.</span>
      </footer>
    </main>
  )
}
