import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSuperMindClient } from './client.js';
import { AIGatewayError } from './errors.js';

const summary = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'data-cleaner',
  title: 'Data Cleaner',
  description: 'Cleans data.',
  category: 'data',
  publicationStatus: 'published',
  addState: 'not_added',
  addCount: 3,
  ownedByCurrentUser: false,
  updatedAt: '2026-07-23T00:00:00.000Z',
};

const owner = {
  id: summary.id,
  name: summary.name,
  title: summary.title,
  description: summary.description,
  category: summary.category,
  publicationStatus: 'pending_review',
  packageSha256: 'a'.repeat(64),
  packageSizeBytes: 10,
};

const review = {
  id: summary.id,
  name: summary.name,
  title: summary.title,
  description: summary.description,
  category: summary.category,
  ownerId: '00000000-0000-4000-8000-000000000002',
  packageSha256: 'a'.repeat(64),
  status: 'PENDING_REVIEW',
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
};

describe('Skill market clients', () => {
  it('encodes URLs, pagination and bodies while forwarding cookie credentials', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/admin/skills/reviews')) return json([review]);
      if (url.includes('/admin/skills/')) return json(review);
      if (url.endsWith('/skills/owner') && init?.method === 'GET') return json([owner]);
      if (url.includes('/skills/owner/')) return json(owner);
      if (url.endsWith('/skills/owner')) return json(owner);
      if (url.endsWith('/add')) return new Response(null, { status: 204 });
      if (url.includes('?')) {
        return json({ items: [summary], page: 2, pageSize: 10, total: 11, totalPages: 2 });
      }
      return json({
        ...summary,
        skillMarkdown: '# Data Cleaner',
        files: [{ path: 'SKILL.md', type: 'file', size: 10 }],
      });
    };
    const client = createSuperMindClient({
      baseUrl: 'https://gateway.example/',
      credentials: 'include',
      fetch: fetchImplementation,
    });

    await client.skills.list({
      page: 2,
      pageSize: 10,
      keyword: 'author name',
      category: 'data',
      sort: 'popular',
    });
    await client.skills.detail('name/空格');
    await client.skills.add('name/空格');
    await client.skills.remove('name/空格');
    await client.skills.owner.list();
    await client.skills.owner.submit({
      uploadSessionId: '00000000-0000-4000-8000-000000000003',
      name: 'data-cleaner',
      title: 'Data Cleaner',
      description: 'Cleans data.',
      category: 'data',
    });
    await client.skills.owner.update('name/空格', {
      uploadSessionId: '00000000-0000-4000-8000-000000000004',
      title: 'Updated',
      description: 'Updated description.',
      category: 'data',
    });
    await client.skills.owner.delist('name/空格');
    await client.admin.skills.listPending();
    await client.admin.skills.approve(review.id);
    await client.admin.skills.reject(review.id, 'missing docs');
    await client.admin.skills.delist(review.id);

    assert.match(
      calls[0]!.url,
      /page=2&pageSize=10&keyword=author\+name&category=data&sort=popular$/,
    );
    assert.ok(calls.some((call) => call.url.includes('/skills/name%2F%E7%A9%BA%E6%A0%BC')));
    assert.ok(calls.every((call) => call.init?.credentials === 'include'));
    assert.equal(
      calls.find((call) => call.init?.method === 'PATCH')?.init?.body,
      JSON.stringify({
        uploadSessionId: '00000000-0000-4000-8000-000000000004',
        title: 'Updated',
        description: 'Updated description.',
        category: 'data',
      }),
    );
    assert.equal(
      calls.find((call) => call.url.endsWith('/reject'))?.init?.body,
      JSON.stringify({ reason: 'missing docs' }),
    );
  });

  it('preserves the normalized gateway error envelope', async () => {
    const client = createSuperMindClient({
      fetch: async () =>
        json(
          {
            requestId: 'request-1',
            code: 'SKILL_NAME_TAKEN',
            message: 'taken',
            retryable: false,
          },
          409,
        ),
    });
    await assert.rejects(
      () => client.skills.list(),
      (error: unknown) =>
        error instanceof AIGatewayError &&
        error.code === 'SKILL_NAME_TAKEN' &&
        error.status === 409 &&
        !error.retryable,
    );
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'request-1' },
  });
}
