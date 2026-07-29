'use client'

import { useState } from 'react'
import React from 'react'
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
    <section className="not-prose my-3 overflow-hidden rounded-xl border border-slate-200 bg-[#fafafa] shadow-sm dark:border-white/10 dark:bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-slate-100/80 px-3 py-2 dark:border-slate-200 dark:bg-slate-100">
        <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-slate-500">
          {displayLanguage}
        </span>
        <button
          type="button"
          onClick={copyCode}
          className="rounded-md px-2 py-1 text-[0.68rem] font-medium text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600"
          aria-label={`复制 ${displayLanguage} 代码`}
        >
          {copied ? '已复制' : '复制'}
        </button>
      </header>
      <SyntaxHighlighter
        language={normalizeLanguage(language)}
        style={oneLight}
        customStyle={{
          margin: 0,
          padding: '1rem',
          borderRadius: 0,
          background: 'transparent',
          fontSize: '0.78rem',
          lineHeight: 1.65,
        }}
        codeTagProps={{ className: 'font-mono' }}
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
