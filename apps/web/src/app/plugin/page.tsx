'use client'

import { createAIGatewayClient } from '@supermind/sdk'
import type { AgentMcpServerStatus } from '@supermind/sdk'
import Image, { type StaticImageData } from 'next/image'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ProtectedUserPage } from '../../components/protected-user-page'
import { useAuthenticationFailure } from '../../components/use-authentication-failure'
import { cn } from '../../lib/cn'
import context7Logo from '../../config/Context7_192.png'
import deepWikiLogo from '../../config/DeepWiki_Logo_1024.png'
import qichachaLogo from '../../config/企查查_Logo_93.png'
import { mcpConnectionLabel, replaceMcpServerStatus } from './mcp-settings-state'

const client = createAIGatewayClient()

const MCP_LOGOS: Readonly<Record<string, { alt: string; src: StaticImageData }>> = {
  context7: { alt: 'Context7', src: context7Logo },
  deepwiki: { alt: 'DeepWiki', src: deepWikiLogo },
  qichacha: { alt: '企查查', src: qichachaLogo },
}

const PLUGIN_CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'development', label: '开发工具' },
  { id: 'business', label: '商业运营' },
  { id: 'travel', label: '旅行出行' },
  { id: 'other', label: '其他' },
] as const

type PluginCategoryId = (typeof PLUGIN_CATEGORIES)[number]['id']

const PLUGIN_CATEGORY_BY_ID: Readonly<Record<string, Exclude<PluginCategoryId, 'all' | 'other'>>> =
  {
    context7: 'development',
    deepwiki: 'development',
    'qcc-company': 'business',
    'rollinggo-hotel': 'travel',
    'rollinggo-flight': 'travel',
    'amap-maps': 'travel',
  }

export default function McpSettingsPage() {
  return (
    <ProtectedUserPage>
      <McpSettings />
    </ProtectedUserPage>
  )
}

function McpSettings() {
  const handleAuthenticationFailure = useAuthenticationFailure()
  const [servers, setServers] = useState<AgentMcpServerStatus[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [category, setCategory] = useState<PluginCategoryId>('all')

  const load = useCallback(async () => {
    setLoadState('loading')
    setError('')
    try {
      setServers(await client.agent.mcp.servers())
      setLoadState('ready')
    } catch (cause) {
      if (handleAuthenticationFailure(cause)) return
      setError(errorMessage(cause, 'MCP 配置加载失败，请重试。'))
      setLoadState('error')
    }
  }, [handleAuthenticationFailure])

  useEffect(() => {
    void load()
  }, [load])

  async function setEnabled(server: AgentMcpServerStatus, enabled: boolean) {
    if (savingId) return
    setSavingId(server.id)
    setError('')
    try {
      const updated = await client.agent.mcp.update(server.id, { enabled })
      setServers((current) => replaceMcpServerStatus(current, updated))
    } catch (cause) {
      if (handleAuthenticationFailure(cause)) return
      setError(errorMessage(cause, `${server.name} 的设置保存失败，请重试。`))
    } finally {
      setSavingId(null)
    }
  }

  const enabledCount = useMemo(() => servers.filter((server) => server.enabled).length, [servers])
  const toolCount = useMemo(
    () => servers.reduce((total, server) => total + server.registeredToolCount, 0),
    [servers],
  )
  const visibleServers = useMemo(
    () =>
      category === 'all'
        ? servers
        : servers.filter((server) => pluginCategory(server) === category),
    [category, servers],
  )

  if (loadState === 'loading') return <PluginPageLoading />

  return (
    <main className="min-h-screen px-8 py-10 lg:px-12 lg:py-12">
      <div className="mx-auto w-full max-w-[70rem]">
        <header className="relative overflow-hidden rounded-[2rem] border border-line/80 bg-surface-card/72 px-8 py-9 shadow-[0_30px_90px_rgb(45_60_105/0.12)] backdrop-blur-2xl dark:border-line-soft dark:bg-surface-card/50">
          <CircuitBackdrop />
          <div className="relative max-w-3xl">
            <p className="font-mono text-[0.66rem] font-bold tracking-[0.2em] text-brand uppercase">
              Agent plugins
            </p>
            <p className="mt-5 max-w-2xl text-[0.92rem] leading-7 text-ink-secondary dark:text-ink-dark-muted">
              管理平台内置插件。关闭后，新的 Agent 任务不会连接该服务，也不会看到它的工具；
              已经开始的任务保持原有能力不变。
            </p>
          </div>
          <div className="relative mt-8 flex flex-wrap gap-3">
            <Metric label="已启用" value={`${enabledCount} / ${servers.length || '—'}`} />
            <Metric label="当前可用工具" value={loadState === 'ready' ? String(toolCount) : '—'} />
          </div>
        </header>

        {error ? (
          <div
            role="alert"
            className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-danger/20 bg-danger/7 px-5 py-4 text-sm text-danger dark:bg-danger/10"
          >
            <span>{error}</span>
            {loadState === 'error' ? (
              <button
                type="button"
                onClick={() => void load()}
                className="shrink-0 rounded-xl border border-danger/25 px-3 py-1.5 font-bold hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-brand-focus"
              >
                重新加载
              </button>
            ) : null}
          </div>
        ) : null}

        <section className="mt-7" aria-labelledby="built-in-plugin-title">
          <div className="mb-4 flex items-end justify-between gap-4 px-1">
            <div>
              <h2
                id="built-in-plugin-title"
                className="font-display text-xl font-semibold tracking-[-0.03em]"
              >
                内置插件
              </h2>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="插件分类"
            className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {PLUGIN_CATEGORIES.map((item) => {
              const selected = item.id === category
              return (
                <button
                  key={item.id}
                  id={`plugin-category-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="plugin-catalog"
                  onClick={() => setCategory(item.id)}
                  className={cn(
                    'shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-2',
                    selected
                      ? 'bg-ink text-white shadow-sm dark:bg-white dark:text-[#251e32]'
                      : 'text-ink-faint hover:bg-surface-inset hover:text-ink-secondary dark:hover:bg-white/8 dark:hover:text-ink-dark-muted',
                  )}
                >
                  {item.label}
                </button>
              )
            })}
          </div>

          {visibleServers.length === 0 ? (
            <div className="rounded-[1.6rem] border border-dashed border-line bg-surface-card/55 px-8 py-14 text-center dark:border-line-soft">
              <h3 className="font-display text-lg font-semibold">
                {servers.length === 0 ? '暂时没有内置插件' : '该分类暂时没有插件'}
              </h3>
              <p className="mt-2 text-sm text-ink-faint">
                {servers.length === 0
                  ? '平台配置插件后，它们会自动出现在这里。'
                  : '试试切换到其他分类。'}
              </p>
            </div>
          ) : (
            <div
              id="plugin-catalog"
              role="tabpanel"
              aria-labelledby={`plugin-category-${category}`}
              className="grid gap-4 md:grid-cols-2"
            >
              {visibleServers.map((server) => (
                <McpServerCard
                  key={server.id}
                  server={server}
                  saving={savingId === server.id}
                  disabled={savingId !== null && savingId !== server.id}
                  onToggle={(enabled) => void setEnabled(server, enabled)}
                />
              ))}
            </div>
          )}
        </section>

        <footer className="mt-7 flex items-start gap-3 rounded-2xl border border-line/70 bg-surface-card/45 px-5 py-4 text-xs leading-5 text-ink-faint dark:border-line-soft">
          <ShieldIcon />
          <p>
            插件地址、认证信息和远端工具白名单由平台维护，不会发送到浏览器。用户设置按账户隔离，
            匿名账户更换后不会继承之前的开关。
          </p>
        </footer>
      </div>
    </main>
  )
}

function pluginCategory(server: AgentMcpServerStatus): Exclude<PluginCategoryId, 'all'> {
  return PLUGIN_CATEGORY_BY_ID[server.id] ?? 'other'
}

function McpServerCard({
  server,
  saving,
  disabled,
  onToggle,
}: Readonly<{
  server: AgentMcpServerStatus
  saving: boolean
  disabled: boolean
  onToggle(enabled: boolean): void
}>) {
  const connectionLabel = mcpConnectionLabel(server)
  const healthy = server.status === 'ready'
  const logo =
    MCP_LOGOS[server.id] ?? (server.name.includes('企查查') ? MCP_LOGOS.qichacha : undefined)

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-[1.6rem] border bg-surface-card/78 p-6 shadow-[0_18px_55px_rgb(42_58_98/0.08)] transition-[border-color,transform,opacity] duration-200 motion-reduce:transition-none dark:bg-surface-card/55',
        server.enabled
          ? 'border-brand/22 hover:-translate-y-0.5 hover:border-brand/40'
          : 'border-line/75 opacity-72 dark:border-line-soft',
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-px',
          server.enabled
            ? 'bg-gradient-to-r from-transparent via-brand/70 to-transparent'
            : 'bg-line',
        )}
      />
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'grid size-12 shrink-0 place-items-center rounded-2xl border font-mono text-xs font-black tracking-[-0.04em]',
            server.enabled
              ? 'border-brand/20 bg-brand/10 text-brand-hover dark:text-brand-light'
              : 'border-line bg-surface-inset text-ink-faint dark:border-line-soft',
          )}
        >
          {logo ? (
            <Image src={logo.src} alt={logo.alt} className="size-7 object-contain" />
          ) : (
            <span aria-label={server.name}>MCP</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-lg font-semibold tracking-[-0.03em]">
              {server.name}
            </h3>
            <span
              className={cn(
                'size-1.5 rounded-full',
                !server.enabled
                  ? 'bg-ink-faint/45'
                  : healthy
                    ? 'bg-success shadow-[0_0_0_4px_rgb(39_174_96/0.1)]'
                    : 'bg-danger',
              )}
            />
          </div>
          <p className="mt-1 font-mono text-[0.62rem] text-ink-faint">
            {connectionLabel} · v{server.version}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={server.enabled}
          aria-label={`${server.enabled ? '禁用' : '启用'} ${server.name}`}
          disabled={saving || disabled}
          onClick={() => onToggle(!server.enabled)}
          className={cn(
            'relative h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-3 disabled:cursor-wait disabled:opacity-55',
            server.enabled
              ? 'border-[#20a95a] bg-[#20a95a] hover:border-[#178746] hover:bg-[#178746] dark:border-[#30d158] dark:bg-[#30d158] dark:hover:border-[#35dc66] dark:hover:bg-[#35dc66]'
              : 'border-line bg-surface-inset dark:border-line-soft',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 grid size-5 place-items-center rounded-full bg-white shadow-sm transition-transform',
              server.enabled ? 'translate-x-[1.35rem]' : 'translate-x-0.5',
            )}
          >
            {saving ? (
              <span className="size-2.5 animate-spin rounded-full border border-brand border-t-transparent" />
            ) : null}
          </span>
        </button>
      </div>

      <p className="mt-5 min-h-12 text-[0.82rem] leading-6 text-ink-secondary dark:text-ink-dark-muted">
        {server.description}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2 border-t border-line-soft pt-4">
        <ServerDatum label="平台允许" value={`${server.allowedToolCount} 个工具`} />
        <ServerDatum
          label="本次可用"
          value={server.enabled ? `${server.registeredToolCount} 个工具` : '未连接'}
        />
      </div>
    </article>
  )
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-36 rounded-2xl border border-line/75 bg-white/45 px-4 py-3 backdrop-blur dark:border-line-soft dark:bg-white/[0.035]">
      <span className="block text-[0.62rem] font-semibold text-ink-faint">{label}</span>
      <strong className="mt-1 block font-mono text-sm text-ink-secondary dark:text-ink">
        {value}
      </strong>
    </div>
  )
}

function ServerDatum({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <span className="block text-[0.6rem] text-ink-faint">{label}</span>
      <strong className="mt-1 block text-xs font-semibold text-ink-secondary dark:text-ink">
        {value}
      </strong>
    </div>
  )
}

function PluginPageLoading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="grid min-h-screen place-items-center px-8 py-10 lg:px-12 lg:py-12"
    >
      <div className="w-full max-w-sm rounded-[1.75rem] border border-line/80 bg-surface-card/72 px-8 py-10 text-center shadow-[0_24px_70px_rgb(45_60_105/0.1)] backdrop-blur-2xl dark:border-line-soft dark:bg-surface-card/50">
        <span
          aria-hidden="true"
          className="mx-auto block size-8 animate-spin rounded-full border-2 border-brand/20 border-t-brand motion-reduce:animate-none"
        />
        <p className="mt-5 font-display text-lg font-semibold tracking-[-0.03em]">正在加载插件</p>
        <p className="mt-2 text-sm text-ink-faint">正在同步可用插件与当前设置。</p>
      </div>
    </main>
  )
}

function CircuitBackdrop() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 720 280"
      className="pointer-events-none absolute top-0 right-0 h-full w-[60%] opacity-40 dark:opacity-25"
    >
      <defs>
        <linearGradient id="mcp-line" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="currentColor" stopOpacity="0" />
          <stop offset=".48" stopColor="currentColor" stopOpacity=".55" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".08" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#mcp-line)" strokeWidth="1.2" className="text-brand">
        <path d="M720 48H540l-48 48H322" />
        <path d="M720 132H590l-58 58H382" />
        <path d="M720 224H520l-36-36H266" />
      </g>
      <g fill="currentColor" className="text-brand">
        <circle cx="492" cy="96" r="4" />
        <circle cx="532" cy="190" r="4" />
        <circle cx="484" cy="188" r="4" />
      </g>
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-brand"
    >
      <path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
