import { strict as assert } from 'node:assert';
import test from 'node:test';

import { creationExpiryLabel, filterCreations } from './creations-view';

const item = (type: 'website' | 'image') => ({
  id: type,
  type,
  status: 'succeeded',
  title: type,
  createdAt: '',
  updatedAt: '',
  expiresAt: null,
});

test('filters unified creations by type without mutating the source list', () => {
  const items = [item('website'), item('image')];
  assert.deepEqual(
    filterCreations(items, 'website').map((value) => value.type),
    ['website'],
  );
  assert.deepEqual(filterCreations(items, 'all'), items);
});

test('labels expired assets without offering a deletion date', () => {
  assert.equal(
    creationExpiryLabel({ status: 'expired', expiresAt: '2026-08-01T00:00:00.000Z' }),
    '产物已过期',
  );
});
