'use client'

import { Alert, Card, Col, Empty, Row, Skeleton, Statistic, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { EChartsOption } from 'echarts'
import { useEffect, useState } from 'react'

import { DashboardChart } from '../../../components/admin/dashboard-chart'
import { AnalyticsChart } from '../../../components/analytics-chart'
import { TokenCalendarHeatmap } from '../../../components/token-calendar-heatmap'
import { redirectToAdminLogin } from '../../../lib/admin-auth-client'
import { loadDashboard } from '../../../lib/admin-dashboard-data'
import type {
  DashboardData,
  DashboardErrors,
  DashboardLatencies,
  DashboardSection,
  DashboardTrends,
  DashboardTokenAnalytics,
} from '../../../lib/admin-dashboard-data'

export default function AdminHomePage() {
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    let active = true
    void loadDashboard().then((loaded) => {
      if (!active) return
      if (
        Object.values(loaded).some((section) => section.status === 'error' && section.unauthorized)
      ) {
        redirectToAdminLogin()
        return
      }
      setData(loaded)
    })
    return () => {
      active = false
    }
  }, [])

  if (!data) {
    return (
      <div>
        <Skeleton active paragraph={{ rows: 1 }} />
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          {Array.from({ length: 4 }, (_, index) => (
            <Col key={index} xs={24} sm={12} xl={6}>
              <Card>
                <Skeleton active paragraph={false} />
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    )
  }

  const overview = data.overview.status === 'success' ? data.overview.data : null

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        运行概览
      </Typography.Title>
      {overview?.generatedAt ? (
        <Typography.Text type="secondary">
          数据更新时间：{new Date(overview.generatedAt).toLocaleString('zh-CN')}
        </Typography.Text>
      ) : null}

      {data.overview.status === 'error' ? (
        <SectionError section={data.overview} />
      ) : (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              <Statistic title="今日请求" value={overview?.requestCount ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              {overview?.successRate === null ? (
                <Statistic title="成功率" value="暂无数据" />
              ) : (
                <Statistic
                  title="成功率"
                  value={(overview?.successRate ?? 0) * 100}
                  precision={1}
                  suffix="%"
                />
              )}
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              <Statistic
                title="预估费用"
                prefix="¥"
                value={overview?.estimatedCostCny ?? '0'}
                precision={8}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              <Statistic
                title="健康模型"
                value={`${overview?.health.filter(({ status }) => status === 'healthy').length ?? 0}/${overview?.health.length ?? 0}`}
              />
            </Card>
          </Col>
        </Row>
      )}

      <TokenAnalyticsSection section={data.tokenAnalytics} />

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={12}>
          <Card title="24 小时请求趋势">
            {data.trends.status === 'error' ? (
              <SectionError section={data.trends} />
            ) : data.trends.data.buckets.every(({ requests }) => requests === 0) ? (
              <Empty description="暂无数据" />
            ) : (
              <DashboardChart
                label="24 小时请求趋势图"
                option={trendOption(data.trends.data.buckets)}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="模型延迟">
            {data.latencies.status === 'error' ? (
              <SectionError section={data.latencies} />
            ) : data.latencies.data.length === 0 ? (
              <Empty description="暂无数据" />
            ) : (
              <DashboardChart label="模型平均延迟图" option={latencyOption(data.latencies.data)} />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="最近错误" style={{ marginTop: 16 }}>
        {data.errors.status === 'error' ? (
          <SectionError section={data.errors} />
        ) : data.errors.data.length === 0 ? (
          <Empty description="暂无错误记录" />
        ) : (
          <Table
            rowKey="requestId"
            size="small"
            pagination={false}
            columns={errorColumns}
            dataSource={data.errors.data}
          />
        )}
      </Card>
    </div>
  )
}

function TokenAnalyticsSection({
  section,
}: {
  section: DashboardSection<DashboardTokenAnalytics>
}) {
  if (section.status === 'error') {
    return (
      <Card title="Token 使用" style={{ marginTop: 16 }}>
        <SectionError section={section} />
      </Card>
    )
  }
  const data = section.data
  return (
    <section style={{ marginTop: 24 }} aria-labelledby="token-analytics-title">
      <Typography.Title id="token-analytics-title" level={4}>
        Token 使用
      </Typography.Title>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        <Card size="small">
          <Statistic title="今日总量" value={data.today.totalTokens} />
        </Card>
        <Card size="small">
          <Statistic title="输入" value={data.today.inputTokens} />
        </Card>
        <Card size="small">
          <Statistic title="输出" value={data.today.outputTokens} />
        </Card>
        <Card size="small">
          <Statistic title="缓存" value={data.today.cachedInputTokens} />
        </Card>
        <Card size="small">
          <Statistic title="思考" value={data.today.reasoningTokens} />
        </Card>
      </div>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={14}>
          <Card title="最近 3 个月 Token 日历">
            <TokenCalendarHeatmap
              from={data.heatmap.from}
              to={data.heatmap.to}
              days={data.heatmap.daily}
              ariaLabel="全站最近三个月每日 Token 使用热力图"
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="今日模型用量">
            {data.models.length === 0 ? (
              <Empty description="今日暂无 Token 数据" />
            ) : (
              <AnalyticsChart
                label="今日各模型 Token 总量"
                height={210}
                option={modelTokenOption(data.models)}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="模型 Token 明细" style={{ marginTop: 16 }}>
        <Table
          rowKey="model"
          size="small"
          pagination={false}
          columns={tokenModelColumns}
          dataSource={data.models}
          locale={{ emptyText: '今日暂无 Token 数据' }}
        />
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={12}>
          <Card title="Skill Token 归因">
            {data.skills.length === 0 ? (
              <Empty description="今日暂无 Skill 归因数据" />
            ) : (
              <AnalyticsChart
                label="今日 Skill Token 使用"
                height={220}
                option={attributionOption(data.skills)}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="Tool Token 归因">
            {data.tools.length === 0 ? (
              <Empty description="今日暂无 Tool 归因数据" />
            ) : (
              <AnalyticsChart
                label="今日 Tool Token 使用"
                height={220}
                option={attributionOption(data.tools)}
              />
            )}
          </Card>
        </Col>
      </Row>
    </section>
  )
}

const errorColumns: ColumnsType<DashboardErrors[number]> = [
  {
    title: 'Request ID',
    dataIndex: 'requestId',
    width: 280,
    render: (value: string) => (
      <Typography.Text code copyable={{ text: value }}>
        {value}
      </Typography.Text>
    ),
  },
  {
    title: '错误',
    key: 'error',
    render: (_, row) => `${row.errorCode ?? 'UNKNOWN'} · ${row.errorMessage ?? '未知错误'}`,
  },
  {
    title: '模型',
    dataIndex: 'modelAlias',
    width: 120,
  },
  {
    title: '能力',
    dataIndex: 'capability',
    width: 100,
  },
]

const tokenModelColumns: ColumnsType<DashboardTokenAnalytics['models'][number]> = [
  { title: '模型', dataIndex: 'model', key: 'model' },
  { title: '总量', dataIndex: 'totalTokens', align: 'right' },
  { title: '输入', dataIndex: 'inputTokens', align: 'right' },
  { title: '输出', dataIndex: 'outputTokens', align: 'right' },
  { title: '缓存', dataIndex: 'cachedInputTokens', align: 'right' },
  { title: '思考', dataIndex: 'reasoningTokens', align: 'right' },
  {
    title: 'Cache 率',
    dataIndex: 'cacheRate',
    align: 'right',
    render: (value: number) => `${(value * 100).toFixed(1)}%`,
  },
  { title: '调用', dataIndex: 'modelCalls', align: 'right' },
]

function SectionError({
  section,
}: {
  section: Extract<DashboardSection<unknown>, { status: 'error' }>
}) {
  return <Alert type="error" showIcon message={section.message} style={{ marginTop: 16 }} />
}

function trendOption(buckets: DashboardTrends['buckets']): EChartsOption {
  return {
    color: ['#1677ff', '#52c41a', '#ff4d4f'],
    tooltip: { trigger: 'axis' },
    legend: { data: ['请求', '成功', '失败'] },
    grid: { left: 48, right: 16, top: 48, bottom: 32 },
    xAxis: {
      type: 'category',
      data: buckets.map(({ start }) =>
        new Date(start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      ),
    },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      { name: '请求', type: 'line', smooth: true, data: buckets.map(({ requests }) => requests) },
      { name: '成功', type: 'line', smooth: true, data: buckets.map(({ succeeded }) => succeeded) },
      { name: '失败', type: 'line', smooth: true, data: buckets.map(({ failed }) => failed) },
    ],
  }
}

function latencyOption(rows: DashboardLatencies): EChartsOption {
  return {
    color: ['#1677ff', '#13c2c2'],
    tooltip: { trigger: 'axis' },
    legend: { data: ['总耗时', 'TTFB'] },
    grid: { left: 48, right: 16, top: 48, bottom: 32 },
    xAxis: { type: 'category', data: rows.map(({ model }) => model) },
    yAxis: { type: 'value', name: 'ms' },
    series: [
      { name: '总耗时', type: 'bar', data: rows.map(({ averageDurationMs }) => averageDurationMs) },
      { name: 'TTFB', type: 'bar', data: rows.map(({ averageTtfbMs }) => averageTtfbMs) },
    ],
  }
}

function modelTokenOption(rows: DashboardTokenAnalytics['models']): EChartsOption {
  return {
    color: ['#10b981'],
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 110, right: 16, top: 8, bottom: 24 },
    xAxis: { type: 'value' },
    yAxis: {
      type: 'category',
      data: rows.map(({ model }) => model),
      axisLabel: { width: 100, overflow: 'truncate' },
    },
    series: [{ type: 'bar', data: rows.map(({ totalTokens }) => totalTokens), barMaxWidth: 18 }],
  }
}

function attributionOption(rows: Array<{ name: string; totalTokens: number }>): EChartsOption {
  const top = rows.slice(0, 8).reverse()
  return {
    color: ['#6366f1'],
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 112, right: 18, top: 8, bottom: 24 },
    xAxis: { type: 'value' },
    yAxis: {
      type: 'category',
      data: top.map(({ name }) => name),
      axisLabel: { width: 100, overflow: 'truncate' },
    },
    series: [{ type: 'bar', data: top.map(({ totalTokens }) => totalTokens), barMaxWidth: 16 }],
  }
}
