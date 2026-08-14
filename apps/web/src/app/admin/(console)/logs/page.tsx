'use client';

import {
  Alert,
  Button,
  Col,
  Drawer,
  Form,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';

import { AdminApiError, redirectToAdminLogin } from '@/utils/admin/admin-auth-client';
import {
  loadRequestLogDetail,
  loadRequestLogs,
  loadRequestTrace,
} from '@/utils/admin/admin-request-logs';
import type {
  RequestLogDetail,
  RequestLogFilters,
  RequestLogListItem,
  RequestLogPage,
  AdminTrace,
} from '@/utils/admin/admin-request-logs';

const initialFilters: RequestLogFilters = { page: 1, pageSize: 20 };

interface LogFilterFormValues {
  requestId?: string;
  status?: string;
  model?: string;
  authProvider?: string;
  userName?: string;
  providerUserId?: string;
}

export default function AdminRequestLogsPage() {
  const [form] = Form.useForm<LogFilterFormValues>();
  const [filters, setFilters] = useState<RequestLogFilters>(initialFilters);
  const [result, setResult] = useState<RequestLogPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<RequestLogDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [trace, setTrace] = useState<AdminTrace | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void loadRequestLogs(filters)
      .then((page) => {
        if (active) setResult(page);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof AdminApiError && caught.status === 401) {
          redirectToAdminLogin();
          return;
        }
        setError(caught instanceof Error ? caught.message : '请求日志加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters]);

  function applyFilters(values: LogFilterFormValues) {
    const next: RequestLogFilters = {
      page: 1,
      pageSize: 20,
    };
    if (values.requestId) next.requestId = values.requestId;
    if (values.status) next.status = values.status;
    if (values.model) next.model = values.model;
    if (values.authProvider) next.authProvider = values.authProvider;
    if (values.userName) next.userName = values.userName;
    if (values.providerUserId) next.providerUserId = values.providerUserId;
    setFilters(next);
  }

  async function openDetail(requestId: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    try {
      setDetail(await loadRequestLogDetail(requestId));
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.status === 401) {
        redirectToAdminLogin();
        return;
      }
      setDetailError(caught instanceof Error ? caught.message : '详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  }

  async function openTrace(requestId: string) {
    setTraceLoading(true);
    setTraceError('');
    setTrace(null);
    try {
      setTrace(await loadRequestTrace(requestId));
    } catch (caught) {
      setTraceError(caught instanceof Error ? caught.message : '调用链暂不可用');
    } finally {
      setTraceLoading(false);
    }
  }

  function closeDetail() {
    setDetailOpen(false);
    setDetail(null);
    setDetailError('');
  }

  const columns: ColumnsType<RequestLogListItem> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: 'Request ID',
      dataIndex: 'requestId',
      width: 180,
      ellipsis: true,
      render: (value: string) => (
        <Typography.Link
          title={value}
          onClick={() => openDetail(value)}
          style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}
        >
          {abbreviateMiddle(value)}
        </Typography.Link>
      ),
    },
    {
      title: '用户',
      key: 'user',
      width: 180,
      render: (_, row) => `${row.user.userName} · ${row.user.authProvider}`,
    },
    { title: '模型', dataIndex: 'modelAlias', width: 100 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: string) => {
        const color = STATUS_TAG_COLORS[value.toLowerCase()] ?? 'default';
        return <Tag color={color}>{value}</Tag>;
      },
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      render: (value: number | null) => (value === null ? '—' : `${value} ms`),
    },
    {
      title: 'Token',
      key: 'tokens',
      width: 80,
      render: (_, row) => row.billing?.totalTokens ?? '—',
    },
    {
      title: '费用',
      key: 'cost',
      width: 120,
      render: (_, row) =>
        row.billing?.estimatedCostCny ? `¥${row.billing.estimatedCostCny}` : '—',
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        请求日志
      </Typography.Title>

      <Form
        form={form}
        layout="vertical"
        initialValues={initialFilters}
        onFinish={applyFilters}
        style={{ marginBottom: 16 }}
      >
        <Row gutter={16}>
          <Col xs={24} sm={12} md={4}>
            <Form.Item label="Request ID" name="requestId">
              <Input placeholder="UUID" allowClear />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Form.Item label="状态" name="status">
              <Select allowClear placeholder="全部" options={STATUS_OPTIONS} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Form.Item label="模型" name="model">
              <Select allowClear placeholder="全部" options={MODEL_OPTIONS} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Form.Item label="登录方式" name="authProvider">
              <Select allowClear placeholder="全部" options={AUTH_PROVIDER_OPTIONS} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Form.Item label="用户名称" name="userName">
              <Input placeholder="不区分大小写" allowClear />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Form.Item label="Provider ID" name="providerUserId">
              <Input placeholder="精确匹配" allowClear />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Form.Item label=" ">
              <Space>
                <Button type="primary" htmlType="submit">
                  筛选
                </Button>
                <Button
                  onClick={() => {
                    form.resetFields();
                    setFilters(initialFilters);
                  }}
                >
                  重置
                </Button>
              </Space>
            </Form.Item>
          </Col>
        </Row>
      </Form>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}

      <Table
        rowKey="requestId"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={result?.items ?? []}
        scroll={{ x: 1100 }}
        locale={{ emptyText: '暂无匹配记录' }}
        pagination={{
          current: result?.page ?? filters.page ?? 1,
          pageSize: result?.pageSize ?? filters.pageSize ?? 20,
          total: result?.total ?? 0,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page) => setFilters((current) => ({ ...current, page })),
        }}
      />

      <Drawer title="请求详情" size={720} open={detailOpen} onClose={closeDetail} destroyOnHidden>
        {detailLoading ? (
          <Typography.Text type="secondary">正在加载详情…</Typography.Text>
        ) : detailError ? (
          <Alert type="error" showIcon title={detailError} />
        ) : detail ? (
          <>
            <DetailContent detail={detail} />
            <div style={{ marginTop: 20 }}>
              <Button onClick={() => void openTrace(detail.requestId)} loading={traceLoading}>
                查看调用链
              </Button>
              {traceError ? (
                <Alert type="warning" showIcon message={traceError} style={{ marginTop: 12 }} />
              ) : null}
              {trace ? <TraceContent trace={trace} /> : null}
            </div>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

function TraceContent({ trace }: { trace: AdminTrace }) {
  const infrastructure = `基础设施：数据库 ${trace.infrastructure.databaseCalls} 次 · Redis ${trace.infrastructure.redisCalls} 次 · HTTP ${trace.infrastructure.httpCalls} 次`;
  if (trace.spans.length === 0)
    return (
      <Alert
        type="info"
        showIcon
        message={`未记录 Agent 业务步骤。${infrastructure}`}
        style={{ marginTop: 12 }}
      />
    );
  return (
    <div style={{ marginTop: 16 }}>
      <Typography.Title level={5}>
        调用链{trace.traceId ? ` · ${trace.traceId}` : ''}
      </Typography.Title>
      <Typography.Text type="secondary">{infrastructure}</Typography.Text>
      <Table
        size="small"
        rowKey="spanId"
        pagination={false}
        dataSource={trace.spans}
        columns={[
          { title: '步骤', dataIndex: 'name' },
          {
            title: '耗时',
            dataIndex: 'durationMs',
            render: (value: number) => `${Math.round(value)} ms`,
          },
          {
            title: '状态',
            dataIndex: 'status',
            render: (value: string) => (
              <Tag color={value === 'error' ? 'error' : value === 'ok' ? 'success' : 'default'}>
                {value}
              </Tag>
            ),
          },
          {
            title: '受控元数据',
            dataIndex: 'attributes',
            render: (value: Record<string, unknown>) =>
              Object.entries(value)
                .map(([key, item]) => `${key}: ${item}`)
                .join(' · ') || '—',
          },
        ]}
      />
    </div>
  );
}

function DetailContent({ detail }: { detail: RequestLogDetail }) {
  const fields: Array<[string, unknown]> = [
    ['Request ID', detail.requestId],
    ['登录方式', detail.user.authProvider],
    ['用户名称', detail.user.userName],
    ['Provider ID', detail.user.providerUserId],
    ['平台用户 ID', detail.user.id],
    ['状态', detail.status],
    ['模型 alias', detail.modelAlias],
    ['Provider', detail.provider],
    ['Resolved model', detail.resolvedModel],
    ['Provider request ID', detail.providerRequestId],
    ['耗时', detail.durationMs === null ? null : `${detail.durationMs} ms`],
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Row gutter={[16, 8]}>
        {fields.map(([label, value]) => (
          <Col key={label} xs={24} sm={12}>
            <Typography.Text type="secondary">{label}</Typography.Text>
            <div>
              <Typography.Text>
                {value === null || value === undefined ? '—' : String(value)}
              </Typography.Text>
            </div>
          </Col>
        ))}
      </Row>
      <JsonSection title="完整 Provider Prompt / Messages（调用输入快照）" value={detail.prompt} />
      {detail.agentRun ? (
        <JsonSection
          title="完整 Agent Run Messages（含输出与工具结果）"
          value={{
            runId: detail.agentRun.id,
            threadId: detail.agentRun.threadId,
            status: detail.agentRun.status,
            input: detail.agentRun.input,
            messages: detail.agentRun.messages,
          }}
        />
      ) : null}
      <JsonSection title="Usage / Cost" value={detail.billing} />
      <JsonSection
        title="Failover"
        value={{ from: detail.failoverFrom, to: detail.failoverTo, reason: detail.failoverReason }}
      />
      <JsonSection
        title="完整错误"
        value={{
          code: detail.errorCode,
          message: detail.errorMessage,
          details: detail.errorDetails,
        }}
      />
      {detail.imageTask ? <JsonSection title="图片任务" value={detail.imageTask} /> : null}
      <JsonSection title="Metadata" value={detail.metadata} />
    </Space>
  );
}

function JsonSection({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <Typography.Title level={5}>{title}</Typography.Title>
      <pre
        style={{
          margin: 0,
          padding: 12,
          background: '#f5f5f5',
          borderRadius: 6,
          fontSize: 12,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {JSON.stringify(value, null, 2) ?? 'null'}
      </pre>
    </div>
  );
}

function abbreviateMiddle(value: string, head = 8, tail = 8): string {
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}**${value.slice(-tail)}`;
}

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const AUTH_PROVIDER_OPTIONS = [
  { value: 'ANONYMOUS', label: 'Anonymous' },
  { value: 'GITHUB', label: 'GitHub' },
  { value: 'GOOGLE', label: 'Google' },
];

const STATUS_TAG_COLORS: Record<string, string> = {
  pending: 'processing',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'default',
};

const MODEL_OPTIONS = [
  'qwen',
  'glm',
  'deepseek',
  'kimi',
  'qwen-image',
  'wan-image',
  'kling-image',
  'vidu-image',
].map((model) => ({
  value: model,
  label: model,
}));
