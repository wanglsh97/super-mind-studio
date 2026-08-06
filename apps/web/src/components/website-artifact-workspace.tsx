'use client';

import {
  CheckIcon,
  ChevronRightIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileCode2Icon,
  FolderIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  RocketIcon,
  XIcon,
} from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { materialLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import type {
  WebsiteSourceFile,
  WebsiteSourceTreeNode,
} from '@/utils/agent/website-source-archive';
import type { ReactNode } from 'react';

import {
  buildWebsiteSourceTree,
  DEFAULT_WEBSITE_SOURCE_ARCHIVE_LIMITS,
  parseWebsiteSourceArchive,
} from '@/utils/agent/website-source-archive';
import { cn } from '@/utils/cn';

export interface WebsiteArtifactDescriptor {
  id: string;
  previewUrl: string;
  sourceUrl: string;
  distUrl: string;
  builtAt?: string;
}

interface WebsiteArtifactContextValue {
  artifact: WebsiteArtifactDescriptor | null;
  openArtifact: (artifact: WebsiteArtifactDescriptor) => void;
  closeArtifact: () => void;
}

const WebsiteArtifactContext = createContext<WebsiteArtifactContextValue | null>(null);

export function useWebsiteArtifactWorkspace() {
  const value = useContext(WebsiteArtifactContext);
  if (!value) throw new Error('useWebsiteArtifactWorkspace 必须在 WebsiteArtifactWorkspace 内使用');
  return value;
}

export function WebsiteArtifactWorkspace({
  children,
  scopeKey,
}: Readonly<{ children: ReactNode; scopeKey: string }>) {
  const [artifact, setArtifact] = useState<WebsiteArtifactDescriptor | null>(null);
  const openArtifact = useCallback((nextArtifact: WebsiteArtifactDescriptor) => {
    setArtifact(nextArtifact);
  }, []);
  const closeArtifact = useCallback(() => setArtifact(null), []);
  const contextValue = useMemo(
    () => ({ artifact, openArtifact, closeArtifact }),
    [artifact, closeArtifact, openArtifact],
  );

  useEffect(() => setArtifact(null), [scopeKey]);

  return (
    <WebsiteArtifactContext.Provider value={contextValue}>
      <div className="flex h-full min-h-0 w-full">
        <div
          className={cn(
            'relative flex min-w-0 flex-1 flex-col transition-[flex-basis,max-width] duration-300',
            artifact && 'min-[1200px]:max-w-[44rem] min-[1200px]:basis-[42%]',
          )}
        >
          {children}
        </div>
        {artifact ? <WebsiteArtifactPanel artifact={artifact} onClose={closeArtifact} /> : null}
      </div>
    </WebsiteArtifactContext.Provider>
  );
}

function WebsiteArtifactPanel({
  artifact,
  onClose,
}: Readonly<{ artifact: WebsiteArtifactDescriptor; onClose: () => void }>) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [sourceState, setSourceState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [sourceFiles, setSourceFiles] = useState<WebsiteSourceFile[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sourceAttempt, setSourceAttempt] = useState(0);

  useEffect(() => {
    setTab('preview');
    setSourceState('idle');
    setSourceFiles([]);
    setSourceError(null);
    setSelectedPath(null);
  }, [artifact.id]);

  useEffect(() => {
    if (tab !== 'code') return;
    const controller = new AbortController();
    setSourceState('loading');
    void loadWebsiteSource(artifact.sourceUrl, controller.signal)
      .then((files) => {
        if (controller.signal.aborted) return;
        setSourceFiles(files);
        setSelectedPath(preferredSourcePath(files));
        setSourceState('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSourceError(error instanceof Error ? error.message : '源码加载失败，请稍后重试。');
        setSourceState('error');
      });
    return () => controller.abort();
  }, [artifact.sourceUrl, sourceAttempt, tab]);

  const selectedFile = sourceFiles.find((file) => file.path === selectedPath) ?? null;

  return (
    <aside
      aria-label="网站产物"
      className="fixed inset-0 z-[80] flex min-h-0 flex-col overflow-hidden bg-surface-card min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-auto min-[1200px]:min-w-0 min-[1200px]:flex-1 min-[1200px]:border-l min-[1200px]:border-line"
    >
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-3 lg:px-5">
        <div className="mr-auto min-w-0">
          <p className="truncate text-sm font-semibold text-ink">网页开发</p>
          <p className="mt-0.5 text-xs text-ink-muted">当前对话的最新静态网站产物</p>
        </div>
        <div
          role="tablist"
          aria-label="网站产物视图"
          className="flex rounded-xl bg-surface-inset p-1"
        >
          <ArtifactTab active={tab === 'preview'} onClick={() => setTab('preview')}>
            <EyeIcon aria-hidden="true" className="size-3.5" />
            预览
          </ArtifactTab>
          <ArtifactTab active={tab === 'code'} onClick={() => setTab('code')}>
            <Code2Icon aria-hidden="true" className="size-3.5" />
            代码
          </ArtifactTab>
        </div>
        <div className="flex items-center gap-1.5">
          <ArtifactDownload href={artifact.sourceUrl} label="源码 ZIP" />
          <ArtifactDownload href={artifact.distUrl} label="网站 ZIP" />
          <button
            type="button"
            disabled
            title="部署功能即将开放"
            className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-xl border border-line bg-surface-inset px-3 text-xs font-semibold text-ink-muted opacity-65"
          >
            <RocketIcon aria-hidden="true" className="size-3.5" />
            部署
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭网站产物"
            className="grid size-9 place-items-center rounded-xl text-ink-muted transition hover:bg-surface-inset hover:text-ink focus-visible:outline-3 focus-visible:outline-brand-focus"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        </div>
      </header>

      {tab === 'preview' ? (
        <div className="relative min-h-0 flex-1 bg-[linear-gradient(135deg,#f5f6f8_25%,transparent_25%),linear-gradient(225deg,#f5f6f8_25%,transparent_25%),linear-gradient(45deg,#f5f6f8_25%,transparent_25%),linear-gradient(315deg,#f5f6f8_25%,#fff_25%)] bg-[length:18px_18px] bg-[position:9px_0,9px_0,0_0,0_0] p-3">
          <iframe
            key={artifact.previewUrl}
            src={artifact.previewUrl}
            title="网站预览"
            className="h-full w-full rounded-xl border border-line bg-white shadow-sm"
            sandbox="allow-forms allow-modals allow-popups allow-scripts"
          />
          <a
            href={artifact.previewUrl}
            target="_blank"
            rel="noreferrer"
            className="absolute right-6 bottom-6 inline-flex size-10 items-center justify-center rounded-full border border-line bg-white text-neutral-700 shadow-lg transition hover:-translate-y-0.5 hover:text-black"
            aria-label="在新窗口打开预览"
          >
            <ExternalLinkIcon aria-hidden="true" className="size-4" />
          </a>
        </div>
      ) : (
        <SourceWorkspace
          state={sourceState}
          files={sourceFiles}
          selectedFile={selectedFile}
          error={sourceError}
          onSelect={setSelectedPath}
          onRetry={() => {
            setSourceState('idle');
            setSourceError(null);
            setSourceAttempt((current) => current + 1);
          }}
        />
      )}
    </aside>
  );
}

function ArtifactTab({
  active,
  children,
  onClick,
}: Readonly<{ active: boolean; children: ReactNode; onClick: () => void }>) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition',
        active
          ? 'bg-surface-card text-ink shadow-[0_1px_4px_rgb(15_23_42/0.1)]'
          : 'text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function ArtifactDownload({ href, label }: Readonly<{ href: string; label: string }>) {
  return (
    <a
      href={href}
      title={`下载${label}`}
      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-xs font-semibold text-ink transition hover:border-brand/40 hover:text-brand focus-visible:outline-3 focus-visible:outline-brand-focus"
    >
      <DownloadIcon aria-hidden="true" className="size-3.5" />
      <span className="hidden 2xl:inline">{label}</span>
    </a>
  );
}

function SourceWorkspace({
  state,
  files,
  selectedFile,
  error,
  onSelect,
  onRetry,
}: Readonly<{
  state: 'idle' | 'loading' | 'ready' | 'error';
  files: WebsiteSourceFile[];
  selectedFile: WebsiteSourceFile | null;
  error: string | null;
  onSelect: (path: string) => void;
  onRetry: () => void;
}>) {
  if (state === 'idle' || state === 'loading') {
    return (
      <div className="grid min-h-0 flex-1 place-items-center bg-surface-inset/40">
        <div className="text-center text-sm text-ink-muted">
          <LoaderCircleIcon aria-hidden="true" className="mx-auto mb-3 size-5 animate-spin" />
          正在读取源码包…
        </div>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
        <div className="max-w-sm">
          <p className="text-sm font-semibold text-ink">暂时无法预览源码</p>
          <p className="mt-2 text-xs leading-5 text-ink-muted">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand/40 hover:text-brand"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav
        aria-label="源码文件"
        className="h-48 shrink-0 overflow-auto border-b border-line bg-surface-inset/35 p-2 md:h-auto md:w-64 md:border-r md:border-b-0 xl:w-72"
      >
        <SourceTree files={files} selectedPath={selectedFile?.path ?? null} onSelect={onSelect} />
      </nav>
      <SourceCodeViewer file={selectedFile} />
    </div>
  );
}

function SourceTree({
  files,
  selectedPath,
  onSelect,
}: Readonly<{
  files: WebsiteSourceFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}>) {
  const tree = useMemo(() => buildWebsiteSourceTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <ul className="space-y-0.5">
      {tree.map((node) => (
        <SourceTreeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          collapsed={collapsed}
          onToggle={(path) =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            })
          }
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function SourceTreeItem({
  node,
  depth,
  selectedPath,
  collapsed,
  onToggle,
  onSelect,
}: Readonly<{
  node: WebsiteSourceTreeNode;
  depth: number;
  selectedPath: string | null;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}>) {
  const isDirectory = node.kind === 'directory';
  const isCollapsed = collapsed.has(node.path);
  return (
    <li>
      <button
        type="button"
        onClick={() => (isDirectory ? onToggle(node.path) : onSelect(node.path))}
        className={cn(
          'flex h-8 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-xs transition',
          selectedPath === node.path
            ? 'bg-brand/10 font-semibold text-brand'
            : 'text-ink-secondary hover:bg-surface-card hover:text-ink',
        )}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        {isDirectory ? (
          <>
            <ChevronRightIcon
              aria-hidden="true"
              className={cn('size-3 shrink-0 transition', !isCollapsed && 'rotate-90')}
            />
            {isCollapsed ? (
              <FolderIcon aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
              <FolderOpenIcon aria-hidden="true" className="size-3.5 shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileCode2Icon aria-hidden="true" className="size-3.5 shrink-0" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDirectory && !isCollapsed && node.children?.length ? (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <SourceTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SourceCodeViewer({ file }: Readonly<{ file: WebsiteSourceFile | null }>) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [file?.path]);

  if (!file) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center text-sm text-ink-muted">
        请选择一个文件
      </div>
    );
  }

  return (
    <section aria-label={`查看 ${file.path}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-ink-secondary">{file.path}</p>
        <span className="rounded-md border border-line bg-surface-inset px-1.5 py-0.5 font-mono text-[0.62rem] font-semibold tracking-wide text-ink-muted uppercase">
          {file.language}
        </span>
        <span className="text-[0.68rem] text-ink-muted">{formatBytes(file.sizeBytes)}</span>
        {file.content !== null ? (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(file.content ?? '').then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1_500);
              });
            }}
            aria-label="复制文件内容"
            className="grid size-8 place-items-center rounded-lg text-ink-muted transition hover:bg-surface-inset hover:text-ink"
          >
            {copied ? (
              <CheckIcon aria-hidden="true" className="size-3.5 text-success" />
            ) : (
              <CopyIcon aria-hidden="true" className="size-3.5" />
            )}
          </button>
        ) : null}
      </div>
      {file.content === null ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-sm text-ink-muted">
          {file.previewUnavailableReason}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-white text-[0.8rem]">
          <SyntaxHighlighter
            language={file.language}
            style={materialLight}
            showLineNumbers
            wrapLongLines={false}
            customStyle={{
              margin: 0,
              minHeight: '100%',
              padding: '1.25rem 1rem',
              background: '#fafafa',
              fontSize: '0.8rem',
              lineHeight: '1.6',
            }}
            lineNumberStyle={{ color: '#9ca3af', minWidth: '2.75em', paddingRight: '1em' }}
          >
            {file.content}
          </SyntaxHighlighter>
        </div>
      )}
    </section>
  );
}

async function loadWebsiteSource(url: string, signal: AbortSignal): Promise<WebsiteSourceFile[]> {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('源码包下载失败，可能已过期或当前登录状态无权访问。');

  const declaredSize = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredSize) &&
    declaredSize > DEFAULT_WEBSITE_SOURCE_ARCHIVE_LIMITS.maxCompressedBytes
  ) {
    throw new Error('源码包超过浏览器预览大小限制，请直接下载后在本地查看。');
  }
  const buffer = await response.arrayBuffer();
  return parseWebsiteSourceArchive(new Uint8Array(buffer));
}

function preferredSourcePath(files: WebsiteSourceFile[]): string | null {
  const preferred = ['src/App.tsx', 'src/main.tsx', 'index.html', 'package.json'];
  return (
    preferred.find((path) => files.some((file) => file.path === path)) ?? files[0]?.path ?? null
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
