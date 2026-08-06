import assert from 'node:assert/strict';
import test from 'node:test';

import { strToU8, zipSync } from 'fflate';

import { buildWebsiteSourceTree, parseWebsiteSourceArchive } from './website-source-archive';

test('parses safe text files and builds directories before files', async () => {
  const archive = zipSync({
    'src/App.tsx': strToU8('export function App() { return <main />; }'),
    'package.json': strToU8('{"name":"demo"}'),
    'src/assets/logo.bin': Uint8Array.of(1, 0, 2),
  });

  const files = await parseWebsiteSourceArchive(archive);
  assert.deepEqual(
    files.map(({ path, language, content }) => ({ path, language, content })),
    [
      { path: 'package.json', language: 'json', content: '{"name":"demo"}' },
      {
        path: 'src/App.tsx',
        language: 'tsx',
        content: 'export function App() { return <main />; }',
      },
      { path: 'src/assets/logo.bin', language: 'text', content: null },
    ],
  );

  const tree = buildWebsiteSourceTree(files);
  assert.equal(tree[0]?.path, 'src');
  assert.equal(tree[1]?.path, 'package.json');
  assert.equal(tree[0]?.children?.[0]?.path, 'src/assets');
});

test('rejects traversal paths and bounded archive violations', async () => {
  const traversal = zipSync({ '../secret.txt': strToU8('secret') });
  await assert.rejects(() => parseWebsiteSourceArchive(traversal), /无效文件路径/);

  const archive = zipSync({ 'large.txt': strToU8('12345') });
  await assert.rejects(
    () =>
      parseWebsiteSourceArchive(archive, {
        maxCompressedBytes: 1_024,
        maxEntries: 10,
        maxExpandedBytes: 4,
        maxPreviewFileBytes: 4,
      }),
    /解压体积/,
  );
});
