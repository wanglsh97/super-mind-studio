'use client'

import { Alert, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'

import { AdminApiError, redirectToAdminLogin } from '@/utils/admin/admin-auth-client'
import { loadAdminTableRows, loadAdminTableSchema } from '@/utils/admin/admin-tables'
import type {
  AdminTableCapability,
  AdminTablePage,
  AdminTableRelation,
  AdminTableSchema,
} from '@/utils/admin/admin-tables'

function AdminDatabasePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [schema, setSchema] = useState<AdminTableSchema | null>(null)
  const [tableName, setTableName] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [result, setResult] = useState<AdminTablePage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const tables = schema?.tables ?? []
  const capability = useMemo(
    () => tables.find(({ name }) => name === tableName) ?? null,
    [tableName, tables],
  )

  useEffect(() => {
    let active = true
    void loadAdminTableSchema()
      .then((loaded) => {
        if (!active) return
        setSchema(loaded)
      })
      .catch((caught: unknown) => handleError(caught, setError))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (tables.length === 0) return
    const requestedTable = searchParams.get('table')
    if (requestedTable && tables.some(({ name }) => name === requestedTable)) {
      setTableName(requestedTable)
      setPage(1)
      return
    }
    const firstTable = tables[0]?.name
    if (firstTable) {
      router.replace(`/admin/database?table=${encodeURIComponent(firstTable)}`)
    }
  }, [router, searchParams, tables])

  useEffect(() => {
    if (!tableName) return
    let active = true
    setLoading(true)
    setError('')
    void loadAdminTableRows(tableName, { page, pageSize })
      .then((loaded) => {
        if (active) setResult(loaded)
      })
      .catch((caught: unknown) => {
        if (active) handleError(caught, setError)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [page, pageSize, tableName])

  const relationByField = useMemo(() => {
    const map = new Map<string, AdminTableRelation>()
    for (const relation of capability?.relations ?? []) {
      map.set(relation.field, relation)
    }
    return map
  }, [capability])

  const columns: ColumnsType<Record<string, unknown>> = capability
    ? capability.fields.map((field) => ({
        title: field.name,
        dataIndex: field.name,
        key: field.name,
        ellipsis: true,
        width: field.kind === 'json' ? 220 : 160,
        render: (value: unknown) => renderCell(value, field.name, relationByField, tables),
      }))
    : []

  return (
    <>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Table
        rowKey={(row) => String(row[capability?.primaryKey ?? 'id'])}
        size="small"
        loading={loading || !capability}
        columns={columns}
        dataSource={result?.items ?? []}
        scroll={{ x: Math.max(960, (capability?.fields.length ?? 1) * 160) }}
        locale={{ emptyText: capability ? '暂无数据' : '正在加载…' }}
        pagination={{
          current: page,
          pageSize,
          total: result?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (total) => `共 ${total} 行`,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage)
            setPageSize(nextSize)
          },
        }}
      />
    </>
  )
}

export default function AdminDatabasePage() {
  return (
    <Suspense fallback={<Typography.Text type="secondary">正在加载…</Typography.Text>}>
      <AdminDatabasePageInner />
    </Suspense>
  )
}

function renderCell(
  value: unknown,
  fieldName: string,
  relationByField: Map<string, AdminTableRelation>,
  tables: AdminTableCapability[],
) {
  const text = displayValue(value)
  const relation = relationByField.get(fieldName)
  if (relation && value !== null && value !== undefined && text !== '—') {
    const targetLabel =
      tables.find((table) => table.name === relation.targetTable)?.physicalName ??
      relation.targetTable
    return (
      <Link href={`/admin/database?table=${relation.targetTable}`} title={`查看 ${targetLabel}`}>
        {text}
      </Link>
    )
  }
  return (
    <Typography.Text ellipsis={{ tooltip: text }} style={{ maxWidth: 200 }}>
      {text}
    </Typography.Text>
  )
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function handleError(error: unknown, setError: (message: string) => void) {
  if (error instanceof AdminApiError && error.status === 401) {
    redirectToAdminLogin()
    return
  }
  setError(error instanceof Error ? error.message : '数据库请求失败')
}
