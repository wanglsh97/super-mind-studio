import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareComposerSubmission } from './composer-submission';

test('replays a transformed video-reference message before allowing submit', () => {
  const assetId = 'e8f2cbd1-010c-4e99-86bb-e75591e69d59';
  const transformed = `美女站起来\n\n[当前视频首帧资产ID: ${assetId}]`;
  let transforms = 0;
  const first = prepareComposerSubmission('美女站起来', null, (prompt) => {
    transforms += 1;
    return `${prompt}\n\n[当前视频首帧资产ID: ${assetId}]`;
  });

  assert.deepEqual(first, { kind: 'replay', text: transformed });
  const second = prepareComposerSubmission(transformed, transformed, () => {
    transforms += 1;
    return 'must-not-run';
  });
  assert.deepEqual(second, { kind: 'submit', text: transformed });
  assert.equal(transforms, 1);
});
