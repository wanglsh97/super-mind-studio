import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseNamespacedMcpToolName, summarizeAgentMcpStatuses } from './agent-mcp-status';

describe('Agent MCP UI helpers', () => {
  it('summarizes ready/error servers and registered tools', () => {
    assert.deepEqual(
      summarizeAgentMcpStatuses([
        {
          id: 'docs',
          name: 'Docs',
          version: '1',
          description: '',
          enabled: true,
          status: 'ready',
          allowedToolCount: 2,
          discoveredToolCount: 3,
          registeredToolCount: 2,
          errorCode: null,
        },
        {
          id: 'crm',
          name: 'CRM',
          version: 'unknown',
          description: '',
          enabled: true,
          status: 'error',
          allowedToolCount: 1,
          discoveredToolCount: 0,
          registeredToolCount: 0,
          errorCode: 'MCP_TIMEOUT',
        },
      ]),
      { serverCount: 2, readyCount: 1, errorCount: 1, registeredToolCount: 2 },
    );
  });

  it('parses only namespaced MCP tool names', () => {
    assert.deepEqual(parseNamespacedMcpToolName('mcp__docs__lookup'), {
      serverId: 'docs',
      remoteToolName: 'lookup',
    });
    assert.equal(parseNamespacedMcpToolName('web_search'), null);
    assert.equal(parseNamespacedMcpToolName('mcp__bad server__lookup'), null);
  });
});
