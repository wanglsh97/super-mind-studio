import assert from 'node:assert/strict';
import test from 'node:test';

import type { CreativeItem } from '@supermind/sdk';

import { resolveWebsiteDeliveryCardState } from './website-delivery-state';

const current: CreativeItem = {
  id: 'creation-1',
  projectId: 'project-1',
  type: 'website',
  status: 'succeeded',
  title: '官网',
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T01:00:00.000Z',
  expiresAt: '2026-09-04T01:00:00.000Z',
  runId: 'run-new',
};

test('marks only the current delivery run as active', () => {
  assert.equal(resolveWebsiteDeliveryCardState([current], 'project-1', 'run-new'), 'current');
  assert.equal(resolveWebsiteDeliveryCardState([current], 'project-1', 'run-old'), 'superseded');
  assert.equal(resolveWebsiteDeliveryCardState([], 'project-1', 'run-new'), 'superseded');
});
