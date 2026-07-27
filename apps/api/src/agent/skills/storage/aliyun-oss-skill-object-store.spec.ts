import { createHash } from 'node:crypto'

import { AliyunOssSkillObjectStore, type OssClientPort } from './aliyun-oss-skill-object-store'
import {
  MOCK_EXECUTABLE_SKILL_PACKAGE,
  MOCK_EXECUTABLE_SKILL_SHA256,
} from '../executable-skill.fixture'

const updatedAt = 'Wed, 23 Jul 2026 12:00:00 GMT'

describe('AliyunOssSkillObjectStore', () => {
  it('refuses a non-private bucket before serving objects', async () => {
    const { client } = fakeClient({ acl: 'public-read' })
    const store = new AliyunOssSkillObjectStore(client, 'skills')
    await expect(store.onModuleInit()).rejects.toThrow('必须为 private')
  })

  it('loads and inspects private Skill packages directly from OSS', async () => {
    const archive = Buffer.from(MOCK_EXECUTABLE_SKILL_PACKAGE.archive)
    const hash = digest(archive)
    const { client, calls } = fakeClient({
      objects: {
        'skills/cleaner/package.zip': {
          bytes: archive,
          headers: headers('skill-package', archive.byteLength, hash, 'application/zip'),
        },
      },
    })
    const store = new AliyunOssSkillObjectStore(client, 'skills')

    await expect(store.onModuleInit()).resolves.toBeUndefined()
    await expect(store.loadSkillPackage('skills/cleaner/package.zip')).resolves.toMatchObject({
      metadata: {
        kind: 'skill-package',
        sizeBytes: archive.byteLength,
        sha256: hash,
      },
      skillMarkdown: expect.stringContaining('# Mock Data Cleaner'),
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'SKILL.md', type: 'file' }),
        expect.objectContaining({ path: 'scripts/clean.mjs', type: 'file' }),
      ]),
    })
    expect(calls).toContain('acl:skills')
    expect(calls).toContain('get:skills/cleaner/package.zip')
  })

  it('writes private user objects, reads defensive bytes and deletes idempotently', async () => {
    const fixture = fakeClient()
    const store = new AliyunOssSkillObjectStore(fixture.client, 'skills')
    const bytes = new TextEncoder().encode('a,b\n1,2\n')

    const written = await store.writeUserFile({
      objectKey: 'users/user-1/input.csv',
      direction: 'input',
      fileName: 'input.csv',
      contentType: 'text/csv',
      bytes,
    })
    bytes[0] = 0
    expect(new TextDecoder().decode(written.bytes)).toBe('a,b\n1,2\n')
    expect(fixture.putOptions).toMatchObject({
      mime: 'text/csv',
      meta: {
        kind: 'user-input',
        filename: 'input.csv',
        sha256: digest(Buffer.from('a,b\n1,2\n')),
      },
      headers: { 'x-oss-object-acl': 'private' },
    })

    await expect(store.loadUserFile('users/user-1/input.csv')).resolves.toMatchObject({
      fileName: 'input.csv',
      metadata: { kind: 'user-input', contentType: 'text/csv' },
    })
    await expect(store.deleteObject('users/user-1/input.csv')).resolves.toBeUndefined()
    await expect(store.deleteObject('users/user-1/input.csv')).resolves.toBeUndefined()
    await expect(store.statObject('users/user-1/input.csv')).resolves.toBeNull()
  })

  it('propagates aborts without exposing credentials or vendor responses', async () => {
    const { client } = fakeClient()
    const store = new AliyunOssSkillObjectStore(client, 'skills')
    const controller = new AbortController()
    const reason = new Error('cancelled')
    controller.abort(reason)
    await expect(store.statObject('skills/a.zip', controller.signal)).rejects.toBe(reason)
  })

  it('signs one private PUT object with V4-bound headers', async () => {
    const fixture = fakeClient()
    const store = new AliyunOssSkillObjectStore(fixture.client, 'skills')
    const signed = await store.signSkillUpload({
      objectKey: 'skill-staging/user-1/session-1/package.zip',
      contentType: 'application/zip',
      contentLength: 12,
      sha256: 'a'.repeat(64),
      expiresInSeconds: 300,
    })
    expect(signed).toMatchObject({
      url: 'https://private-oss.invalid/signed-put',
      method: 'PUT',
      headers: {
        'content-type': 'application/zip',
        'x-oss-object-acl': 'private',
        'x-oss-meta-kind': 'skill-package',
        'x-oss-meta-sha256': 'a'.repeat(64),
      },
    })
    expect(fixture.signature).toEqual({
      method: 'PUT',
      expires: 300,
      objectName: 'skill-staging/user-1/session-1/package.zip',
      additionalHeaders: [
        'content-type',
        'x-oss-meta-kind',
        'x-oss-meta-sha256',
        'x-oss-object-acl',
      ],
    })
  })

  it('creates a short-lived private GET URL for one validated Skill package', async () => {
    const fixture = fakeClient({
      objects: {
        'skills/cleaner/package.zip': {
          bytes: Buffer.from(MOCK_EXECUTABLE_SKILL_PACKAGE.archive),
          headers: headers(
            'skill-package',
            MOCK_EXECUTABLE_SKILL_PACKAGE.archive.byteLength,
            MOCK_EXECUTABLE_SKILL_SHA256,
            'application/zip',
          ),
        },
      },
    })
    const store = new AliyunOssSkillObjectStore(fixture.client, 'skills')

    await expect(
      store.createSkillPackageDownload('skills/cleaner/package.zip'),
    ).resolves.toMatchObject({
      url: 'https://private-oss.invalid/signed-get',
      metadata: {
        kind: 'skill-package',
        sha256: MOCK_EXECUTABLE_SKILL_SHA256,
      },
    })
    expect(fixture.signature).toEqual({
      method: 'GET',
      expires: 60,
      objectName: 'skills/cleaner/package.zip',
      additionalHeaders: [],
    })
  })
})

interface FakeObject {
  bytes: Buffer
  headers: Record<string, string>
}

function fakeClient(
  options: {
    acl?: string
    objects?: Record<string, FakeObject>
  } = {},
): {
  client: OssClientPort
  calls: string[]
  putOptions?: unknown
  signature?: unknown
} {
  const calls: string[] = []
  const objects = new Map(Object.entries(options.objects ?? {}))
  const result: {
    client: OssClientPort
    calls: string[]
    putOptions?: unknown
    signature?: unknown
  } = {
    calls,
    client: {
      async getBucketACL(bucket) {
        calls.push(`acl:${bucket}`)
        return { acl: options.acl ?? 'private' }
      },
      async head(name) {
        calls.push(`head:${name}`)
        const object = requireObject(objects, name)
        return {
          status: 200,
          meta: {
            kind: object.headers['x-oss-meta-kind']!,
            sha256: object.headers['x-oss-meta-sha256']!,
          },
          res: { status: 200, headers: object.headers },
        }
      },
      async get(name) {
        calls.push(`get:${name}`)
        const object = requireObject(objects, name)
        return { content: Buffer.from(object.bytes), res: { status: 200, headers: object.headers } }
      },
      async put(name, content, putOptions) {
        calls.push(`put:${name}`)
        result.putOptions = putOptions
        objects.set(name, {
          bytes: Buffer.from(content),
          headers: {
            ...headers(
              putOptions.meta.kind!,
              content.byteLength,
              putOptions.meta.sha256!,
              putOptions.mime,
            ),
            'x-oss-meta-filename': putOptions.meta.filename!,
          },
        })
        return {}
      },
      async delete(name) {
        calls.push(`delete:${name}`)
        objects.delete(name)
        return {}
      },
      async signatureUrlV4(method, expires, _request, objectName, additionalHeaders) {
        result.signature = { method, expires, objectName, additionalHeaders }
        return `https://private-oss.invalid/signed-${method.toLowerCase()}`
      },
    },
  }
  return result
}

function requireObject(objects: Map<string, FakeObject>, name: string): FakeObject {
  const object = objects.get(name)
  if (!object) throw Object.assign(new Error('missing'), { code: 'NoSuchKey', status: 404 })
  return object
}

function headers(
  kind: string,
  size: number,
  sha256: string,
  contentType: string,
): Record<string, string> {
  return {
    'content-length': String(size),
    'content-type': contentType,
    'last-modified': updatedAt,
    'x-oss-meta-kind': kind,
    'x-oss-meta-sha256': sha256,
  }
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
