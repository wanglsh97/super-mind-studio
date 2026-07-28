import { createHash } from 'node:crypto'

const MAX_EXTRACTED_CHARS = 30_000

export interface ExtractedContent {
  title: string | null
  text: string
  truncated: boolean
  contentHash: string
}

/**
 * 不执行 JS、不加载子资源的正文抽取：剥离 script/style/标签，保留可读文本。
 */
export function extractWebFetchContent(
  body: string,
  contentType: string | null,
  maxChars = MAX_EXTRACTED_CHARS,
): ExtractedContent {
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''

  if (mime.includes('json') || mime === 'application/json') {
    return finalize(normalizeJson(body), null, maxChars)
  }

  if (mime.startsWith('text/') && !mime.includes('html')) {
    return finalize(collapseWhitespace(body), null, maxChars)
  }

  // HTML（含缺省/未知但已通过白名单的 text/html）
  const title = extractTitle(body)
  const text = htmlToText(body)
  return finalize(text, title, maxChars)
}

export function isAllowedContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return true
  if (mime === 'application/json' || mime === 'text/json') return true
  if (mime.startsWith('text/')) {
    // 拒绝明显二进制伪装
    return !['text/event-stream'].includes(mime)
  }
  return false
}

export function isDeniedContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return (
    mime.startsWith('image/') ||
    mime.startsWith('audio/') ||
    mime.startsWith('video/') ||
    mime === 'application/pdf' ||
    mime === 'application/zip' ||
    mime === 'application/gzip' ||
    mime === 'application/x-tar' ||
    mime === 'application/octet-stream' ||
    mime.includes('wasm')
  )
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!match?.[1]) return null
  const title = decodeEntities(stripTags(match[1])).trim()
  return title.length > 0 ? title.slice(0, 300) : null
}

function htmlToText(html: string): string {
  let value = html
  value = value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  value = value.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  value = value.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
  value = value.replace(/<!--[\s\S]*?-->/g, ' ')
  value = value.replace(/<\/(p|div|br|li|h[1-6]|tr|section|article)>/gi, '\n')
  value = value.replace(/<br\s*\/?>/gi, '\n')
  value = stripTags(value)
  value = decodeEntities(value)
  return collapseWhitespace(value)
}

function stripTags(value: string): string {
  return value.replace(/<\/?[^>]+>/g, ' ')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code)
      return Number.isFinite(n) ? String.fromCodePoint(n) : ''
    })
}

function normalizeJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return collapseWhitespace(body)
  }
}

function collapseWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function finalize(text: string, title: string | null, maxChars: number): ExtractedContent {
  const truncated = text.length > maxChars
  const clipped = truncated ? text.slice(0, maxChars) : text
  const contentHash = createHash('sha256').update(clipped).digest('hex')
  return { title, text: clipped, truncated, contentHash }
}
