'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/utils/cn'

type Theme = 'light' | 'dark'

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  localStorage.setItem('aigateway-theme', theme)
}

const menuItemClass =
  'flex min-h-[2.65rem] w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2 text-left text-[0.78rem] font-semibold text-ink-secondary shadow-none transition-[background,color] hover:bg-surface-inset hover:text-brand-hover dark:text-[#d8d1e3] dark:hover:bg-[#352d45] dark:hover:text-ink [&_svg]:size-4 [&_svg]:shrink-0'

export function ThemeToggle({ variant = 'icon' }: Readonly<{ variant?: 'icon' | 'menu' }>) {
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      className={
        variant === 'menu'
          ? menuItemClass
          : cn(
              'grid size-9 place-items-center rounded-md border border-line bg-surface-card/75 text-ink-muted shadow-sm transition hover:-translate-y-0.5 hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 dark:border-line dark:bg-white/5 dark:text-ink-muted dark:hover:text-ink',
            )
      }
      aria-label={`切换到${nextTheme === 'dark' ? '暗色' : '亮色'}主题`}
      title={`切换到${nextTheme === 'dark' ? '暗色' : '亮色'}主题`}
      onClick={() => {
        applyTheme(nextTheme)
        setTheme(nextTheme)
      }}
    >
      <span aria-hidden="true" className="text-base leading-none">
        {theme === 'dark' ? '☼' : '◐'}
      </span>
      {variant === 'menu' && <span>切换主题</span>}
    </button>
  )
}
