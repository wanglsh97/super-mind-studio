import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { agentToolDetailLabels, resolveAgentToolActivityState } from './agent-tool-activity';

describe('resolveAgentToolActivityState', () => {
  it('covers loading, running, success, failed, cancelled and limit states', () => {
    assert.equal(resolveAgentToolActivityState({ loading: true }), 'loading');
    assert.equal(resolveAgentToolActivityState({ running: true }), 'running');
    assert.equal(resolveAgentToolActivityState({ status: 'succeeded' }), 'success');
    assert.equal(resolveAgentToolActivityState({ status: 'failed', isError: true }), 'failed');
    assert.equal(resolveAgentToolActivityState({ status: 'cancelled' }), 'cancelled');
    assert.equal(
      resolveAgentToolActivityState({
        status: 'failed',
        audit: { limitReason: 'shell_calls' },
      }),
      'limit',
    );
  });
});

describe('agentToolDetailLabels', () => {
  it('uses domain-specific labels instead of generic target and result buckets', () => {
    assert.deepEqual(agentToolDetailLabels('shell'), {
      subject: '命令',
      detail: '工作目录',
      summary: '执行摘要',
      audit: '运行数据',
    });
    assert.deepEqual(agentToolDetailLabels('read_file'), {
      subject: '文件',
      detail: '读取范围',
      summary: '读取摘要',
      audit: '文件信息',
    });
    assert.deepEqual(agentToolDetailLabels('web_fetch'), {
      subject: '网址',
      detail: '响应状态',
      summary: '响应摘要',
      audit: '响应信息',
    });
  });
});
