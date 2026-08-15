import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { threadTokenUsagePercentage } from './agent-thread-token-usage';

describe('threadTokenUsagePercentage', () => {
  it('compares the entire Thread token estimate with the model context window', () => {
    assert.equal(
      threadTokenUsagePercentage({
        totalTokens: 250_000,
        contextWindowTokens: 1_000_000,
        estimated: true,
      }),
      25,
    );
  });

  it('keeps cumulative percentages above 100 while bounding extreme display values', () => {
    assert.equal(
      threadTokenUsagePercentage({
        totalTokens: 2_500_000,
        contextWindowTokens: 1_000_000,
        estimated: true,
      }),
      250,
    );
    assert.equal(
      threadTokenUsagePercentage({
        totalTokens: 20_000_000,
        contextWindowTokens: 1_000_000,
        estimated: true,
      }),
      999,
    );
  });

  it('does not invent a percentage when the bound model is no longer in the catalog', () => {
    assert.equal(
      threadTokenUsagePercentage({
        totalTokens: 250_000,
        contextWindowTokens: null,
        estimated: true,
      }),
      null,
    );
  });
});
