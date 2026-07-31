'use client'

import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { loginAdmin } from '@/utils/admin/admin-auth-client'

interface LoginFormValues {
  username: string
  password: string
}

export default function AdminLoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit({ username, password }: LoginFormValues) {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await loginAdmin(username, password)
      router.replace('/admin')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登录失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="aigateway-admin-login">
      <Card className="aigateway-admin-login-card" variant="borderless">
        <Typography.Text type="secondary" style={{ letterSpacing: '0.16em', fontSize: 12 }}>
          ADMIN CONSOLE
        </Typography.Text>
        <Typography.Title level={3} style={{ marginTop: 8, marginBottom: 24 }}>
          管理员登录
        </Typography.Title>

        <Form
          layout="vertical"
          requiredMark={false}
          initialValues={{ username: 'root' }}
          onFinish={submit}
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              autoComplete="username"
              prefix={<UserOutlined />}
              placeholder="用户名"
              size="large"
            />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              autoComplete="current-password"
              prefix={<LockOutlined />}
              placeholder="密码"
              size="large"
            />
          </Form.Item>

          {error ? (
            <Form.Item>
              <Alert type="error" showIcon message={error} />
            </Form.Item>
          ) : null}

          <Form.Item style={{ marginBottom: 0 }}>
            <Button block type="primary" htmlType="submit" size="large" loading={submitting}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </main>
  )
}
