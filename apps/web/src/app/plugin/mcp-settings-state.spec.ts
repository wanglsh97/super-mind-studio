import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AgentMcpServerStatus } from '@supermind/sdk'

import { mcpConnectionLabel, replaceMcpServerStatus } from './mcp-settings-state'

const server: AgentMcpServerStatus = {
  id: 'context7',
  name: 'Context7',
  version: '3.2.5',
  description: '查询软件文档',
  enabled: true,
  status: 'ready',
  allowedToolCount: 2,
  discoveredToolCount: 2,
  registeredToolCount: 2,
  errorCode: null,
}

describe('/plugin settings state', () => {
  it('replaces only the updated server', () => {
    const deepwiki = { ...server, id: 'deepwiki', name: 'DeepWiki' }
    const disabled = {
      ...server,
      enabled: false,
      status: 'disabled' as const,
      registeredToolCount: 0,
    }

    assert.deepEqual(replaceMcpServerStatus([server, deepwiki], disabled), [disabled, deepwiki])
  })

  it('maps enabled and disabled connection states to user-facing labels', () => {
    assert.equal(mcpConnectionLabel(server), '连接正常')
    assert.equal(mcpConnectionLabel({ ...server, enabled: false, status: 'disabled' }), '已停用')
    assert.equal(mcpConnectionLabel({ ...server, status: 'error' }), '连接异常')
  })
})
