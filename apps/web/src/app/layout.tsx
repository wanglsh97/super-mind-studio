import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { AgentWorkspaceProvider } from '../components/agent-workspace-provider'
import { AppShell } from '../components/app-shell'
import { UserSessionProvider } from '../components/user-session-provider'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Super Mind Studio',
    template: '%s · Super Mind Studio',
  },
  description: '从灵感到作品的 AI Creative Workspace',
}

export const viewport: Viewport = {
  width: 1440,
  initialScale: 1,
}

const themeScript = `
  try {
    const storedTheme = localStorage.getItem('aigateway-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = storedTheme === 'light' || storedTheme === 'dark'
      ? storedTheme
      : prefersDark ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  } catch {}
`

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning>
        <UserSessionProvider>
          <AgentWorkspaceProvider>
            <AppShell>{children}</AppShell>
          </AgentWorkspaceProvider>
        </UserSessionProvider>
      </body>
    </html>
  )
}
