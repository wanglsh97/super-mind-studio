import { AdminApiError } from './admin-auth-client'

export type AdminFieldKind =
  'string' | 'number' | 'boolean' | 'decimal' | 'datetime' | 'json' | 'enum'
export type AdminTableOperation = 'query'

export interface AdminTableFieldCapability {
  name: string
  label: string
  kind: AdminFieldKind
  nullable: boolean
  editable: boolean
}

export interface AdminTableRelation {
  field: string
  targetTable: string
  targetField: string
  label: string
}

export interface AdminTableSchemaRelation extends AdminTableRelation {
  sourceTable: string
}

export interface AdminTableCapability {
  name: string
  physicalName: string
  label: string
  primaryKey: string
  operations: AdminTableOperation[]
  fields: AdminTableFieldCapability[]
  relations: AdminTableRelation[]
}

export interface AdminTableSchema {
  tables: AdminTableCapability[]
  relations: AdminTableSchemaRelation[]
}

export interface AdminTablePage {
  items: Array<Record<string, unknown>>
  page: number
  pageSize: number
  total: number
  pageCount: number
}

export function loadAdminTables(fetchImplementation: typeof fetch = fetch) {
  return request<AdminTableCapability[]>(
    '/api/v1/admin/tables',
    { method: 'GET' },
    fetchImplementation,
  )
}

export function loadAdminTableSchema(fetchImplementation: typeof fetch = fetch) {
  return request<AdminTableSchema>(
    '/api/v1/admin/tables/schema',
    { method: 'GET' },
    fetchImplementation,
  )
}

export function loadAdminTableRows(
  table: string,
  query: { page?: number; pageSize?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' },
  fetchImplementation: typeof fetch = fetch,
) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value))
  }
  return request<AdminTablePage>(
    `/api/v1/admin/tables/${encodeURIComponent(table)}/rows?${search}`,
    { method: 'GET' },
    fetchImplementation,
  )
}

async function request<T>(
  url: string,
  init: RequestInit,
  fetchImplementation: typeof fetch,
): Promise<T> {
  const response = await fetchImplementation(url, {
    ...init,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...init.headers },
  })
  if (!response.ok) {
    let message = '数据库浏览请求失败'
    try {
      const body = (await response.json()) as { message?: unknown }
      if (typeof body.message === 'string') message = body.message
    } catch {
      // Preserve the stable fallback for non-JSON errors.
    }
    throw new AdminApiError(response.status, message)
  }
  return (await response.json()) as T
}
