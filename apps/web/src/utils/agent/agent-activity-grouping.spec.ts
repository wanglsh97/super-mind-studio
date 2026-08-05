import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { agentActivityPartIndices } from './agent-activity-grouping';

describe('agentActivityPartIndices', () => {
  it('does not wrap a plain final answer', () => {
    assert.deepEqual([...agentActivityPartIndices([{ type: 'text' }])], []);
  });

  it('keeps an entire tool-assisted thought run in one group', () => {
    const parts = [
      { type: 'text' },
      { type: 'reasoning' },
      { type: 'tool-call' },
      { type: 'text' },
      { type: 'reasoning' },
      { type: 'tool-call' },
      { type: 'text' },
    ];

    assert.deepEqual([...agentActivityPartIndices(parts)], [0, 1, 2, 3, 4, 5]);
  });

  it('groups provider reasoning without pulling the answer into the disclosure', () => {
    assert.deepEqual([...agentActivityPartIndices([{ type: 'reasoning' }, { type: 'text' }])], [0]);
  });

  it('keeps the website delivery card outside the collapsed activity group', () => {
    const parts = [
      { type: 'reasoning' },
      { type: 'text' },
      { type: 'tool-call', toolName: 'shell' },
      { type: 'text' },
      { type: 'tool-call', toolName: 'create_website' },
      { type: 'text' },
    ];

    assert.deepEqual([...agentActivityPartIndices(parts)], [0, 1, 2, 3]);
  });
});
