'use client'

import { createAIGatewayClient, type AdminSkillReviewRecord } from '@supermind/sdk'
import { Alert, Button, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'

import { redirectToAdminLogin } from '@/utils/admin/admin-auth-client'

const client = createAIGatewayClient()

export default function AdminSkillsPage() {
  const [items, setItems] = useState<AdminSkillReviewRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState<AdminSkillReviewRecord | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await client.admin.skills.listPending())
    } catch (cause) {
      if (isUnauthorized(cause)) {
        redirectToAdminLogin()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Skill 审核队列加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function approve(row: AdminSkillReviewRecord) {
    setBusy(row.id)
    setError('')
    try {
      await client.admin.skills.approve(row.id)
      setItems((current) => current.filter((item) => item.id !== row.id))
    } catch (cause) {
      if (isUnauthorized(cause)) redirectToAdminLogin()
      else setError(cause instanceof Error ? cause.message : '审核通过失败')
    } finally {
      setBusy('')
    }
  }

  async function reject() {
    if (!rejecting || !reason.trim()) return
    setBusy(rejecting.id)
    try {
      await client.admin.skills.reject(rejecting.id, reason.trim())
      setItems((current) => current.filter((item) => item.id !== rejecting.id))
      setRejecting(null)
      setReason('')
    } catch (cause) {
      if (isUnauthorized(cause)) redirectToAdminLogin()
      else setError(cause instanceof Error ? cause.message : '驳回失败')
    } finally {
      setBusy('')
    }
  }

  const columns: ColumnsType<AdminSkillReviewRecord> = [
    {
      title: 'Skill',
      key: 'skill',
      render: (_, row) => (
        <div>
          <Typography.Text strong>{row.title}</Typography.Text>
          <div>
            <Typography.Text type="secondary" code>
              {row.name}
            </Typography.Text>
          </div>
        </div>
      ),
    },
    { title: '分类', dataIndex: 'category', width: 120, render: (value) => <Tag>{value}</Tag> },
    {
      title: '简介',
      dataIndex: 'description',
      ellipsis: true,
    },
    {
      title: 'SHA-256',
      dataIndex: 'packageSha256',
      width: 150,
      render: (value: string | null) =>
        value ? <Typography.Text code>{value.slice(0, 12)}…</Typography.Text> : '—',
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      render: (_, row) => (
        <Space>
          <Button type="primary" loading={busy === row.id} onClick={() => void approve(row)}>
            通过
          </Button>
          <Button danger disabled={busy === row.id} onClick={() => setRejecting(row)}>
            驳回
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        首次发布审核
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        仅首次公开需要审核；后续 owner 覆盖资源包不会再次进入此队列。
      </Typography.Paragraph>
      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          action={<Button onClick={() => void load()}>重试</Button>}
        />
      ) : null}
      <Table
        style={{ marginTop: 20 }}
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={loading}
        pagination={false}
        locale={{ emptyText: '当前没有待审核 Skill' }}
        scroll={{ x: 900 }}
      />
      <Modal
        title={`驳回 ${rejecting?.name ?? ''}`}
        open={Boolean(rejecting)}
        okText="确认驳回"
        okButtonProps={{ danger: true, disabled: !reason.trim(), loading: busy === rejecting?.id }}
        onOk={() => void reject()}
        onCancel={() => {
          setRejecting(null)
          setReason('')
        }}
      >
        <Input.TextArea
          value={reason}
          maxLength={500}
          showCount
          rows={5}
          placeholder="说明需要修正的问题"
          onChange={(event) => setReason(event.target.value)}
        />
      </Modal>
    </div>
  )
}

function isUnauthorized(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 401
}
