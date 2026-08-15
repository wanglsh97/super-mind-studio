import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isCurrentThreadModelSelectionDisabled,
  isCurrentThreadModelUpdatePending,
  shouldUpdateCurrentThreadModel,
  updateThreadModelOptimistically,
} from './agent-model-policy';

describe('Agent Thread model selection policy', () => {
  it('updates the current Thread when an existing session selects a different model', () => {
    assert.equal(shouldUpdateCurrentThreadModel('thread-1', 'qwen3.7-plus', 'glm-5.2'), true);
  });

  it('keeps the blank composer when only choosing a model for a new session', () => {
    assert.equal(shouldUpdateCurrentThreadModel(null, 'qwen3.7-plus', 'glm-5.2'), false);
  });

  it('does nothing when the same model is re-selected', () => {
    assert.equal(shouldUpdateCurrentThreadModel('thread-1', 'qwen3.7-plus', 'qwen3.7-plus'), false);
  });

  it('disables only the Thread that owns an active Run', () => {
    const activeRuns = [{ threadId: 'thread-a' }];
    assert.equal(isCurrentThreadModelSelectionDisabled('thread-a', activeRuns), true);
    assert.equal(isCurrentThreadModelSelectionDisabled('thread-b', activeRuns), false);
    assert.equal(isCurrentThreadModelSelectionDisabled(null, activeRuns), false);
  });

  it('does not treat a new Thread as a pending model update when both ids are null', () => {
    assert.equal(isCurrentThreadModelUpdatePending(null, null), false);
    assert.equal(isCurrentThreadModelUpdatePending('thread-a', null), false);
    assert.equal(isCurrentThreadModelUpdatePending('thread-a', 'thread-b'), false);
    assert.equal(isCurrentThreadModelUpdatePending('thread-a', 'thread-a'), true);
  });

  it('keeps the persisted model on success and rolls back only the still-current Thread on failure', async () => {
    const selected: string[] = [];
    await updateThreadModelOptimistically({
      currentModel: 'qwen3.7-plus',
      nextModel: 'glm-5.2',
      applySelection: (model) => selected.push(model),
      persist: async () => ({ model: 'glm-5.2' }),
      isStillCurrent: () => true,
    });
    assert.deepEqual(selected, ['glm-5.2', 'glm-5.2']);

    await assert.rejects(
      updateThreadModelOptimistically({
        currentModel: 'glm-5.2',
        nextModel: 'deepseek-v3.2',
        applySelection: (model) => selected.push(model),
        persist: async () => {
          throw new Error('active run');
        },
        isStillCurrent: () => true,
      }),
    );
    assert.deepEqual(selected.slice(-2), ['deepseek-v3.2', 'glm-5.2']);
  });
});
