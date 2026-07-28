'use client'

import {
  DashboardOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  AppstoreOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Avatar, Dropdown, Layout, Menu, Result, Spin, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { Suspense, useEffect, useMemo, useState } from 'react'

import { BrandMark } from '../../../components/brand-mark'
import {
  AdminApiError,
  getAdminSession,
  logoutAdmin,
  redirectToAdminLogin,
} from '../../../lib/admin-auth-client'
import type { AdminSession } from '../../../lib/admin-auth-client'
import { loadAdminTableSchema } from '../../../lib/admin-tables'
import type { AdminTableCapability } from '../../../lib/admin-tables'

const { Header, Sider, Content } = Layout

const PAGE_TITLES: Record<string, string> = {
  dashboard: '运行概览',
  logs: '请求日志',
  database: '数据库',
  skills: 'Skill 审核',
}

function tableMenuKey(name: string) {
  return `table:${name}`
}

function AdminBrand({ collapsed }: Readonly<{ collapsed: boolean }>) {
  return (
    <div className={`aigateway-admin-brand${collapsed ? ' aigateway-admin-brand--collapsed' : ''}`}>
      <BrandMark className="aigateway-admin-brand-mark" alt="Super Mind Studio" />
      {!collapsed ? (
        <div className="aigateway-admin-brand-text">
          <div className="aigateway-admin-brand-title">Super Mind</div>
          <div className="aigateway-admin-brand-subtitle">管理控制台</div>
        </div>
      ) : null}
    </div>
  )
}

function AdminConsoleLayoutInner({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [session, setSession] = useState<AdminSession | null>(null)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [tables, setTables] = useState<AdminTableCapability[]>([])
  const [openKeys, setOpenKeys] = useState<string[]>(['database'])

  useEffect(() => {
    let active = true
    void getAdminSession()
      .then((restored) => {
        if (active) setSession(restored)
      })
      .catch((caught: unknown) => {
        if (!active) return
        if (caught instanceof AdminApiError && caught.status === 401) {
          redirectToAdminLogin()
          return
        }
        setError(caught instanceof Error ? caught.message : '会话恢复失败')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!session) return
    let active = true
    void loadAdminTableSchema()
      .then((schema) => {
        if (active) setTables(schema.tables)
      })
      .catch(() => {
        // 侧栏表名加载失败时不阻塞控制台其余页面。
      })
    return () => {
      active = false
    }
  }, [session])

  useEffect(() => {
    if (pathname.startsWith('/admin/database')) {
      setOpenKeys((keys) => (keys.includes('database') ? keys : [...keys, 'database']))
    }
  }, [pathname])

  const selectedKey = useMemo(() => {
    if (pathname.startsWith('/admin/logs')) return 'logs'
    if (pathname.startsWith('/admin/skills')) return 'skills'
    if (pathname.startsWith('/admin/database')) {
      const table = searchParams.get('table')
      return table ? tableMenuKey(table) : 'database'
    }
    return 'dashboard'
  }, [pathname, searchParams])

  const headerTitle = useMemo(() => {
    if (pathname.startsWith('/admin/database')) {
      const table = searchParams.get('table')
      const found = tables.find(({ name }) => name === table)
      return found?.physicalName ?? PAGE_TITLES.database
    }
    if (pathname.startsWith('/admin/logs')) return PAGE_TITLES.logs
    if (pathname.startsWith('/admin/skills')) return PAGE_TITLES.skills
    return PAGE_TITLES.dashboard
  }, [pathname, searchParams, tables])

  const menuItems: MenuProps['items'] = useMemo(
    () => [
      { key: 'dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
      { key: 'logs', icon: <FileSearchOutlined />, label: '请求日志' },
      { key: 'skills', icon: <AppstoreOutlined />, label: 'Skill 审核' },
      {
        key: 'database',
        icon: <DatabaseOutlined />,
        label: '数据库',
        children:
          tables.length > 0
            ? tables.map((table) => ({
                key: tableMenuKey(table.name),
                label: table.physicalName,
              }))
            : [{ key: 'database-loading', label: '加载表…', disabled: true }],
      },
    ],
    [tables],
  )

  function navigateMenu({ key }: { key: string }) {
    if (key === 'dashboard') {
      router.push('/admin')
      return
    }
    if (key === 'logs') {
      router.push('/admin/logs')
      return
    }
    if (key === 'skills') {
      router.push('/admin/skills')
      return
    }
    if (key.startsWith('table:')) {
      router.push(`/admin/database?table=${encodeURIComponent(key.slice('table:'.length))}`)
    }
  }

  async function logout() {
    try {
      await logoutAdmin()
    } finally {
      router.replace('/admin/login')
      router.refresh()
    }
  }

  if (error) {
    return (
      <div className="aigateway-admin-console-layout">
        <Result status="error" title="会话恢复失败" subTitle={error} />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="aigateway-admin-console-layout" style={{ padding: 64, textAlign: 'center' }}>
        <Spin size="large" description="正在恢复管理员会话…" />
      </div>
    )
  }

  return (
    <Layout className="aigateway-admin-console-layout">
      <Sider
        className="aigateway-admin-sider"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={232}
        collapsedWidth={72}
      >
        <AdminBrand collapsed={collapsed} />
        <Menu
          className="aigateway-admin-menu"
          mode="inline"
          selectedKeys={[selectedKey]}
          openKeys={openKeys}
          onOpenChange={setOpenKeys}
          items={menuItems}
          onClick={navigateMenu}
        />
      </Sider>
      <Layout className="aigateway-admin-main">
        <Header className="aigateway-admin-header">
          <Typography.Title level={4} className="aigateway-admin-header-title">
            {headerTitle}
          </Typography.Title>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: logout,
                },
              ],
            }}
            trigger={['click']}
            placement="bottomRight"
          >
            <div className="aigateway-admin-header-user">
              <Avatar size={32} icon={<UserOutlined />} style={{ backgroundColor: '#1677ff' }} />
              <Typography.Text>{session.username}</Typography.Text>
            </div>
          </Dropdown>
        </Header>
        <Content className="aigateway-admin-console-scroll">
          <div className="aigateway-admin-console-content">{children}</div>
        </Content>
      </Layout>
    </Layout>
  )
}

export default function AdminConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Suspense
      fallback={
        <div
          className="aigateway-admin-console-layout"
          style={{ padding: 64, textAlign: 'center' }}
        >
          <Spin size="large" description="正在加载…" />
        </div>
      }
    >
      <AdminConsoleLayoutInner>{children}</AdminConsoleLayoutInner>
    </Suspense>
  )
}
