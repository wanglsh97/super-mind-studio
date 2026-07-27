'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Suspense, type ReactNode, useEffect, useRef, useState } from 'react'

import type { AgentThreadSummary } from '@supermind/sdk'

import { logoutUser, sanitizeUserReturnTo } from '../lib/user-auth-client'
import { cn } from '../lib/cn'
import {
  AGENT_THREAD_TITLE_MAX_LENGTH,
  useAgentActiveThreadId,
  useAgentWorkspace,
} from './agent-workspace-provider'
import { ThemeToggle } from './theme-toggle'
import { useUserSession } from './user-session-provider'

const focusRing =
  'focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-3'

const shellIconButtonClass =
  'liquid-glass-soft grid size-9 shrink-0 place-items-center rounded-xl text-ink-muted transition-[background,color,transform] hover:-translate-y-0.5 hover:text-brand-hover dark:hover:text-ink [&_svg]:size-4'

const navigation = [
  { href: '/agent', label: '智能体', description: '对话与多步任务', icon: AgentIcon },
  { href: '/skills', label: '技能', description: '查看已安装能力', icon: SparkIcon },
  { href: '/api', label: 'API', description: '接入网关能力', icon: ApiIcon },
]

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
    <div className="relative min-h-screen min-w-[1366px]">
      <aside
        className={cn(
          'liquid-glass fixed inset-y-0 left-0 z-[60] flex flex-col rounded-r-[2rem] border-y-0 border-l-0 p-4 transition-[width,transform] duration-200',
          collapsed ? 'w-[5.25rem]' : 'w-[17rem]',
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
              <span className="absolute grid size-10 place-items-center rounded-xl border border-line bg-surface-inset text-brand-hover opacity-0 transition-[opacity,transform] duration-150 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 dark:border-line-soft dark:bg-brand-muted dark:text-brand-light [&_svg]:size-4">
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

        <nav className="flex flex-1 flex-col gap-1.5 overflow-y-auto pt-12" aria-label="功能菜单">
          {!collapsed && (
            <p className="mb-1.5 ml-3 font-mono text-[0.61rem] font-bold tracking-[0.16em] text-ink-subtle uppercase">
              功能
            </p>
          )}
          {navigation.map((item) => {
            const active =
              pathname === item.href ||
              pathname.startsWith(`${item.href}/`) ||
              (item.href === '/agent' && pathname === '/chat/compare')
            const Icon = item.icon
            if (item.href === '/agent') {
              return (
                <AgentNavGroup
                  key={item.href}
                  active={active}
                  collapsed={collapsed}
                  label={item.label}
                  description={item.description}
                  Icon={Icon}
                />
              )
            }
            return (
              <SidebarNavLink
                key={item.href}
                href={item.href}
                active={active}
                collapsed={collapsed}
                label={item.label}
                description={item.description}
                Icon={Icon}
              />
            )
          })}
        </nav>

        <div
          className={cn(
            'relative grid gap-3 border-t border-line-soft pt-4',
            collapsed && 'justify-items-center',
          )}
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
                  label={session.user.githubUsername.slice(0, 2).toUpperCase()}
                />
                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">
                        {session.user.githubUsername}
                      </strong>
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
              {!collapsed && <span>使用 GitHub 登录</span>}
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
          'min-h-screen transition-[margin-left] duration-200',
          collapsed ? 'ml-[5.25rem]' : 'ml-[17rem]',
        )}
      >
        {children}
      </div>
    </div>
  )
}

const menuItemClass =
  'flex min-h-[2.65rem] w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2 text-left text-[0.78rem] font-semibold text-ink-secondary shadow-none transition-[background,color] hover:bg-surface-inset hover:text-brand-hover dark:text-[#d8d1e3] dark:hover:bg-[#352d45] dark:hover:text-ink [&_svg]:size-4 [&_svg]:shrink-0'

function SidebarNavLink({
  href,
  active,
  collapsed,
  label,
  description,
  Icon,
}: Readonly<{
  href: string
  active: boolean
  collapsed: boolean
  label: string
  description: string
  Icon: () => ReactNode
}>) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'relative flex min-h-[3.65rem] items-center gap-3 rounded-2xl px-3 py-2 text-ink-muted transition-[background,color,transform,box-shadow] hover:bg-white/55 hover:text-ink-secondary hover:translate-x-0.5 dark:hover:bg-surface-inset dark:hover:text-ink',
        active &&
          'border border-white/80 bg-white/68 text-brand-hover shadow-[0_10px_28px_rgb(39_100_255/0.1)] dark:border-white/8 dark:bg-brand-muted dark:text-brand-light',
        collapsed &&
          'justify-center px-2 hover:translate-x-0 hover:bg-transparent dark:hover:bg-transparent',
        collapsed &&
          !active &&
          'hover:[&_.nav-icon]:bg-brand-subtle hover:[&_.nav-icon]:text-brand-hover hover:[&_.nav-icon]:-translate-y-0.5 hover:[&_.nav-icon]:shadow-[0_7px_16px_rgb(77_56_184/0.15)] dark:hover:[&_.nav-icon]:bg-brand-muted dark:hover:[&_.nav-icon]:text-brand-light',
        focusRing,
      )}
    >
      {active && !collapsed && (
        <span
          className="absolute -left-1.5 h-[1.65rem] w-0.5 rounded-full bg-brand"
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          'nav-icon grid size-9 shrink-0 place-items-center rounded-xl bg-white/52 shadow-[inset_0_1px_0_rgb(255_255_255/0.9),0_6px_18px_rgb(44_74_120/0.06)] transition-[background,color,box-shadow,transform] dark:bg-white/[0.045] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)] [&_svg]:size-[1.15rem]',
        )}
      >
        <Icon />
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <strong className="block text-[0.84rem] font-bold text-ink-secondary dark:text-[#eee9f8]">
            {label}
          </strong>
          <small className="mt-0.5 block text-[0.65rem] text-ink-faint dark:text-[#91889f]">
            {description}
          </small>
        </span>
      )}
    </Link>
  )
}

function AgentNavGroup({
  active,
  collapsed,
  label,
  description,
  Icon,
}: Readonly<{
  active: boolean
  collapsed: boolean
  label: string
  description: string
  Icon: () => ReactNode
}>) {
  return (
    <div className={active ? 'is-active' : undefined}>
      <SidebarNavLink
        href="/agent"
        active={active}
        collapsed={collapsed}
        label={label}
        description={description}
        Icon={Icon}
      />
      {active && !collapsed ? (
        <Suspense fallback={null}>
          <AgentThreadLinks />
        </Suspense>
      ) : null}
    </div>
  )
}

function AgentThreadLinks() {
  const session = useUserSession()
  const { threads, loading, listError, renameThread, deleteThread } = useAgentWorkspace()
  const activeThreadId = useAgentActiveThreadId()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AgentThreadSummary | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session.status !== 'authenticated') return null

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
    <div
      className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-line pl-3 dark:border-line-soft"
      aria-label="Agent 会话"
    >
      <Link
        href="/agent"
        className="block w-full rounded-lg border border-dashed border-line px-2.5 py-2 text-left text-[0.78rem] font-semibold text-ink-secondary transition-colors hover:border-brand hover:bg-brand/6 hover:text-ink-secondary dark:border-line-soft dark:text-ink-dark-muted dark:hover:text-ink"
      >
        + 新建会话
      </Link>
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
        {threads.map((thread) => {
          const href = `/agent?thread=${encodeURIComponent(thread.id)}`
          const isActive = thread.id === activeThreadId
          const isRenaming = renamingId === thread.id
          return (
            <li
              key={thread.id}
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-0.5"
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
                      'block min-w-0 truncate rounded-lg px-2.5 py-2 text-left text-[0.78rem] text-ink-secondary transition-colors hover:bg-brand/6 dark:text-ink-dark-muted dark:hover:bg-brand/12 dark:hover:text-ink',
                      isActive &&
                        'border border-brand-muted/55 bg-brand-muted/16 font-semibold text-ink-secondary dark:border-[#5b4d88] dark:bg-brand/18 dark:text-ink',
                    )}
                  >
                    {thread.title}
                  </Link>
                  <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      className={threadActionClass}
                      title="重命名"
                      aria-label={`重命名「${thread.title}」`}
                      disabled={busy}
                      onClick={() => {
                        setActionError(null)
                        setRenamingId(thread.id)
                      }}
                    >
                      改
                    </button>
                    <button
                      type="button"
                      className={cn(
                        threadActionClass,
                        'hover:bg-danger/12 hover:text-danger dark:hover:text-ink',
                      )}
                      title="删除"
                      aria-label={`删除「${thread.title}」`}
                      disabled={busy}
                      onClick={() => {
                        setActionError(null)
                        setPendingDelete(thread)
                      }}
                    >
                      删
                    </button>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>

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

const confirmActionClass =
  'rounded-lg border border-line px-3 py-2 text-sm font-semibold dark:border-line-soft'

function Brand({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <Link
      href="/"
      aria-label="Super Mind Studio 首页"
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
        'grid size-10 rotate-45 place-items-center rounded-[0.9rem] border border-white/50 bg-[linear-gradient(135deg,#2764ff,#8b7cff)] shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_10px_24px_rgb(39_100_255/0.24)]',
        className,
      )}
    >
      <span className="-rotate-45 font-mono text-[0.64rem] font-black text-white">SM</span>
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
function AgentIcon() {
  return (
    <Icon>
      <rect x="5" y="8" width="14" height="10" rx="2" />
      <path d="M12 8V4M9 4h6" />
      <circle cx="9" cy="13" r="1" />
      <circle cx="15" cy="13" r="1" />
      <path d="M2 12v3M22 12v3" />
    </Icon>
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
function ApiIcon() {
  return (
    <Icon>
      <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14" />
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
