'use client'

import { AntdRegistry } from '@ant-design/nextjs-registry'
import { App, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'

import { adminTheme } from '@/const/admin-theme'

export function AdminAntdProvider({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AntdRegistry>
      <ConfigProvider locale={zhCN} theme={adminTheme}>
        <App>{children}</App>
      </ConfigProvider>
    </AntdRegistry>
  )
}
