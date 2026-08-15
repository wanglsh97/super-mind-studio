import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

export const ADMIN_TABLE_NAMES = [
  'users',
  'user-sessions',
  'request-logs',
  'billing-records',
  'image-generation-tasks',
  'video-generation-tasks',
  'admin-audit-logs',
  'agent-threads',
  'agent-messages',
  'agent-runs',
  'agent-events',
  'agent-tool-calls',
] as const;

export type AdminTableName = (typeof ADMIN_TABLE_NAMES)[number];
export type AdminTableOperation = 'query' | 'create' | 'update' | 'delete';
export type AdminFieldKind =
  'string' | 'number' | 'boolean' | 'decimal' | 'datetime' | 'json' | 'enum';

export interface AdminTableFieldCapability {
  name: string;
  label: string;
  kind: AdminFieldKind;
  nullable: boolean;
  editable: boolean;
}

export interface AdminTableRelation {
  field: string;
  targetTable: AdminTableName;
  targetField: string;
  label: string;
}

export interface AdminTableCapability {
  name: AdminTableName;
  /** PostgreSQL 物理表名（Prisma @@map 未配置时与 model 名一致）。 */
  physicalName: string;
  label: string;
  primaryKey: string;
  operations: readonly AdminTableOperation[];
  fields: readonly AdminTableFieldCapability[];
  relations: readonly AdminTableRelation[];
}

export interface AdminTableSchemaRelation extends AdminTableRelation {
  sourceTable: AdminTableName;
}

export interface AdminTableSchema {
  tables: readonly AdminTableCapability[];
  relations: readonly AdminTableSchemaRelation[];
}

const QUERY_ONLY = Object.freeze(['query'] as const);

const field = (
  name: string,
  label: string,
  kind: AdminFieldKind,
  nullable = false,
): AdminTableFieldCapability => Object.freeze({ name, label, kind, nullable, editable: false });

const relation = (
  field: string,
  targetTable: AdminTableName,
  targetField: string,
  label: string,
): AdminTableRelation => Object.freeze({ field, targetTable, targetField, label });

const capabilities: readonly AdminTableCapability[] = Object.freeze([
  Object.freeze({
    name: 'users',
    physicalName: 'User',
    label: '用户',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([
      relation('id', 'user-sessions', 'userId', '会话'),
      relation('id', 'request-logs', 'userId', '请求日志'),
      relation('id', 'image-generation-tasks', 'userId', '文生图任务'),
      relation('id', 'video-generation-tasks', 'userId', '视频任务'),
      relation('id', 'agent-threads', 'userId', 'Agent 线程'),
      relation('id', 'agent-runs', 'userId', 'Agent 运行'),
    ]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('authProvider', '登录方式', 'enum'),
      field('providerUserId', 'Provider ID', 'string'),
      field('userName', '用户名称', 'string'),
      field('avatarUrl', '头像 URL', 'string', true),
      field('email', '邮箱', 'string', true),
      field('lastLoginAt', '最近登录', 'datetime'),
      field('createdAt', '创建时间', 'datetime'),
      field('updatedAt', '更新时间', 'datetime'),
    ]),
  }),
  Object.freeze({
    name: 'user-sessions',
    physicalName: 'UserSession',
    label: '用户会话',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([relation('userId', 'users', 'id', '用户')]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('userId', '用户 ID', 'string'),
      field('tokenHash', 'Token Hash', 'string'),
      field('expiresAt', '过期时间', 'datetime'),
      field('lastSeenAt', '最近活跃', 'datetime'),
      field('createdAt', '创建时间', 'datetime'),
    ]),
  }),
  Object.freeze({
    name: 'request-logs',
    physicalName: 'RequestLog',
    label: '调用日志',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([
      relation('userId', 'users', 'id', '用户'),
      relation('agentRunId', 'agent-runs', 'id', 'Agent 运行'),
      relation('id', 'billing-records', 'requestLogId', '计费'),
      relation('id', 'image-generation-tasks', 'requestLogId', '文生图任务'),
      relation('id', 'video-generation-tasks', 'requestLogId', '视频任务'),
    ]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('requestId', 'Request ID', 'string'),
      field('capability', '能力', 'enum'),
      field('modelAlias', '模型 Alias', 'string'),
      field('provider', 'Provider', 'string', true),
      field('resolvedModel', '实际模型', 'string', true),
      field('providerRequestId', 'Provider Request ID', 'string', true),
      field('status', '状态', 'enum'),
      field('stream', '流式', 'boolean'),
      field('clientIp', '客户端 IP', 'string', true),
      field('startedAt', '开始时间', 'datetime'),
      field('firstTokenAt', '首 Token 时间', 'datetime', true),
      field('completedAt', '完成时间', 'datetime', true),
      field('durationMs', '耗时 (ms)', 'number', true),
      field('failoverFrom', 'Failover From', 'string', true),
      field('failoverTo', 'Failover To', 'string', true),
      field('failoverReason', 'Failover 原因', 'string', true),
      field('errorCode', '错误码', 'string', true),
      field('errorMessage', '错误信息', 'string', true),
      field('errorDetails', '错误详情', 'json', true),
      field('metadata', 'Metadata', 'json', true),
      field('userId', '用户 ID', 'string'),
      field('agentRunId', 'Agent Run ID', 'string', true),
      field('createdAt', '创建时间', 'datetime'),
      field('updatedAt', '更新时间', 'datetime'),
    ]),
  }),
  Object.freeze({
    name: 'billing-records',
    physicalName: 'BillingRecord',
    label: '计费明细',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([relation('requestLogId', 'request-logs', 'id', '请求日志')]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('requestLogId', 'RequestLog ID', 'string'),
      field('inputTokens', '输入 Token', 'number', true),
      field('outputTokens', '输出 Token', 'number', true),
      field('totalTokens', '总 Token', 'number', true),
      field('usageUnknown', 'Usage 未知', 'boolean'),
      field('priceVersion', '价格版本', 'string', true),
      field('inputCostCny', '输入费用', 'decimal', true),
      field('outputCostCny', '输出费用', 'decimal', true),
      field('estimatedCostCny', '预估费用', 'decimal', true),
      field('createdAt', '创建时间', 'datetime'),
      field('updatedAt', '更新时间', 'datetime'),
    ]),
  }),
  Object.freeze({
    name: 'image-generation-tasks',
    physicalName: 'ImageGenerationTask',
    label: '文生图任务',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([
      relation('userId', 'users', 'id', '用户'),
      relation('requestLogId', 'request-logs', 'id', '请求日志'),
    ]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('taskId', 'Task ID', 'string'),
      field('requestLogId', 'RequestLog ID', 'string'),
      field('providerTaskId', 'Provider Task ID', 'string', true),
      field('modelAlias', '模型 Alias', 'string'),
      field('provider', 'Provider', 'string', true),
      field('resolvedModel', '实际模型', 'string', true),
      field('options', '生成参数', 'json', true),
      field('status', '状态', 'enum'),
      field('results', '结果', 'json', true),
      field('errorCode', '错误码', 'string', true),
      field('errorMessage', '错误信息', 'string', true),
      field('lastPolledAt', '最近轮询', 'datetime', true),
      field('startedAt', '开始时间', 'datetime', true),
      field('completedAt', '完成时间', 'datetime', true),
      field('userId', '用户 ID', 'string'),
      field('createdAt', '创建时间', 'datetime'),
      field('updatedAt', '更新时间', 'datetime'),
    ]),
  }),
  Object.freeze({
    name: 'video-generation-tasks',
    physicalName: 'VideoGenerationTask',
    label: '视频生成任务',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([
      relation('userId', 'users', 'id', '用户'),
      relation('requestLogId', 'request-logs', 'id', '请求日志'),
      relation('agentRunId', 'agent-runs', 'id', 'Agent 运行'),
    ]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('taskId', 'Task ID', 'string'),
      field('providerTaskId', 'Provider Task ID', 'string', true),
      field('provider', 'Provider', 'string'),
      field('resolvedModel', '实际模型', 'string'),
      field('status', '平台状态', 'enum'),
      field('providerFinalStatus', 'Provider 最终状态', 'string', true),
      field('inputMode', '输入模式', 'enum'),
      field('durationSeconds', '生成秒数', 'number'),
      field('audio', '音频', 'boolean'),
      field('options', '生成参数', 'json'),
      field('candidateAudit', '路由审计', 'json'),
      field('estimatedCostCny', '估算费用（人民币）', 'decimal'),
      field('errorCode', '错误码', 'string', true),
      field('errorMessage', '错误信息', 'string', true),
      field('startedAt', '开始时间', 'datetime', true),
      field('cancelledAt', '取消时间', 'datetime', true),
      field('timedOutAt', '超时时间', 'datetime', true),
      field('completedAt', '完成时间', 'datetime', true),
      field('userId', '用户 ID', 'string'),
      field('requestLogId', 'RequestLog ID', 'string'),
      field('agentRunId', 'Agent Run ID', 'string', true),
      field('createdAt', '创建时间', 'datetime'),
      field('updatedAt', '更新时间', 'datetime'),
    ]),
  }),
  Object.freeze({
    name: 'admin-audit-logs',
    physicalName: 'AdminAuditLog',
    label: '管理员操作审计',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('actor', '操作者', 'string'),
      field('action', '操作', 'enum'),
      field('targetTable', '目标表', 'string'),
      field('targetId', '目标记录', 'string'),
      field('beforeData', '变更前', 'json', true),
      field('afterData', '变更后', 'json', true),
      field('requestId', 'Request ID', 'string', true),
      field('sourceIp', '来源 IP', 'string', true),
      field('createdAt', '创建时间', 'datetime'),
    ]),
  }),
  Object.freeze({
    name: 'agent-threads',
    physicalName: 'AgentThread',
    label: 'Agent 线程',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([
      relation('userId', 'users', 'id', '用户'),
      relation('id', 'agent-messages', 'threadId', '消息'),
      relation('id', 'agent-runs', 'threadId', '运行'),
    ]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('userId', '用户 ID', 'string'),
      field('title', '标题', 'string'),
      field('modelId', '模型 ID', 'string'),
      field('provider', 'Provider', 'string'),
      field('createdAt', '创建时间', 'datetime'),
      field('updatedAt', '更新时间', 'datetime'),
    ]),
  }),
  Object.freeze({
    name: 'agent-messages',
    physicalName: 'AgentMessage',
    label: 'Agent 消息',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([
      relation('threadId', 'agent-threads', 'id', '线程'),
      relation('runId', 'agent-runs', 'id', '运行'),
    ]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('threadId', '线程 ID', 'string'),
      field('runId', '运行 ID', 'string', true),
      field('role', '角色', 'enum'),
      field('sequence', '序号', 'number'),
      field('parts', '内容', 'json'),
      field('createdAt', '创建时间', 'datetime'),
    ]),
  }),
  Object.freeze({
    name: 'agent-runs',
    physicalName: 'AgentRun',
    label: 'Agent 运行',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([
      relation('threadId', 'agent-threads', 'id', '线程'),
      relation('userId', 'users', 'id', '用户'),
      relation('id', 'agent-messages', 'runId', '消息'),
      relation('id', 'agent-events', 'runId', '事件'),
      relation('id', 'agent-tool-calls', 'runId', '工具调用'),
      relation('id', 'request-logs', 'agentRunId', '请求日志'),
    ]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('threadId', '线程 ID', 'string'),
      field('userId', '用户 ID', 'string'),
      field('modelId', '运行模型 ID', 'string'),
      field('provider', '运行模型厂商', 'string'),
      field('status', '状态', 'enum'),
      field('limitReason', '限流原因', 'enum', true),
      field('input', '输入', 'string'),
      field('errorCode', '错误码', 'string', true),
      field('errorMessage', '错误信息', 'string', true),
      field('modelCallCount', '模型调用次数', 'number'),
      field('toolCallCount', '工具调用次数', 'number'),
      field('webFetchCount', 'Web Fetch 次数', 'number'),
      field('inputTokens', '输入 Token', 'number'),
      field('outputTokens', '输出 Token', 'number'),
      field('totalTokens', '总 Token', 'number'),
      field('usageUnknown', 'Usage 未知', 'boolean'),
      field('estimatedCostCny', '预估费用', 'decimal', true),
      field('lastSequence', '最后序号', 'number'),
      field('startedAt', '开始时间', 'datetime', true),
      field('completedAt', '完成时间', 'datetime', true),
      field('createdAt', '创建时间', 'datetime'),
      field('updatedAt', '更新时间', 'datetime'),
    ]),
  }),
  Object.freeze({
    name: 'agent-events',
    physicalName: 'AgentEvent',
    label: 'Agent 事件',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([relation('runId', 'agent-runs', 'id', '运行')]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('runId', '运行 ID', 'string'),
      field('sequence', '序号', 'number'),
      field('type', '类型', 'string'),
      field('payload', 'Payload', 'json'),
      field('createdAt', '创建时间', 'datetime'),
    ]),
  }),
  Object.freeze({
    name: 'agent-tool-calls',
    physicalName: 'AgentToolCall',
    label: 'Agent 工具调用',
    primaryKey: 'id',
    operations: QUERY_ONLY,
    relations: Object.freeze([relation('runId', 'agent-runs', 'id', '运行')]),
    fields: Object.freeze([
      field('id', 'ID', 'string'),
      field('runId', '运行 ID', 'string'),
      field('toolCallId', 'Tool Call ID', 'string'),
      field('toolName', '工具名', 'string'),
      field('args', '参数', 'json'),
      field('status', '状态', 'enum'),
      field('summary', '摘要', 'string', true),
      field('audit', 'Audit', 'json', true),
      field('errorCode', '错误码', 'string', true),
      field('errorMessage', '错误信息', 'string', true),
      field('startedAt', '开始时间', 'datetime'),
      field('completedAt', '完成时间', 'datetime', true),
    ]),
  }),
]);

@Injectable()
export class AdminTableAllowlist {
  list(): readonly AdminTableCapability[] {
    return capabilities;
  }

  schema(): AdminTableSchema {
    const relations = capabilities.flatMap((table) =>
      table.relations.map((item) =>
        Object.freeze({
          ...item,
          sourceTable: table.name,
        }),
      ),
    );
    return Object.freeze({
      tables: capabilities,
      relations,
    });
  }

  resolve(name: string): AdminTableCapability {
    const capability = capabilities.find((candidate) => candidate.name === name);
    if (!capability) throw new NotFoundException('不支持的业务表');
    return capability;
  }

  assertOperation(name: string, operation: AdminTableOperation): AdminTableCapability {
    const capability = this.resolve(name);
    if (!capability.operations.includes(operation)) {
      throw new BadRequestException(`表 ${name} 不允许 ${operation} 操作`);
    }
    return capability;
  }

  assertEditablePatch(name: string, patch: Record<string, unknown>): AdminTableCapability {
    const capability = this.assertOperation(name, 'update');
    return assertAllowedFields(capability, patch, '更新');
  }

  assertCreatableBody(name: string, body: Record<string, unknown>): AdminTableCapability {
    const capability = this.assertOperation(name, 'create');
    return assertAllowedFields(capability, body, '创建');
  }
}

function assertAllowedFields(
  capability: AdminTableCapability,
  body: Record<string, unknown>,
  actionLabel: string,
): AdminTableCapability {
  const editable = new Set(
    capability.fields.filter(({ editable }) => editable).map(({ name }) => name),
  );
  const fields = Object.keys(body);
  if (fields.length === 0) throw new BadRequestException(`${actionLabel}字段不能为空`);
  const rejected = fields.filter((candidate) => !editable.has(candidate));
  if (rejected.length > 0) {
    throw new BadRequestException(`包含不可编辑字段：${rejected.join(', ')}`);
  }
  return capability;
}
