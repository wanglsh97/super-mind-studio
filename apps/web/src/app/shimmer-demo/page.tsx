import ShimmerText from '@/components/shimmer-text'

export default function ShimmerDemoPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-surface p-6">
      <section className="w-full max-w-xl">
        <p className="font-mono text-xs tracking-[0.16em] text-ink-subtle">MOTION STUDY</p>
        <div className="mt-5 rounded-2xl border border-line bg-surface-card px-7 py-8 shadow-[0_18px_50px_rgb(60_60_67/0.08)]">
          <p className="text-sm text-ink-muted">Agent 正在处理你的请求</p>
          <ShimmerText className="mt-3 block text-2xl font-medium tracking-tight">
            等待模型响应
          </ShimmerText>
        </div>
        <p className="mt-4 text-sm leading-6 text-ink-subtle">
          高光从左向右经过文字；其余时间保持稳定。
        </p>
      </section>
    </main>
  )
}
