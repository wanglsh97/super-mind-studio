import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AgentSkillMarketDetail, AgentSkillMarketSummary } from './agent-skill-types.js';
import type { CreateAgentRunRequest } from './agent-types.js';

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('executable Skill public contracts', () => {
  it('serializes market summaries and details without package contents or OSS credentials', () => {
    const summary: AgentSkillMarketSummary = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'data-cleaner',
      title: '数据清洗',
      description: '清洗 CSV 并导出结果。',
      category: 'data',
      publicationStatus: 'published',
      addState: 'added',
      addCount: 12,
      ownedByCurrentUser: true,
      updatedAt: '2026-07-23T12:00:00.000Z',
    };
    const detail: AgentSkillMarketDetail = {
      ...summary,
      skillMarkdown: '# Data Cleaner\n\nRun the bundled script.',
      files: [
        { path: 'SKILL.md', type: 'file', size: 45 },
        { path: 'scripts', type: 'directory', size: null },
        { path: 'scripts/clean.mjs', type: 'file', size: 128 },
      ],
    };

    assert.deepEqual(jsonRoundTrip(summary), summary);
    assert.deepEqual(jsonRoundTrip(detail), detail);
    assert.equal(JSON.stringify(detail).includes('signature='), false);
  });

  it('serializes manual Skill selection by globally unique name', () => {
    const request: CreateAgentRunRequest = {
      input: '清洗我上传的数据',
      skills: [{ name: 'data-cleaner' }],
    };

    assert.deepEqual(jsonRoundTrip(request), request);
    assert.deepEqual(
      request.skills?.map((skill) => skill.name),
      ['data-cleaner'],
    );
  });
});
