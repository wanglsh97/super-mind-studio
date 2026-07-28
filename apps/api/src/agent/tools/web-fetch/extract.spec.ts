import { extractWebFetchContent, isAllowedContentType, isDeniedContentType } from './extract'

describe('web-fetch content extraction', () => {
  it('extracts title and text from HTML without scripts', () => {
    const html = `
      <html><head><title>Hello &amp; World</title>
      <script>document.location='http://evil'</script>
      <style>.x{color:red}</style></head>
      <body><h1>Title</h1><p>Paragraph one.</p><p>Paragraph two.</p></body></html>
    `
    const result = extractWebFetchContent(html, 'text/html; charset=utf-8')
    expect(result.title).toBe('Hello & World')
    expect(result.text).toContain('Paragraph one.')
    expect(result.text).not.toContain('document.location')
    expect(result.text).not.toContain('color:red')
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('truncates long content and marks truncated', () => {
    const body = 'a'.repeat(50_000)
    const result = extractWebFetchContent(body, 'text/plain', 100)
    expect(result.text).toHaveLength(100)
    expect(result.truncated).toBe(true)
  })

  it('whitelists html/json/text and denies binaries', () => {
    expect(isAllowedContentType('text/html')).toBe(true)
    expect(isAllowedContentType('application/json')).toBe(true)
    expect(isAllowedContentType('text/plain')).toBe(true)
    expect(isDeniedContentType('application/pdf')).toBe(true)
    expect(isDeniedContentType('image/png')).toBe(true)
    expect(isAllowedContentType('application/pdf')).toBe(false)
  })
})
