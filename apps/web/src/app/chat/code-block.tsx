'use client'

import React from 'react'
import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'

export function CodeBlock({ code, language }: Readonly<{ code: string; language?: string }>) {
  const [copied, setCopied] = useState(false)
  const displayLanguage = language || 'text'

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="not-prose my-3 w-full max-w-[44rem] overflow-hidden rounded-xl border border-slate-300 bg-white shadow-none dark:border-slate-300 dark:bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-200 dark:bg-slate-50">
        <span className="font-sans text-sm font-semibold capitalize tracking-normal text-slate-900">
          {displayLanguage}
        </span>
        <button
          type="button"
          onClick={copyCode}
          className="grid size-7 place-items-center rounded-md text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600"
          aria-label={`复制 ${displayLanguage} 代码`}
          title={copied ? '已复制' : '复制代码'}
        >
          {copied ? (
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m5 12 4 4L19 6" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
            </svg>
          )}
        </button>
      </header>
      <SyntaxHighlighter
        language={normalizeLanguage(language)}
        style={oneLight}
        customStyle={{
          margin: 0,
          padding: '1rem 1.25rem',
          borderRadius: 0,
          background: 'transparent',
          fontSize: '0.82rem',
          lineHeight: 1.65,
        }}
        codeTagProps={{ className: '!bg-transparent !p-0 font-mono' }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </section>
  )
}

function normalizeLanguage(language?: string): string {
  const normalized = language?.trim().toLowerCase()
  if (!normalized) return 'text'

  const aliases: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    sh: 'bash',
    shell: 'bash',
    yml: 'yaml',
    md: 'markdown',
    py: 'python',
  }

  return aliases[normalized] ?? normalized
}
