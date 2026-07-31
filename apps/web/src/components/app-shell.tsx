'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Suspense, type ReactNode, useEffect, useRef, useState } from 'react'

import type { AgentThreadSummary } from '@supermind/sdk'

import { logoutUser, sanitizeUserReturnTo } from '@/utils/auth/user-auth-client'
import { cn } from '@/utils/cn'
import { AGENT_THREAD_TITLE_MAX_LENGTH } from './agent-workspace-provider'
import {
  AGENT_THREAD_PREVIEW_LIMIT,
  hiddenAgentThreadCount,
  visibleAgentThreads,
} from '@/utils/agent/agent-thread-list'
import { useAgentActiveThreadId } from '@/hooks/use-agent-active-thread-id'
import { useAgentWorkspace } from '@/hooks/use-agent-workspace'
import { BrandMark } from './brand-mark'
import { ThemeToggle } from './theme-toggle'
import { useUserSession } from './user-session-provider'

const focusRing =
  'focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-3'

const shellIconButtonClass =
  'liquid-glass-soft grid size-9 shrink-0 place-items-center rounded-lg text-ink-muted transition-[background,color] hover:bg-surface-muted hover:text-brand-hover dark:hover:text-ink [&_svg]:size-4'

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname()
  if (pathname.startsWith('/admin')) return children
  return <UserWorkspace>{children}</UserWorkspace>
}

function UserWorkspace({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter()
  const pathname = usePathname()
  const session = useUserSession()
  const [collapsed, setCollapsed] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => setAvatarFailed(false), [session.user?.avatarUrl])
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) setCollapsed(true)
  }, [])
  useEffect(() => {
    if (!userMenuOpen) return
    function closeMenu(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof MouseEvent && userMenuRef.current?.contains(event.target as Node)) return
      setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeMenu)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeMenu)
    }
  }, [userMenuOpen])

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logoutUser()
    } finally {
      session.clear()
      router.replace(`/login?returnTo=${encodeURIComponent(sanitizeUserReturnTo(pathname))}`)
      router.refresh()
      setLoggingOut(false)
    }
  }

  return (
    <div className="relative min-h-screen">
      {!collapsed ? (
        <button
          type="button"
          aria-label="关闭导航菜单"
          className="fixed inset-0 z-50 bg-black/20 md:hidden"
          onClick={() => setCollapsed(true)}
        />
      ) : null}
      <aside
        style={{ background: 'var(--theme-sidebar)' }}
        className={cn(
          'agent-sidebar-surface fixed inset-y-0 left-0 z-[60] flex flex-col rounded-none border-y-0 border-l-0 p-4 transition-[width,transform] duration-200',
          collapsed
            ? 'w-[5.25rem] max-md:w-[17rem] max-md:-translate-x-full'
            : 'w-[17rem] max-md:translate-x-0',
        )}
      >
        <div
          className={cn(
            'flex min-h-12 items-center gap-2',
            collapsed ? 'justify-center' : 'justify-between',
          )}
        >
          {collapsed ? (
            <button
              type="button"
              className={cn('group relative grid size-11 place-items-center rounded-xl', focusRing)}
              aria-label="展开边栏"
              title="展开边栏"
              onClick={() => setCollapsed(false)}
            >
              <LogoMark className="transition-[opacity,transform] duration-150 group-hover:scale-90 group-hover:opacity-0 group-focus-visible:scale-90 group-focus-visible:opacity-0" />
              <span className="absolute grid size-10 place-items-center rounded-lg border border-line bg-surface-inset text-brand-hover opacity-0 transition-[opacity,transform] duration-150 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 dark:border-line-soft dark:bg-brand-muted dark:text-brand-light [&_svg]:size-4">
                <CollapseIcon collapsed />
              </span>
            </button>
          ) : (
            <>
              <Brand />
              <button
                type="button"
                className={cn(shellIconButtonClass, focusRing)}
                aria-label="收起边栏"
                title="收起边栏"
                onClick={() => setCollapsed(true)}
              >
                <CollapseIcon collapsed={false} />
              </button>
            </>
          )}
        </div>

        <NewConversationButton collapsed={collapsed} />
        <SidebarCapabilityLinks collapsed={collapsed} pathname={pathname} />

        <nav className="flex min-h-0 flex-1 flex-col pt-5" aria-label="工作区导航">
          {!collapsed && (
            <p className="mb-2 px-2 font-mono text-[0.7rem] font-bold tracking-[0.14em] text-ink-subtle uppercase">
              对话
            </p>
          )}
          <div className="max-h-[calc(100vh-22rem)] min-h-0 overflow-y-auto pr-1">
            {!collapsed ? (
              <Suspense fallback={null}>
                <AgentThreadLinks />
              </Suspense>
            ) : null}
          </div>
        </nav>

        <div
          className={cn('relative grid gap-3', collapsed && 'justify-items-center')}
          ref={userMenuRef}
        >
          {session.status === 'authenticated' && session.user ? (
            <>
              {userMenuOpen && (
                <div
                  role="menu"
                  aria-label="用户菜单"
                  className={cn(
                    'liquid-glass absolute bottom-[calc(100%+0.75rem)] left-0 grid w-full min-w-[13.5rem] gap-0.5 rounded-2xl p-1.5',
                    collapsed && '-left-1.5',
                  )}
                >
                  <Link
                    href="/usage"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                    className={menuItemClass}
                  >
                    <UsageIcon />
                    <span>Token 用量</span>
                  </Link>
                  <ThemeToggle variant="menu" />
                  <Link
                    href="/admin"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                    className={menuItemClass}
                  >
                    <AdminIcon />
                    <span>管理后台</span>
                  </Link>
                  <div className="mx-2 my-1 h-px bg-line-soft dark:bg-line-soft" />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={loggingOut}
                    onClick={() => void logout()}
                    className={cn(
                      menuItemClass,
                      'text-[#b54b3c] hover:bg-[#fbeae6] hover:text-[#a63c2e] dark:hover:bg-[#442a2c] dark:hover:text-[#ff9d8e]',
                    )}
                  >
                    <LogoutIcon />
                    <span>{loggingOut ? '正在退出…' : '退出登录'}</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                className={cn(
                  'flex w-full min-w-0 items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-surface-inset dark:hover:bg-surface-inset',
                  focusRing,
                )}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                <UserAvatar
                  avatarUrl={session.user.avatarUrl}
                  avatarFailed={avatarFailed}
                  onAvatarError={() => setAvatarFailed(true)}
                  label={session.user.userName.slice(0, 2).toUpperCase()}
                />
                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">{session.user.userName}</strong>
                      <span className="mt-0.5 block text-[0.66rem] text-ink-faint">账户与设置</span>
                    </div>
                    <ChevronIcon className="size-4 shrink-0 text-ink-faint" />
                  </>
                )}
              </button>
            </>
          ) : session.status === 'unauthenticated' ? (
            <Link
              href={`/login?returnTo=${encodeURIComponent(sanitizeUserReturnTo(pathname))}`}
              className={cn(
                'flex w-full min-w-0 items-center gap-3 rounded-xl p-1.5 text-sm font-bold text-brand-hover dark:text-brand-light',
                focusRing,
              )}
            >
              <UserAvatar label={<UserIcon />} />
              {!collapsed && <span>登录</span>}
            </Link>
          ) : (
            <div
              className="flex w-full items-center gap-3 rounded-xl p-1.5"
              aria-label="正在加载用户信息"
            >
              <span className="grid size-10 animate-pulse rounded-full bg-surface-inset" />
              {!collapsed && (
                <span className="h-3 w-24 animate-pulse rounded bg-line dark:bg-white/10" />
              )}
            </div>
          )}
        </div>
      </aside>

      <div
        className={cn(
          'min-h-screen transition-[margin-left] duration-200 max-md:ml-0',
          collapsed ? 'ml-[5.25rem]' : 'ml-[17rem]',
        )}
      >
        <button
          type="button"
          aria-label="打开导航菜单"
          className="fixed top-3 left-3 z-40 grid size-9 place-items-center rounded-lg border border-line bg-surface-card text-ink-secondary md:hidden"
          onClick={() => setCollapsed(false)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        {children}
      </div>
    </div>
  )
}

const menuItemClass =
  'flex min-h-[2.65rem] w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2 text-left text-[0.78rem] font-semibold text-ink-secondary shadow-none transition-[background,color] hover:bg-surface-inset hover:text-brand-hover dark:text-[#d8d1e3] dark:hover:bg-[#352d45] dark:hover:text-ink [&_svg]:size-4 [&_svg]:shrink-0'

function SidebarCapabilityLinks({
  collapsed,
  pathname,
}: Readonly<{ collapsed: boolean; pathname: string }>) {
  return (
    <nav
      aria-label="能力入口"
      className={cn(
        'mt-4 grid gap-1 border-y border-line-soft py-3 dark:border-line-soft',
        collapsed && 'justify-items-center',
      )}
    >
      <Link
        href="/plugin"
        aria-current={pathname === '/plugin' ? 'page' : undefined}
        title={collapsed ? '插件市场' : undefined}
        className={cn(
          capabilityLinkClass,
          pathname === '/plugin' && capabilityLinkActiveClass,
          collapsed && 'size-10 justify-center px-0',
          focusRing,
        )}
      >
        <PluginIcon />
        {!collapsed && <span>插件市场</span>}
      </Link>
      <Link
        href="/skills"
        aria-current={
          pathname === '/skills' || pathname.startsWith('/skills/') ? 'page' : undefined
        }
        title={collapsed ? '技能中心' : undefined}
        className={cn(
          capabilityLinkClass,
          (pathname === '/skills' || pathname.startsWith('/skills/')) && capabilityLinkActiveClass,
          collapsed && 'size-10 justify-center px-0',
          focusRing,
        )}
      >
        <SparkIcon />
        {!collapsed && <span>技能中心</span>}
      </Link>
    </nav>
  )
}

const capabilityLinkClass =
  'flex min-h-10 items-center gap-2.5 rounded-xl px-3 text-[0.76rem] font-semibold text-ink-secondary transition-[background,color,transform] hover:bg-brand/8 hover:text-brand-hover dark:text-ink-dark-muted dark:hover:bg-brand/14 dark:hover:text-brand-light [&_svg]:size-4'

const capabilityLinkActiveClass =
  'bg-brand/12 text-brand-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.76)] dark:bg-brand/18 dark:text-brand-light'

function NewConversationButton({ collapsed }: Readonly<{ collapsed: boolean }>) {
  return (
    <Link
      href="/"
      aria-label="新建会话"
      title={collapsed ? '新建会话' : undefined}
      className={cn(
        'group relative mt-5 flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-line bg-white/38 px-3 text-[0.78rem] font-semibold text-ink-secondary shadow-[inset_0_1px_0_rgb(255_255_255/0.72)] transition-[background,border-color,color] hover:border-brand/35 hover:bg-brand/6 hover:text-brand-hover dark:border-line-soft dark:bg-white/[0.035] dark:text-ink-dark-muted dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] dark:hover:border-brand/35 dark:hover:bg-brand/12 dark:hover:text-brand-light',
        collapsed && 'mx-auto size-10 min-h-10 w-10 justify-center px-0',
        focusRing,
      )}
    >
      <span
        className="grid size-6 shrink-0 place-items-center rounded-lg bg-brand/8 text-base font-medium leading-none text-brand-hover ring-1 ring-brand/10 dark:bg-brand/14 dark:text-brand-light"
        aria-hidden="true"
      >
        +
      </span>
      {!collapsed && <span>新建会话</span>}
    </Link>
  )
}

function UsageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M4 19V9m5 10V5m5 14v-7m5 7V3" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function AgentThreadLinks() {
  const session = useUserSession()
  const { threads, activeRuns, loading, listError, renameThread, deleteThread } =
    useAgentWorkspace()
  const activeThreadId = useAgentActiveThreadId()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AgentThreadSummary | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [openActionsId, setOpenActionsId] = useState<string | null>(null)
  const openActionsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!openActionsId) return
    function closeActions(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof MouseEvent && openActionsRef.current?.contains(event.target as Node)) {
        return
      }
      setOpenActionsId(null)
    }
    document.addEventListener('mousedown', closeActions)
    document.addEventListener('keydown', closeActions)
    return () => {
      document.removeEventListener('mousedown', closeActions)
      document.removeEventListener('keydown', closeActions)
    }
  }, [openActionsId])

  if (session.status !== 'authenticated') return null

  const visibleThreads = visibleAgentThreads(threads, expanded)
  const hiddenCount = hiddenAgentThreadCount(threads, expanded)

  async function submitRename(threadId: string, title: string) {
    const trimmed = title.trim()
    if (!trimmed) {
      setActionError('会话标题不能为空')
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await renameThread(threadId, trimmed)
      setRenamingId(null)
    } catch (unknownError) {
      setActionError(unknownError instanceof Error ? unknownError.message : '重命名失败')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || busy) return
    setBusy(true)
    setActionError(null)
    try {
      await deleteThread(pendingDelete.id)
      setPendingDelete(null)
    } catch (unknownError) {
      setActionError(unknownError instanceof Error ? unknownError.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-1 flex flex-col gap-0.5" aria-label="对话记录">
      {listError ? <p className="mx-1 text-[0.72rem] text-ink-subtle">{listError}</p> : null}
      {actionError ? <p className="mx-1 text-[0.72rem] text-danger">{actionError}</p> : null}
      {loading && threads.length === 0 ? (
        <p className="mx-1 text-[0.72rem] text-ink-subtle">加载会话…</p>
      ) : null}
      {!loading && !listError && threads.length === 0 ? (
        <p className="mx-1 text-[0.72rem] text-ink-subtle">
          还没有会话，发送第一条任务后会出现在这里。
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {visibleThreads.map((thread) => {
          const href = `/?thread=${encodeURIComponent(thread.id)}`
          const isActive = thread.id === activeThreadId
          const isRenaming = renamingId === thread.id
          const actionsOpen = openActionsId === thread.id
          const isRunning = activeRuns.some((run) => run.threadId === thread.id)
          return (
            <li
              key={thread.id}
              className={cn(
                'group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-0.5 rounded-lg border border-transparent pr-1 transition-colors hover:bg-brand/6 dark:hover:bg-brand/12',
                isActive &&
                  'border-brand-muted/55 bg-brand-muted/16 dark:border-[#5b4d88] dark:bg-brand/18',
              )}
            >
              {isRenaming ? (
                <form
                  className="col-span-2 flex items-center gap-0.5"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const form = new FormData(event.currentTarget)
                    void submitRename(thread.id, String(form.get('title') ?? ''))
                  }}
                >
                  <input
                    name="title"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface-card px-2 py-1.5 text-xs text-ink-secondary dark:border-line-soft dark:bg-surface-card dark:text-ink"
                    defaultValue={thread.title}
                    maxLength={AGENT_THREAD_TITLE_MAX_LENGTH}
                    aria-label="会话标题"
                    autoFocus
                    disabled={busy}
                  />
                  <button type="submit" className={threadActionClass} disabled={busy}>
                    保存
                  </button>
                  <button
                    type="button"
                    className={threadActionClass}
                    disabled={busy}
                    onClick={() => setRenamingId(null)}
                  >
                    取消
                  </button>
                </form>
              ) : (
                <>
                  <Link
                    href={href}
                    title={thread.title}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'block min-w-0 truncate rounded-lg px-2.5 py-2 text-left text-[0.875rem] text-ink-secondary transition-colors dark:text-ink-dark-muted dark:hover:text-ink',
                      isActive && 'font-semibold text-ink-secondary dark:text-ink',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                      {isRunning ? (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-brand"
                          title="Agent 正在运行"
                          aria-label="Agent 正在运行"
                        />
                      ) : null}
                    </span>
                  </Link>
                  <div className="relative" ref={actionsOpen ? openActionsRef : undefined}>
                    <button
                      type="button"
                      className={cn(
                        'grid size-7 place-items-center rounded-lg text-ink-faint opacity-0 transition-[background,color,opacity] hover:bg-surface-inset hover:text-ink-secondary group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-brand/12 dark:hover:text-ink',
                        isActive && 'opacity-100',
                        actionsOpen && 'bg-surface-inset text-ink-secondary opacity-100',
                        focusRing,
                      )}
                      title="会话操作"
                      aria-label={`打开「${thread.title}」的操作菜单`}
                      aria-haspopup="menu"
                      aria-expanded={actionsOpen}
                      disabled={busy}
                      onClick={() =>
                        setOpenActionsId((current) => (current === thread.id ? null : thread.id))
                      }
                    >
                      <EllipsisIcon />
                    </button>

                    {actionsOpen ? (
                      <div
                        role="menu"
                        aria-label={`「${thread.title}」会话操作`}
                        className="liquid-glass absolute top-[calc(100%+0.35rem)] right-0 z-20 grid w-36 gap-0.5 rounded-xl p-1.5 shadow-[0_14px_36px_rgb(30_40_70/0.16)]"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className={cn(
                            threadMenuActionClass,
                            'text-ink-secondary hover:text-brand-hover dark:text-ink-dark-muted dark:hover:text-ink',
                          )}
                          onClick={() => {
                            setOpenActionsId(null)
                            setActionError(null)
                            setRenamingId(thread.id)
                          }}
                        >
                          <EditIcon />
                          <span>编辑标题</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className={cn(
                            threadMenuActionClass,
                            'text-danger hover:bg-danger/10 hover:text-danger dark:text-danger-light dark:hover:bg-danger/12 dark:hover:text-danger-light',
                          )}
                          onClick={() => {
                            setOpenActionsId(null)
                            setActionError(null)
                            setPendingDelete(thread)
                          }}
                        >
                          <TrashIcon />
                          <span>删除</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {threads.length > AGENT_THREAD_PREVIEW_LIMIT ? (
        <button
          type="button"
          className={cn(
            'mt-1 flex min-h-9 w-full items-center justify-between rounded-xl px-2.5 text-[0.7rem] font-semibold text-ink-faint transition-[background,color] hover:bg-brand/6 hover:text-brand-hover dark:hover:bg-brand/12 dark:hover:text-brand-light',
            focusRing,
          )}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span>{expanded ? '收起' : `展开其余 ${hiddenCount} 条`}</span>
          <ChevronIcon
            className={cn('size-3.5 transition-transform', expanded ? '-rotate-90' : 'rotate-90')}
          />
        </button>
      ) : null}

      {pendingDelete ? (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-[rgb(15_10_25/0.45)] p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-delete-title"
            className="w-full max-w-sm rounded-2xl bg-surface-card p-4.5 shadow-[0_18px_40px_rgb(15_10_25/0.22)] dark:shadow-[0_18px_40px_rgb(0_0_0/0.45)]"
          >
            <h3
              id="agent-delete-title"
              className="mb-2 text-base font-bold text-ink-secondary dark:text-ink"
            >
              确认删除会话
            </h3>
            <p className="text-[0.84rem] leading-relaxed text-ink-secondary dark:text-ink-dark-muted">
              将永久删除「{pendingDelete.title}
              」及其消息、运行与工具记录。请求日志与账单记录会保留。此操作不可恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={confirmActionClass}
                disabled={busy}
                onClick={() => setPendingDelete(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={cn(confirmActionClass, 'bg-danger text-white hover:bg-[#9f1239]')}
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                {busy ? '正在删除…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const threadActionClass =
  'cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[0.68rem] font-semibold leading-none text-ink-subtle transition-colors hover:bg-brand/10 hover:text-ink-secondary disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-ink'

const threadMenuActionClass =
  'flex min-h-9 w-full items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-[0.75rem] font-semibold shadow-none transition-[background,color] hover:bg-surface-inset focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-1 dark:hover:bg-brand/12 [&_svg]:size-4 [&_svg]:shrink-0'

const confirmActionClass =
  'rounded-lg border border-line px-3 py-2 text-sm font-semibold dark:border-line-soft'

function Brand({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <Link
      href="/"
      aria-label="Super Mind Studio Agent 工作台"
      className={cn('inline-flex min-w-0 items-center gap-3 rounded-xl', focusRing)}
    >
      <LogoMark />
      {!compact && (
        <span className="truncate font-display text-base font-semibold tracking-[-0.03em] text-ink dark:text-white">
          Super Mind Studio
        </span>
      )}
    </Link>
  )
}

function LogoMark({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      className={cn(
        'liquid-glass-soft grid size-11 shrink-0 place-items-center rounded-[0.95rem] border-brand/20 bg-brand/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.82),0_8px_22px_rgb(39_100_255/0.16)] dark:border-brand/25 dark:bg-brand/14',
        className,
      )}
    >
      <BrandMark className="size-10 object-contain" />
    </span>
  )
}

function UserAvatar({
  avatarUrl,
  avatarFailed,
  onAvatarError,
  label,
}: Readonly<{
  avatarUrl?: string | null
  avatarFailed?: boolean
  onAvatarError?: () => void
  label: ReactNode
}>) {
  return (
    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-muted text-brand-hover text-xs font-extrabold dark:text-brand-light [&_svg]:size-4">
      {typeof label === 'string' && avatarUrl && !avatarFailed ? (
        <img
          src={avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={onAvatarError}
        />
      ) : (
        label
      )}
    </span>
  )
}

type SvgProps = Readonly<{ children?: ReactNode; className?: string }>
function Icon({ children, className }: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('size-4 shrink-0', className)}
    >
      {children}
    </svg>
  )
}
function SparkIcon() {
  return (
    <Icon>
      <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
      <path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14ZM5 13l.7 1.8 1.8.7-1.8.7L5 18l-.7-1.8-1.8-.7 1.8-.7L5 13Z" />
    </Icon>
  )
}
function PluginIcon() {
  return (
    <Icon>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 6h4a3 3 0 0 1 3 3v6M16 18h-4a3 3 0 0 1-3-3V9" />
    </Icon>
  )
}
function EllipsisIcon() {
  return (
    <Icon>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </Icon>
  )
}
function EditIcon() {
  return (
    <Icon>
      <path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </Icon>
  )
}
function TrashIcon() {
  return (
    <Icon>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </Icon>
  )
}
function UserIcon() {
  return (
    <Icon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </Icon>
  )
}
function AdminIcon() {
  return (
    <Icon>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 20V9" />
    </Icon>
  )
}
function LogoutIcon() {
  return (
    <Icon>
      <path d="M10 17l5-5-5-5M15 12H3" />
      <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    </Icon>
  )
}
function ChevronIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <Icon className={cn(className)}>
      <path d="m9 15 3-3-3-3" />
    </Icon>
  )
}
function CollapseIcon({
  collapsed,
  className,
}: Readonly<{ collapsed: boolean; className?: string }>) {
  return (
    <Icon className={cn(className)}>
      <path
        d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l-4 4 4 4M10 12h11"
        className={collapsed ? 'origin-center rotate-180' : ''}
      />
    </Icon>
  )
}
