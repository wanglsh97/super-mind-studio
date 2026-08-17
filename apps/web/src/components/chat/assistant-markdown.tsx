import DOMPurify from 'isomorphic-dompurify';
import { Link2Icon } from 'lucide-react';
import React from 'react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import Markdown from 'react-markdown';
import type { ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CodeBlock } from './code-block';

const allowedElements = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'a',
  'blockquote',
  'ul',
  'ol',
  'li',
  'pre',
  'code',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
] as const;

const allowedSvgTags = [
  'svg',
  'title',
  'desc',
  'defs',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
] as const;

const allowedSvgAttributes = [
  'xmlns',
  'viewBox',
  'preserveAspectRatio',
  'role',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'id',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'fr',
  'd',
  'points',
  'pathLength',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'transform',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'gradientUnits',
  'gradientTransform',
  'offset',
  'stop-color',
  'stop-opacity',
  'clip-path',
  'clip-rule',
  'mask',
] as const;

const localPaintReference = /^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/i;
const paintReferenceAttributes = new Set(['fill', 'stroke', 'clip-path', 'mask']);

DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (
    paintReferenceAttributes.has(data.attrName.toLowerCase()) &&
    /url\s*\(/i.test(data.attrValue) &&
    !localPaintReference.test(data.attrValue)
  ) {
    data.keepAttr = false;
  }
});

export function AssistantMarkdown({ children }: { children: string }) {
  const completedSvgBlocks = findCompletedSvgBlocks(children);

  return (
    <div className="space-y-3 wrap-break-word [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-slate-100 [&_:not(pre)>code]:px-1 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:p-2 dark:[&_a]:text-cyan-300 dark:[&_:not(pre)>code]:bg-white/10 dark:[&_td]:border-white/10 dark:[&_th]:border-white/10">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowedElements={[...allowedElements]}
        unwrapDisallowed
        urlTransform={safeMarkdownUrl}
        components={{
          a: SafeLink,
          pre: (props) => <SvgAwarePre {...props} completedSvgBlocks={completedSvgBlocks} />,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

type MarkdownCodeElement = ReactElement<{
  className?: string;
  children?: ReactNode;
}>;

function SvgAwarePre({
  children,
  completedSvgBlocks,
  node: _node,
  ...props
}: ComponentProps<'pre'> & ExtraProps & { completedSvgBlocks: ReadonlySet<string> }) {
  void _node;
  const child = React.Children.count(children) === 1 ? React.Children.only(children) : null;

  if (isSvgCodeElement(child)) {
    const source = normalizeSvgSource(child.props.children);
    const sanitized = completedSvgBlocks.has(source) ? sanitizeSvg(source) : null;

    if (sanitized) {
      return (
        <div
          data-svg-preview
          role="img"
          aria-label="模型生成的 SVG 预览"
          className="my-3 overflow-auto rounded-xl border border-line bg-white p-4 shadow-sm dark:border-line-soft dark:bg-surface-inset [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-h-128 [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      );
    }
  }

  if (isCodeElement(child)) {
    const language = getCodeLanguage(child.props.className);
    return (
      <CodeBlock
        code={normalizeCodeSource(child.props.children)}
        {...(language ? { language } : {})}
      />
    );
  }

  return <pre {...props}>{children}</pre>;
}

function isSvgCodeElement(value: ReactNode): value is MarkdownCodeElement {
  return (
    React.isValidElement<{ className?: string }>(value) &&
    value.props.className?.split(/\s+/).includes('language-svg') === true
  );
}

function isCodeElement(value: ReactNode): value is MarkdownCodeElement {
  return React.isValidElement<{ className?: string }>(value);
}

function getCodeLanguage(className?: string): string | undefined {
  return className
    ?.split(/\s+/)
    .find((name) => name.startsWith('language-'))
    ?.slice('language-'.length);
}

function normalizeSvgSource(value: ReactNode): string {
  return String(value ?? '').trim();
}

function normalizeCodeSource(value: ReactNode): string {
  return String(value ?? '').replace(/\n$/, '');
}

export function findCompletedSvgBlocks(markdown: string): ReadonlySet<string> {
  const completed = new Set<string>();
  const blockPattern = /(?:^|\n)(`{3,}|~{3,})[ \t]*svg[ \t]*\n([\s\S]*?)\n\1[ \t]*(?=\n|$)/gi;

  for (const match of markdown.matchAll(blockPattern)) {
    completed.add(normalizeSvgSource(match[2]));
  }

  return completed;
}

export function sanitizeSvg(source: string): string | null {
  const normalized = source.trim();
  const openingTags = normalized.match(/<svg(?:\s|>)/gi)?.length ?? 0;
  const closingTags = normalized.match(/<\/svg\s*>/gi)?.length ?? 0;

  if (
    openingTags !== 1 ||
    closingTags !== 1 ||
    !/^<svg(?:\s|>)/i.test(normalized) ||
    !/<\/svg\s*>$/i.test(normalized)
  ) {
    return null;
  }

  const sanitized = DOMPurify.sanitize(normalized, {
    ALLOWED_TAGS: [...allowedSvgTags],
    ALLOWED_ATTR: [...allowedSvgAttributes],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    FORBID_TAGS: ['script', 'foreignObject', 'style', 'a', 'image', 'use', 'animate', 'set'],
    FORBID_ATTR: ['style', 'href', 'xlink:href'],
  }).trim();

  return /^<svg(?:\s|>)/i.test(sanitized) && /<\/svg\s*>$/i.test(sanitized) ? sanitized : null;
}

function SafeLink({ href, children, node: _node, ...props }: ComponentProps<'a'> & ExtraProps) {
  void _node;
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="group/link inline-flex items-center gap-1 text-[#2878d4] no-underline transition-colors hover:text-[#1265bf] hover:underline hover:decoration-[#2878d4]/55 hover:underline-offset-3 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus dark:text-[#63afff] dark:hover:text-[#8ac4ff]"
    >
      {children}
    </a>
  );
}

export function safeMarkdownUrl(value: string): string {
  const normalized = [...value.trim()]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127 && !/\s/.test(character);
    })
    .join('');
  const protocol = /^([a-z][a-z\d+.-]*):/i.exec(normalized)?.[1]?.toLowerCase();
  if (protocol && !['http', 'https', 'mailto'].includes(protocol)) return '';
  return value;
}
