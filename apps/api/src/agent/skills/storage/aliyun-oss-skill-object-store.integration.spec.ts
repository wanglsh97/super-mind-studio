import { createHash } from 'node:crypto'

import { AliyunOssSkillObjectStore } from './aliyun-oss-skill-object-store'
import { LocalOssCompatibleFixture } from './local-oss-compatible.fixture'

describe('AliyunOssSkillObjectStore local compatible integration', () => {
  let fixture: LocalOssCompatibleFixture
  let store: AliyunOssSkillObjectStore

  beforeEach(async () => {
    fixture = new LocalOssCompatibleFixture('skills')
    await fixture.start()
    store = new AliyunOssSkillObjectStore(fixture.client(), 'skills')
  })

  afterEach(async () => {
    await fixture.close()
  })

  it('binds a private signed PUT to one object and the required headers', async () => {
    await expect(store.onModuleInit()).resolves.toBeUndefined()
    const objectKey = 'skill-staging/user-1/session-1/package.zip'
    const body = Buffer.from('package-v1')
    const sha256 = digest(body)
    const signed = await store.signSkillUpload({
      objectKey,
      contentType: 'application/zip',
      contentLength: body.byteLength,
      sha256,
      expiresInSeconds: 300,
    })

    await expect(fetch(signed.url, { method: 'GET' })).resolves.toMatchObject({ status: 403 })
    await expect(
      fetch(signed.url.replace('package.zip', 'other.zip'), {
        method: 'PUT',
        headers: signed.headers,
        body,
      }),
    ).resolves.toMatchObject({ status: 403 })
    await expect(
      fetch(signed.url, {
        method: 'PUT',
        headers: { ...signed.headers, 'x-oss-object-acl': 'public-read' },
        body,
      }),
    ).resolves.toMatchObject({ status: 403 })

    const uploaded = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body })
    expect(uploaded.status).toBe(200)
    await expect(fetch(fixture.publicObjectUrl(objectKey))).resolves.toMatchObject({ status: 403 })
    await expect(store.statObject(objectKey)).resolves.toMatchObject({
      objectKey,
      kind: 'skill-package',
      contentType: 'application/zip',
      sizeBytes: body.byteLength,
      sha256,
    })
  })

  it('overwrites the same private key and cleans it idempotently', async () => {
    const objectKey = 'users/user-1/result.txt'
    const first = await store.writeUserFile({
      objectKey,
      direction: 'output',
      fileName: 'result.txt',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('first'),
    })
    const second = await store.writeUserFile({
      objectKey,
      direction: 'output',
      fileName: 'result.txt',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('second'),
    })

    expect(first.metadata.sha256).not.toBe(second.metadata.sha256)
    await expect(store.loadUserFile(objectKey)).resolves.toMatchObject({
      fileName: 'result.txt',
      bytes: new TextEncoder().encode('second'),
      metadata: { sizeBytes: 6, sha256: digest(Buffer.from('second')) },
    })
    await expect(store.deleteObject(objectKey)).resolves.toBeUndefined()
    await expect(store.deleteObject(objectKey)).resolves.toBeUndefined()
    await expect(store.statObject(objectKey)).resolves.toBeNull()
  })
})

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
