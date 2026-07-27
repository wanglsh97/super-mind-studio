import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  AssistantMarkdown,
  findCompletedSvgBlocks,
  safeMarkdownUrl,
  sanitizeSvg,
} from './assistant-markdown'

describe('AssistantMarkdown security', () => {
  it('allows safe web, mail and relative links', () => {
    assert.equal(safeMarkdownUrl('https://example.com/path'), 'https://example.com/path')
    assert.equal(safeMarkdownUrl('mailto:test@example.com'), 'mailto:test@example.com')
    assert.equal(safeMarkdownUrl('/docs'), '/docs')
  })

  it('rejects dangerous protocols including whitespace-obfuscated values', () => {
    for (const value of [
      'javascript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      assert.equal(safeMarkdownUrl(value), '')
    }
  })

  it('drops raw HTML and images while rendering safe Markdown elements', () => {
    const markup = renderToStaticMarkup(
      createElement(
        AssistantMarkdown,
        null,
        '# 标题\n\n**加粗** <script>alert(1)</script>\n\n![tracker](https://evil.test/a.png)\n\n[危险](javascript:alert(1))',
      ),
    )

    assert.match(markup, /<h1>标题<\/h1>/)
    assert.match(markup, /<strong>加粗<\/strong>/)
    assert.doesNotMatch(markup, /<script|<img|javascript:/i)
  })

  it('renders a completed fenced SVG block as a sanitized preview', () => {
    const markup = renderToStaticMarkup(
      createElement(
        AssistantMarkdown,
        null,
        [
          '图示：',
          '',
          '```svg',
          '<svg viewBox="0 0 120 60" role="img" aria-label="示例图">',
          '  <defs><linearGradient id="gradient"><stop offset="0%" stop-color="#2764ff" /></linearGradient></defs>',
          '  <rect width="120" height="60" rx="8" fill="url(#gradient)" />',
          '  <text x="60" y="35" text-anchor="middle">Hello</text>',
          '</svg>',
          '```',
        ].join('\n'),
      ),
    )

    assert.match(markup, /data-svg-preview/)
    assert.match(markup, /<svg[^>]+viewBox="0 0 120 60"/)
    assert.match(markup, /<linearGradient/)
    assert.match(markup, /fill="url\(#gradient\)"/)
    assert.doesNotMatch(markup, /language-svg/)
  })

  it('removes active SVG content and externally loaded resources', () => {
    const sanitized = sanitizeSvg(
      [
        '<svg viewBox="0 0 10 10" onload="alert(1)">',
        '<script>alert(1)</script>',
        '<foreignObject><div>unsafe</div></foreignObject>',
        '<image href="https://evil.test/tracker.png" />',
        '<use href="https://evil.test/icons.svg#x" />',
        '<rect style="fill:red" fill="url(https://evil.test/paint.svg#x)" width="10" height="10" />',
        '</svg>',
      ].join(''),
    )

    assert.ok(sanitized)
    assert.doesNotMatch(
      sanitized,
      /onload|script|foreignObject|<image|<use|href=|style=|evil\.test/i,
    )
    assert.match(sanitized, /<rect[^>]+width="10"[^>]+height="10"/)
  })

  it('keeps incomplete streamed SVG fences as code', () => {
    for (const markdown of [
      '```svg\n<svg viewBox="0 0 10 10"><rect width="10"',
      '```svg\n<svg viewBox="0 0 10 10"></svg>',
      '```svg\n<svg viewBox="0 0 10 10">\n```\n',
    ]) {
      const markup = renderToStaticMarkup(createElement(AssistantMarkdown, null, markdown))

      assert.doesNotMatch(markup, /data-svg-preview/)
      assert.match(markup, /<pre(?:\s|>)/)
      assert.doesNotMatch(markup, /node="\[object Object\]"/)
    }
  })

  it('only recognizes closed SVG fences and rejects multiple roots', () => {
    const complete = '```svg\n<svg viewBox="0 0 1 1"></svg>\n```'
    assert.deepEqual([...findCompletedSvgBlocks(complete)], ['<svg viewBox="0 0 1 1"></svg>'])
    assert.equal(sanitizeSvg('<svg></svg><svg></svg>'), null)
  })
})
