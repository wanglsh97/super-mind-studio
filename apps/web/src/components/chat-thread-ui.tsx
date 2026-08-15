'use client';

import type { AgentThinkingEffort, TextModelAlias, TextModelId, Usage } from '@supermind/sdk';
import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useMessageTiming,
  useThreadViewport,
} from '@assistant-ui/react';
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  PlusIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  XIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CHAT_PROVIDER_BRANDING } from '@/const/branding/chat-provider-branding';
import chatLogo from '@/const/chat-logo.png';
import { AssistantMarkdown } from '@/components/chat/assistant-markdown';
import { AgentRunProgressIndicator } from '@/components/agent-run-progress-indicator';
import ShimmerText from '@/components/shimmer-text';
import { agentActivityPartIndices } from '@/utils/agent/agent-activity-grouping';
import type { AgentRunProgressStage } from '@/utils/agent/agent-run-adapter';
import { prepareComposerSubmission } from '@/utils/agent/composer-submission';
import { cn } from '@/utils/cn';

const focusRing =
  'focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-3';

export function AgentPageShell({
  children,
  ...props
}: Readonly<{ children?: ReactNode } & React.HTMLAttributes<HTMLElement>>) {
  return (
    <main
      {...props}
      className={cn(
        'relative flex h-[calc(100dvh-4.5rem)] min-h-[34rem] flex-col overflow-hidden md:h-dvh',
        props.className,
      )}
    >
      {children}
    </main>
  );
}

export function AgentConsolePanel({
  children,
  label,
}: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <section
      aria-label={label}
      className="agent-console-surface relative flex h-full min-h-0 flex-1 flex-col overflow-hidden p-3 pt-14 md:p-[clamp(0.8rem,2vw,1.4rem)]"
    >
      {children}
    </section>
  );
}

export function AgentThreadRoot({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ThreadPrimitive.Root className="relative flex h-full min-h-0 flex-col">
      {children}
    </ThreadPrimitive.Root>
  );
}

export function AgentThreadViewport({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto scroll-pb-52">
      <div className="mx-auto w-full max-w-[58rem] px-3.5 pt-6 pb-4 md:px-6 md:pt-9.5 md:pb-6">
        {children}
      </div>
    </ThreadPrimitive.Viewport>
  );
}

/** 当前 Thread 的轮次索引；点击后定位到对应的用户提问。 */
export function AgentThreadNavigator() {
  const messages = useAuiState(({ thread }) => thread.messages);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoveredTitle, setHoveredTitle] = useState<{ label: string; top: number } | null>(null);
  const navigatorRef = useRef<HTMLElement>(null);
  const entries = messages.reduce<Array<{ id: string; label: string; index: number }>>(
    (current, message) => {
      if (message.role !== 'user') return current;
      const rawLabel = message.content
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join(' ')
        .trim();
      const label = decodeVideoReferenceMessage(decodeComposerMessage(rawLabel).prompt).prompt;
      if (label) current.push({ id: message.id, label, index: current.length + 1 });
      return current;
    },
    [],
  );

  if (entries.length < 2) return null;

  const barWidth = (index: number) => {
    if (hoveredIndex === null) return 12;
    const distance = Math.abs(index - hoveredIndex);
    if (distance === 0) return 64;
    if (distance === 1) return 40;
    if (distance === 2) return 24;
    return 12;
  };

  return (
    <aside
      ref={navigatorRef}
      aria-label="当前会话导航"
      className="relative hidden min-h-0 w-14 shrink-0 flex-col justify-center md:flex"
    >
      <nav
        className="max-h-full overflow-y-auto"
        aria-label="历史对话定位"
        onMouseLeave={() => {
          setHoveredIndex(null);
          setHoveredTitle(null);
        }}
      >
        <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
          {entries.map((entry) => {
            const selected = entry.id === selectedMessageId;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-label={`定位到第 ${entry.index} 轮对话：${entry.label}`}
                  aria-current={selected ? 'location' : undefined}
                  onMouseEnter={(event) => {
                    setHoveredIndex(entry.index - 1);
                    const container = navigatorRef.current?.getBoundingClientRect();
                    const target = event.currentTarget.getBoundingClientRect();
                    if (container) {
                      setHoveredTitle({
                        label: entry.label,
                        top: target.top - container.top + target.height / 2,
                      });
                    }
                  }}
                  onFocus={() => setHoveredIndex(entry.index - 1)}
                  onBlur={() => {
                    setHoveredIndex(null);
                    setHoveredTitle(null);
                  }}
                  onClick={() => {
                    setSelectedMessageId(entry.id);
                    document
                      .getElementById(`agent-message-${entry.id}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  className={cn('group flex h-5 w-full items-center pl-2.5 text-left', focusRing)}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-[3px] rounded-full bg-ink-faint transition-[width,background-color] duration-200 ease-out group-hover:bg-ink-muted',
                      selected && 'bg-ink-muted',
                    )}
                    style={{ width: `${barWidth(entry.index - 1)}px` }}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {hoveredTitle ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-[calc(100%+0.65rem)] z-20 w-72 -translate-y-1/2 rounded-2xl border border-line-soft bg-surface-card px-4 py-3 text-[0.82rem] leading-6 text-ink-secondary shadow-[0_12px_28px_rgb(15_15_20/0.12)] dark:text-ink"
          style={{ top: hoveredTitle.top }}
        >
          <p className="line-clamp-4">{hoveredTitle.label}</p>
        </div>
      ) : null}
    </aside>
  );
}

export function AgentScrollToBottom() {
  const isAtBottom = useThreadViewport((viewport) => viewport.isAtBottom);

  if (isAtBottom) return null;

  return (
    <ThreadPrimitive.ScrollToBottom
      aria-label="滚动到底部"
      className={cn(
        'absolute bottom-full left-1/2 z-5 grid size-9 -translate-x-1/2 cursor-pointer place-items-center rounded-full border border-line bg-surface-card text-brand shadow-[0_4px_14px_rgb(37_57_103/0.12)] dark:bg-surface-muted dark:text-brand-light',
        focusRing,
      )}
    >
      ↓
    </ThreadPrimitive.ScrollToBottom>
  );
}

export function AgentComposerDock({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="sticky bottom-0 z-3 relative bg-linear-to-b from-transparent via-surface/85 via-28% to-surface px-1 py-2 md:px-4.5 md:py-2.5">
      {children}
    </div>
  );
}

export function AgentComposerRoot({
  children,
  onSubmitText,
}: Readonly<{
  children: ReactNode;
  onSubmitText?: (text: string) => string;
}>) {
  const aui = useAui();
  const composerText = useAuiState(({ composer }) => composer.text);
  const [hasFocus, setHasFocus] = useState(false);
  const replaySubmissionRef = useRef<string | null>(null);

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root
        compact
        style={
          hasFocus
            ? {
                boxShadow: '0 0 0 1px rgb(60 60 67 / 0.16)',
              }
            : undefined
        }
        onFocusCapture={() => setHasFocus(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false);
        }}
        onSubmit={(event) => {
          const submission = prepareComposerSubmission(
            composerText,
            replaySubmissionRef.current,
            onSubmitText,
          );
          if (submission.kind === 'empty') {
            event.preventDefault();
            return;
          }
          if (submission.kind === 'submit') {
            replaySubmissionRef.current = null;
            return;
          }
          // ComposerPrimitive已在本次submit中捕获旧文本；先阻止发送并同步替换，
          // 再于下一微任务重放，保证附件/首帧元数据进入真正的用户消息。
          event.preventDefault();
          replaySubmissionRef.current = submission.text;
          aui.composer().setText(submission.text);
          queueMicrotask(() => aui.composer().send());
        }}
        className={cn(
          'liquid-glass relative mx-auto w-full max-w-[44rem] rounded-[1.125rem] p-2 pb-2.5 transition-[border-color,box-shadow] sm:w-[calc(100%-2rem)]',
        )}
      >
        {children}
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}

export function AgentComposerInput(
  props: Readonly<{ placeholder: string; disabled?: boolean; maxLength?: number }>,
) {
  return (
    <ComposerPrimitive.Input
      aria-label={props.placeholder}
      rows={1}
      maxLength={props.maxLength}
      disabled={props.disabled}
      placeholder={props.placeholder}
      className="max-h-32 min-h-10 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 outline-none placeholder:text-ink-subtle"
    />
  );
}

export function AgentDictationTranscript() {
  const dictation = useAuiState(({ composer }) => composer.dictation);
  if (!dictation) return null;

  return (
    <div
      className="flex items-center gap-2 px-2 pb-0.5 text-xs text-brand"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-current" />
      <span className="font-semibold">正在聆听</span>
      <ComposerPrimitive.DictationTranscript className="min-w-0 truncate text-ink-muted" />
    </div>
  );
}

export function AgentComposerFooter({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex items-center justify-between gap-1.5 dark:border-line">{children}</div>
  );
}

export function AgentComposerActions({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex min-w-0 items-center gap-0.5 md:gap-1">{children}</div>;
}

export function DocumentUploadButton({
  disabled,
  onUpload,
}: Readonly<{
  disabled?: boolean;
  onUpload: (files: File[]) => Promise<void>;
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.currentTarget.value = '';
          if (!files.length) return;
          setError(null);
          setUploading(true);
          void onUpload(files)
            .catch((cause: unknown) => {
              const detail = cause instanceof Error ? cause.message : '文件上传失败，请稍后重试';
              setError(`${detail} 支持 PDF、DOCX、XLSX，单个文件最大 20 MB。`);
              window.setTimeout(() => setError(null), 5000);
            })
            .finally(() => setUploading(false));
        }}
      />
      <button
        type="button"
        aria-label="上传文档"
        title="上传 PDF、Word 或 Excel"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'grid size-8 cursor-pointer place-items-center rounded-full border border-line bg-surface-card text-ink transition-[background-color,border-color,box-shadow,color,transform] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
          focusRing,
        )}
      >
        <PlusIcon className="size-4" aria-hidden="true" />
      </button>
      {error ? (
        <div
          className="fixed bottom-5 left-1/2 z-50 max-w-[min(90vw,28rem)] -translate-x-1/2 rounded-xl border border-red-200 bg-surface-card px-4 py-3 text-xs text-red-700 shadow-[0_10px_30px_rgb(15_15_20/0.16)]"
          role="alert"
        >
          {error}
        </div>
      ) : null}
    </>
  );
}

export interface ComposerDocumentFile {
  name: string;
  sizeBytes: number;
  path: string;
}

const FILES_START = '[[supermind-files]]';
const FILES_END = '[[/supermind-files]]';

export function encodeComposerMessage(files: readonly ComposerDocumentFile[], prompt: string) {
  if (!files.length) return prompt;
  return `${FILES_START}${JSON.stringify(files)}${FILES_END}\n${prompt}`;
}

function decodeComposerMessage(content: string): {
  files: ComposerDocumentFile[];
  prompt: string;
} {
  const start = content.indexOf(FILES_START);
  const end = content.indexOf(FILES_END);
  if (start < 0 || end < start) return { files: [], prompt: content };
  try {
    const files = JSON.parse(
      content.slice(start + FILES_START.length, end),
    ) as ComposerDocumentFile[];
    return {
      files: Array.isArray(files) ? files : [],
      prompt: content.slice(end + FILES_END.length).trim(),
    };
  } catch {
    return { files: [], prompt: content };
  }
}

const VIDEO_REFERENCE_PATTERN =
  /\n*\[当前视频首帧资产ID:\s*([0-9a-f-]{36})\]\s*$/i;

function decodeVideoReferenceMessage(content: string) {
  const match = content.match(VIDEO_REFERENCE_PATTERN);
  return {
    assetId: match?.[1] ?? null,
    prompt: content.replace(VIDEO_REFERENCE_PATTERN, '').trim(),
  };
}

function messageContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('');
}

export function ComposerDocumentFiles({
  files,
  onRemove,
  compact = true,
}: Readonly<{
  files: readonly ComposerDocumentFile[];
  onRemove?: (index: number) => void;
  compact?: boolean;
}>) {
  if (!files.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto px-2 pb-2 pt-1" aria-label="已上传文件">
      {files.map((file, index) => {
        const extension = file.name.split('.').pop()?.toLowerCase();
        const Icon = extension === 'xlsx' ? FileSpreadsheetIcon : FileTextIcon;
        return (
          <div
            key={`${file.name}-${file.sizeBytes}-${index}`}
            className={cn(
              'group relative shrink-0 cursor-default items-center rounded-lg border border-line bg-surface-card shadow-[0_3px_10px_rgb(37_57_103/0.05)] transition-[border-color,box-shadow,transform]',
              compact ? 'flex w-36 gap-1.5 px-1.5 py-1.5' : 'flex w-60 gap-3 px-3 py-3',
            )}
          >
            <div
              className={cn(
                'grid shrink-0 place-items-center rounded-md border border-line bg-fill-secondary text-ink-muted',
                compact ? 'size-7' : 'size-12 rounded-lg',
              )}
            >
              <Icon className={compact ? 'size-4' : 'size-7'} aria-hidden="true" />
            </div>
            <div className={cn('min-w-0', compact ? 'pr-3' : 'pr-2')}>
              <p
                className={cn('truncate font-medium text-ink', compact ? 'text-[11px]' : 'text-sm')}
              >
                附件：{file.name}
              </p>
              <p
                className={cn(
                  'mt-0.5 uppercase text-ink-muted',
                  compact ? 'text-[10px]' : 'text-xs',
                )}
              >
                {extension ?? 'FILE'} {formatComposerFileSize(file.sizeBytes)}
              </p>
            </div>
            {onRemove ? (
              <button
                type="button"
                aria-label={`移除 ${file.name}`}
                onClick={() => onRemove(index)}
                className="absolute right-1.5 top-1.5 hidden size-5 cursor-pointer place-items-center rounded-full bg-fill-secondary text-sm leading-none text-ink-muted shadow-sm transition-colors hover:bg-red-500/10 hover:text-red-600 group-hover:grid"
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function formatComposerFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AgentWebCreationOption({
  selected,
  disabled,
  onClick,
  label = '网页开发',
}: Readonly<{
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  label?: string;
}>) {
  return (
    <div className="shrink-0">
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'group inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-3 text-xs transition-colors',
          selected
            ? 'border-[#0B84FF]/50 bg-[#0B84FF]/10 text-[#0B84FF] hover:bg-[#0B84FF]/16 hover:text-[#0060D6] dark:border-[#64D2FF]/45 dark:bg-[#64D2FF]/14 dark:text-[#64D2FF] dark:hover:bg-[#64D2FF]/22 dark:hover:text-[#8ADEFF]'
            : 'border-line-soft bg-surface text-ink-muted hover:border-brand/35 hover:bg-brand-subtle/50 hover:text-brand-hover',
          'disabled:cursor-not-allowed disabled:opacity-45',
          focusRing,
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-4 shrink-0 fill-none stroke-current stroke-[1.7]"
        >
          <rect x="3.25" y="3.5" width="13.5" height="13" rx="2.25" />
          <path d="M3.5 7.5h13M7.5 7.5v8.75" strokeLinejoin="round" />
        </svg>
        <span className="font-semibold">{label}</span>
      </button>
    </div>
  );
}

export function AgentComposerModeIndicator({
  label,
  disabled,
  onClear,
}: Readonly<{
  label: string;
  disabled?: boolean;
  onClear: () => void;
}>) {
  return (
    <button
      type="button"
      aria-label={`退出${label}模式`}
      title={`退出${label}模式`}
      disabled={disabled}
      onClick={onClear}
      className={cn(
        'group inline-flex h-8 cursor-pointer items-center gap-1.5 px-1.5 text-xs font-semibold text-[#0B84FF] transition-colors hover:text-[#0060D6] dark:text-[#64D2FF] dark:hover:text-[#8ADEFF]',
        'disabled:cursor-not-allowed disabled:opacity-45',
        focusRing,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="size-4 shrink-0 fill-none stroke-current stroke-[1.7] group-hover:hidden group-focus-visible:hidden"
      >
        <rect x="3.25" y="3.5" width="13.5" height="13" rx="2.25" />
        <path d="M3.5 7.5h13M7.5 7.5v8.75" strokeLinejoin="round" />
      </svg>
      <XIcon
        aria-hidden="true"
        className="hidden size-4 shrink-0 group-hover:block group-focus-visible:block"
      />
      <span>{label}</span>
    </button>
  );
}

export function AgentComposerAction({
  children,
  onClick,
  href,
  expanded,
}: Readonly<{
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  expanded?: boolean;
}>) {
  const className = cn(
    'inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[0.66rem] font-semibold whitespace-nowrap text-ink-muted transition-[background,color] hover:bg-brand-subtle hover:text-brand-hover dark:hover:bg-brand-subtle dark:hover:text-brand-light',
    focusRing,
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick} aria-expanded={expanded}>
      {children}
    </button>
  );
}

export function AgentComposerSubmitGroup({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex min-w-0 items-center gap-1">{children}</div>;
}

export function AgentDictationButton({
  disabled,
}: Readonly<{
  disabled?: boolean;
}>) {
  const dictationActive = useAuiState(({ composer }) => composer.dictation !== undefined);
  const className = cn(
    'grid size-8 shrink-0 place-items-center rounded-full text-ink-muted transition-[background,color,transform] hover:bg-brand-subtle hover:text-brand disabled:cursor-not-allowed disabled:opacity-40 disabled:transform-none',
    focusRing,
  );

  if (dictationActive) {
    return (
      <ComposerPrimitive.StopDictation
        className={cn(className, 'bg-brand-subtle text-brand')}
        aria-label="停止语音输入"
        title="停止语音输入"
      >
        <span aria-hidden="true" className="size-2.5 rounded-[0.2rem] bg-current" />
      </ComposerPrimitive.StopDictation>
    );
  }

  return (
    <ComposerPrimitive.Dictate
      className={className}
      disabled={disabled}
      aria-label="开始语音输入"
      title="开始语音输入"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="size-3.5 fill-none stroke-current stroke-1.8"
      >
        <rect x="7" y="2.5" width="6" height="9" rx="3" />
        <path d="M4.75 9.25a5.25 5.25 0 0 0 10.5 0M10 14.5v3M7 17.5h6" strokeLinecap="round" />
      </svg>
    </ComposerPrimitive.Dictate>
  );
}

export function AgentSendButton({
  children,
  disabled,
  cancel,
  onClick,
}: Readonly<{
  children?: ReactNode;
  disabled?: boolean;
  cancel?: boolean;
  onClick?: () => void;
}>) {
  const base = cn(
    'liquid-button grid place-items-center rounded-full text-white transition-[background,transform,box-shadow] disabled:cursor-not-allowed disabled:opacity-40 disabled:transform-none',
    focusRing,
  );
  if (cancel) {
    return (
      <ComposerPrimitive.Cancel
        className={cn(
          base,
          'h-8 w-auto rounded-full px-2.5 text-[0.68rem] font-bold dark:bg-surface-inset dark:text-ink',
        )}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </ComposerPrimitive.Cancel>
    );
  }
  return (
    <ComposerPrimitive.Send
      className={cn(base, 'size-8 shrink-0')}
      disabled={disabled}
      aria-label="发送消息"
    >
      {children ?? (
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-4.5 fill-none stroke-current stroke-2"
        >
          <path d="M10 15V5m0 0L6 9m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </ComposerPrimitive.Send>
  );
}

export function AgentSendButtonDisabled() {
  return (
    <button
      type="button"
      className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-white opacity-40"
      disabled
      aria-label="发送消息"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="size-4.5 fill-none stroke-current stroke-2"
      >
        <path d="M10 15V5m0 0L6 9m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function AgentPrivacyNote() {
  return (
    <p className="mx-auto mt-1.5 w-full max-w-[44rem] text-center text-[0.6rem] text-ink-subtle sm:w-[calc(100%-2rem)]">
      内容由 AI 生成，请仔细甄别
    </p>
  );
}

export function AgentComposerError({ message }: Readonly<{ message: string }>) {
  return (
    <p role="alert" className="mx-2 mt-1.5 text-[0.68rem] text-danger">
      {message}
    </p>
  );
}

export function AgentInterruptedBanner({ message }: Readonly<{ message: string }>) {
  return (
    <p
      role="status"
      className="mx-auto mt-3 w-full max-w-[58rem] rounded-lg border border-warning/35 bg-warning/12 px-3.5 py-2 text-[0.8rem] leading-snug text-warning dark:text-warning-light"
    >
      {message}
    </p>
  );
}

export function ParameterSliders({
  temperature,
  topP,
  maxTokens,
  onTemperatureChange,
  onTopPChange,
  onMaxTokensChange,
}: Readonly<{
  temperature: number;
  topP: number;
  maxTokens: number;
  onTemperatureChange: (value: number) => void;
  onTopPChange: (value: number) => void;
  onMaxTokensChange: (value: number) => void;
}>) {
  return (
    <section
      aria-label="生成参数"
      className="mx-1 mt-2 grid grid-cols-1 gap-2.5 rounded-xl bg-surface-muted p-3 md:grid-cols-3 md:gap-4"
    >
      <ParameterSlider
        label="Temperature"
        value={temperature}
        min={0}
        max={2}
        step={0.1}
        onChange={onTemperatureChange}
      />
      <ParameterSlider
        label="Top P"
        value={topP}
        min={0}
        max={1}
        step={0.05}
        onChange={onTopPChange}
      />
      <ParameterSlider
        label="Max tokens"
        value={maxTokens}
        min={1}
        max={4096}
        step={1}
        onChange={onMaxTokensChange}
      />
    </section>
  );
}

function ParameterSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: Readonly<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}>) {
  return (
    <label>
      <span className="flex justify-between text-[0.62rem] text-ink-muted md:text-[0.68rem]">
        <b>{label}</b>
        <output className="font-mono">{value}</output>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-brand"
      />
    </label>
  );
}

export function ModelLogo({ alias }: Readonly<{ alias: TextModelAlias }>) {
  const branding = CHAT_PROVIDER_BRANDING[alias];
  const logoClasses: Record<TextModelAlias, string> = {
    kimi: 'border-ink bg-ink text-white italic dark:border-ink dark:bg-ink',
    qwen: 'border-brand-muted bg-surface-card',
    glm: branding.logoUrl ? 'bg-surface-card' : 'border-[#17151e] bg-[#17151e] text-white',
    deepseek: 'border-[#d7e1ff] text-[#5d7cf0]',
  };

  return (
    <span
      className={cn(
        'grid size-[1.2rem] shrink-0 place-items-center overflow-hidden rounded-full border border-line text-[0.62rem] font-extrabold leading-none dark:border-line-soft',
        logoClasses[alias],
        branding.logoUrl && 'bg-cover bg-center bg-no-repeat',
      )}
      style={branding.logoUrl ? { backgroundImage: `url("${branding.logoUrl}")` } : undefined}
      aria-hidden="true"
    >
      {!branding.logoUrl && <span>{branding.fallbackText}</span>}
    </span>
  );
}

export function ModelSelect({
  value,
  options,
  disabled,
  boundHint,
  menuTitle,
  onChange,
}: Readonly<{
  value: TextModelId;
  options: ReadonlyArray<{ value: TextModelId; label: string; provider: TextModelAlias }>;
  disabled: boolean;
  boundHint?: boolean;
  menuTitle?: string;
  onChange: (value: TextModelId) => void;
}>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  return (
    <div
      className="relative min-w-0"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={
          boundHint
            ? `当前会话模型：${selectedLabel}（切换后继续当前会话）`
            : `运行模型：${selectedLabel}`
        }
        title={boundHint ? '切换模型后，下一次任务将在当前会话中继续' : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-8 max-w-[10rem] items-center gap-1.5 rounded-lg px-2.5 text-[0.7rem] font-semibold text-ink-muted transition-[background,color] hover:bg-surface-inset/45 hover:text-ink-secondary aria-expanded:bg-surface-inset aria-expanded:text-ink-secondary md:min-w-[7.5rem]',
          focusRing,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={cn(
            'size-3.5 shrink-0 fill-none stroke-current stroke-[1.6] transition-transform',
            open && 'rotate-180',
          )}
        >
          <path d="m5 6 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="选择运行模型"
          className="liquid-glass absolute right-0 bottom-[calc(100%+0.45rem)] z-10 w-48 overflow-hidden rounded-xl p-1 shadow-[0_14px_34px_rgb(39_59_112/0.16)]"
        >
          <p className="px-2 py-1 text-[0.55rem] font-semibold text-ink-subtle">
            {menuTitle ?? (boundHint ? '切换当前会话模型' : '运行模型')}
          </p>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex min-h-8 w-full items-center justify-between rounded-lg px-2.5 text-[0.68rem] font-medium text-ink-muted transition-[background,color] hover:bg-surface-inset/45 hover:text-ink-secondary',
                  isSelected && 'text-ink font-semibold',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ModelLogo alias={option.provider} />
                  <span className="truncate">{option.label}</span>
                </span>
                {isSelected && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const THINKING_EFFORT_OPTIONS: ReadonlyArray<{
  value: AgentThinkingEffort;
  label: string;
  note: string;
}> = [
  { value: 'fast', label: '快速', note: '更快、更省' },
  { value: 'balanced', label: '均衡', note: '默认' },
  { value: 'deep', label: '深度', note: 'token消耗更高' },
];

export function ThinkingEffortSelect({
  value,
  disabled,
  onChange,
}: Readonly<{
  value: AgentThinkingEffort;
  disabled: boolean;
  onChange: (effort: AgentThinkingEffort) => void;
}>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel =
    THINKING_EFFORT_OPTIONS.find((option) => option.value === value)?.label ?? '均衡';

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  return (
    <div
      className="relative"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={`思考强度：${selectedLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-8 items-center rounded-lg px-2.5 text-[0.68rem] font-medium text-ink-subtle transition-[background,color] hover:bg-surface-inset/45 hover:text-ink-muted aria-expanded:bg-surface-inset aria-expanded:text-ink-muted',
          focusRing,
        )}
      >
        <span>思考强度：</span>
        <span className="font-semibold text-ink-muted">{selectedLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={cn(
            'size-3 shrink-0 fill-none stroke-current stroke-[1.6] transition-transform',
            open && 'rotate-180',
          )}
        >
          <path d="m5 6 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="选择思考强度"
          className="liquid-glass absolute right-0 bottom-[calc(100%+0.4rem)] z-10 w-40 rounded-lg p-0.5"
        >
          {THINKING_EFFORT_OPTIONS.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left transition-[background,color] hover:bg-surface-inset/45',
                  isSelected && 'bg-surface-inset/55',
                )}
              >
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 whitespace-nowrap">
                  <span
                    className={cn(
                      'text-[0.66rem] font-semibold text-ink-muted',
                      isSelected && 'text-ink',
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="text-[0.55rem] text-ink-subtle">{option.note}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-3.5 shrink-0 place-items-center text-[0.62rem] font-bold',
                    isSelected ? 'text-brand' : 'text-transparent',
                  )}
                >
                  ✓
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AgentEmptyState({
  kicker,
  title,
}: Readonly<{
  kicker: string;
  title: string;
}>) {
  return (
    <div className="grid min-h-[calc(100dvh-14rem)] place-items-center content-center text-center md:min-h-[calc(100dvh-15rem)]">
      <div
        aria-hidden="true"
        className="liquid-glass grid size-[4.8rem] place-items-center rounded-[1.7rem] shadow-[0_18px_45px_rgb(39_100_255/0.15)]"
      >
        <Image src={chatLogo} alt="" className="size-16 rounded-xl object-cover" />
      </div>
      <p className="mt-5 font-mono text-[0.58rem] font-bold tracking-[0.15em] text-ink-subtle">
        {kicker}
      </p>
      <h2 className="mt-3 text-xl font-bold tracking-tight">{title}</h2>
    </div>
  );
}

export function UserMessage({
  messageId,
  threadId,
}: Readonly<{ messageId: string; threadId?: string | null }>) {
  const content = useAuiState(({ message }) => message.content);
  const decoded = decodeComposerMessage(messageContentText(content));
  const video = decodeVideoReferenceMessage(decoded.prompt);
  return (
    <MessagePrimitive.Root
      id={`agent-message-${messageId}`}
      className="group flex flex-col items-end gap-1 py-4"
    >
      <div className="flex max-w-[min(82%,38rem)] flex-col items-end gap-2 text-[0.95rem] leading-7 text-ink max-md:max-w-[92%] dark:text-ink">
        {video.assetId && threadId ? (
          <img
            src={`/api/v1/agent/video-inputs/threads/${encodeURIComponent(threadId)}/assets/${encodeURIComponent(video.assetId)}/content`}
            alt="视频首帧图"
            className="max-h-48 w-32 object-cover shadow-[0_6px_18px_rgb(37_57_103/0.16)]"
          />
        ) : null}
        {decoded.files.length ? (
          <div className="rounded-2xl bg-surface-muted px-3 py-3">
            <ComposerDocumentFiles files={decoded.files} compact={false} />
          </div>
        ) : null}
        {video.prompt ? (
          <div className="rounded-2xl bg-surface-muted px-4 py-3 whitespace-pre-wrap">
            {video.prompt}
          </div>
        ) : null}
      </div>
      <ActionBarPrimitive.Root className="flex h-7 items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        <ActionBarPrimitive.Copy
          aria-label="复制消息"
          title="复制"
          className="group/copy grid size-7 cursor-pointer place-items-center rounded-md text-ink-subtle transition-[background,color] hover:bg-brand-subtle hover:text-brand-hover disabled:cursor-not-allowed dark:hover:bg-brand-subtle dark:hover:text-brand-light"
        >
          <CopyIcon
            aria-hidden="true"
            className="size-3.5 group-data-[copied=true]/copy:hidden"
            strokeWidth={1.8}
          />
          <CheckIcon
            aria-hidden="true"
            className="hidden size-3.5 group-data-[copied=true]/copy:block"
            strokeWidth={1.8}
          />
        </ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

export function AssistantMessage({
  renderPart,
  runProgress,
}: Readonly<{
  metadata: ReactNode;
  renderPart?: (part: {
    type: string;
    text?: string;
    toolUI?: ReactNode;
    status?: { type?: string };
  }) => ReactNode | null;
  runProgress?: AgentRunProgressStage | null;
}>) {
  const isRunning = useAuiState(({ message }) => message.status?.type === 'running');
  const messageParts = useAuiState(({ message }) => message.parts);
  const hasRunningTool = messageParts.some(
    (part) => part.type === 'tool-call' && part.status?.type === 'running',
  );
  const groupAgentActivity = useMemo(() => {
    const activityIndices = agentActivityPartIndices(messageParts);

    return (part: (typeof messageParts)[number]) =>
      activityIndices.has(messageParts.indexOf(part))
        ? (['group-agent-activity'] as const)
        : ([] as const);
  }, [messageParts]);

  return (
    <MessagePrimitive.Root className="group flex gap-4 py-4">
      <div
        aria-hidden="true"
        className="liquid-glass-soft grid size-[2.1rem] shrink-0 place-items-center overflow-hidden rounded-lg"
      >
        <Image src={chatLogo} alt="" className="size-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[0.97rem] leading-7 text-ink dark:text-ink">
          <MessagePrimitive.GroupedParts groupBy={groupAgentActivity}>
            {({ part, children }) => {
              if (part.type === 'group-agent-activity') {
                return (
                  <AgentActivityDisclosure isThinking={isRunning && !hasRunningTool}>
                    {children}
                  </AgentActivityDisclosure>
                );
              }
              if (renderPart) return renderPart(part);
              if (part.type === 'text') return <AssistantMarkdown>{part.text}</AssistantMarkdown>;
              return null;
            }}
          </MessagePrimitive.GroupedParts>
          {isRunning && runProgress ? <AgentRunProgressIndicator stage={runProgress} /> : null}
          <AuiIf condition={({ message }) => message.status?.type === 'running' && !runProgress}>
            <span
              className="ml-1 inline-block h-4 w-1.5 animate-blink bg-brand align-[-0.12rem]"
              aria-label="正在生成"
            />
          </AuiIf>
        </div>
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root
            className="mt-3 border-l-2 border-danger-light pl-3 text-xs text-danger"
            role="alert"
          >
            请求失败：
            <ErrorPrimitive.Message />
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
        {!isRunning ? (
          <div className="mt-3 flex min-h-7 items-center justify-between gap-4 font-mono text-[0.56rem] text-ink-subtle">
            <ActionBarPrimitive.Root className="flex items-center gap-1">
              <ActionBarPrimitive.Copy
                aria-label="复制回复"
                title="复制"
                className="group/copy grid size-7 cursor-pointer place-items-center rounded-full text-ink-muted transition-[color,box-shadow,transform,opacity] hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 disabled:cursor-not-allowed disabled:opacity-25 data-[copied=true]:scale-110 data-[copied=true]:text-brand data-[copied=true]:shadow-[inset_0_0_0_1.5px_currentColor,0_0_0_3px_rgb(37_100_235/0.16)] data-[copied=true]:ring-1 data-[copied=true]:ring-brand/45 data-[copied=true]:ring-offset-2 data-[copied=true]:ring-offset-surface dark:hover:text-brand-light"
              >
                <CopyIcon
                  aria-hidden="true"
                  className="size-[1.05rem] transition-transform group-hover/copy:scale-110 group-data-[copied=true]/copy:hidden"
                  strokeWidth={2.1}
                />
                <CheckIcon
                  aria-hidden="true"
                  className="hidden size-[1.05rem] group-data-[copied=true]/copy:block"
                  strokeWidth={2.3}
                />
              </ActionBarPrimitive.Copy>
              <ActionBarPrimitive.FeedbackPositive
                aria-label="有帮助"
                title="有帮助"
                className="group/positive grid size-7 cursor-pointer place-items-center rounded-full text-ink-muted transition-[color,box-shadow,transform,opacity] hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 disabled:cursor-not-allowed disabled:opacity-25 data-[submitted=true]:scale-110 data-[submitted=true]:text-brand data-[submitted=true]:shadow-[inset_0_0_0_1.5px_currentColor,0_0_0_3px_rgb(37_100_235/0.16)] data-[submitted=true]:ring-1 data-[submitted=true]:ring-brand/45 data-[submitted=true]:ring-offset-2 data-[submitted=true]:ring-offset-surface dark:hover:text-brand-light"
              >
                <ThumbsUpIcon
                  aria-hidden="true"
                  className="size-[1.05rem] transition-transform group-hover/positive:scale-110 group-data-[submitted=true]/positive:fill-brand/15"
                  strokeWidth={2.1}
                />
              </ActionBarPrimitive.FeedbackPositive>
              <ActionBarPrimitive.FeedbackNegative
                aria-label="没帮助"
                title="没帮助"
                className="group/negative grid size-7 cursor-pointer place-items-center rounded-full text-ink-muted transition-[color,box-shadow,transform,opacity] hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/35 disabled:cursor-not-allowed disabled:opacity-25 data-[submitted=true]:scale-110 data-[submitted=true]:text-danger data-[submitted=true]:shadow-[inset_0_0_0_1.5px_currentColor,0_0_0_3px_rgb(220_38_38/0.14)] data-[submitted=true]:ring-1 data-[submitted=true]:ring-danger/45 data-[submitted=true]:ring-offset-2 data-[submitted=true]:ring-offset-surface"
              >
                <ThumbsDownIcon
                  aria-hidden="true"
                  className="size-[1.05rem] transition-transform group-hover/negative:scale-110 group-data-[submitted=true]/negative:fill-danger/15"
                  strokeWidth={2.1}
                />
              </ActionBarPrimitive.FeedbackNegative>
              <AgentMessageDuration />
            </ActionBarPrimitive.Root>
          </div>
        ) : null}
      </div>
    </MessagePrimitive.Root>
  );
}

function AgentMessageDuration() {
  const timing = useMessageTiming();
  if (timing?.totalStreamTime === undefined) return null;

  return (
    <span aria-label={`对话生成耗时 ${formatDuration(timing.totalStreamTime)}`}>
      耗时 {formatDuration(timing.totalStreamTime)}
    </span>
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 1 : 2)}s`;
}

function AgentActivityDisclosure({
  children,
  isThinking,
}: Readonly<{
  children: ReactNode;
  isThinking: boolean;
}>) {
  const [open, setOpen] = useState(isThinking);

  useEffect(() => {
    setOpen(isThinking);
  }, [isThinking]);

  return (
    <details
      data-testid="agent-activity-disclosure"
      aria-busy={isThinking}
      className="group text-[0.97rem] leading-7 text-ink opacity-55 transition-opacity duration-150 hover:opacity-85 open:opacity-75"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center py-1 font-normal tracking-[0.02em] [&::-webkit-details-marker]:hidden">
        {isThinking ? <ShimmerText>正在思考</ShimmerText> : <span>思考记录</span>}
        <AgentDisclosureChevron />
      </summary>
      <div className="mt-1.5 space-y-2 border-l border-current/15 pl-3">{children}</div>
    </details>
  );
}

export function ChatUsageMetadata({
  usage,
  model,
  requestId,
}: Readonly<{
  usage?: Usage | undefined;
  model?: string | undefined;
  requestId?: string | undefined;
}>) {
  const status = useAuiState(({ message }) => message.status);
  return (
    <p className="break-anywhere">
      {model ?? '模型'} · {status?.type === 'running' ? '生成中' : usageLabel(usage)}
      {usage?.estimatedCostCny ? ` · ¥${usage.estimatedCostCny}` : ''}
      {requestId ? ` · ${requestId}` : ''}
    </p>
  );
}

export function AgentRunMetadata({
  model,
  runStatus,
  totalTokens,
  modelCalls,
  toolCalls,
}: Readonly<{
  model?: string | undefined;
  runStatus?: string | null | undefined;
  totalTokens?: number | null | undefined;
  modelCalls?: number | null | undefined;
  toolCalls?: number | null | undefined;
}>) {
  const status = useAuiState(({ message }) => message.status);
  const interrupted = runStatus === 'interrupted' || status?.type === 'incomplete';
  return (
    <p>
      {model ?? '模型'}
      {status?.type === 'running'
        ? ' · 生成中'
        : runStatus === 'interrupted'
          ? ' · 已中断'
          : totalTokens != null
            ? ` · ${totalTokens} tokens`
            : ''}
      {modelCalls != null ? ` · 模型 ${modelCalls}` : ''}
      {toolCalls != null ? ` · 工具 ${toolCalls}` : ''}
      {interrupted && runStatus === 'interrupted' ? ' · 未自动重放' : ''}
    </p>
  );
}

export function AgentReasoning({ text }: Readonly<{ text: string }>) {
  if (!text.trim()) return null;

  return <div className="whitespace-pre-wrap text-[0.9rem] leading-6">{text}</div>;
}

export function AgentDisclosureChevron() {
  return (
    <ChevronRightIcon
      aria-hidden="true"
      className="size-4 shrink-0 opacity-75 transition-[opacity,transform] duration-150 group-hover:opacity-100 [details[open]>summary>&]:rotate-90 motion-reduce:transition-none"
      strokeWidth={2}
    />
  );
}

function usageLabel(usage?: Usage): string {
  if (!usage) return '等待用量';
  return usage.usageUnknown ? 'Token 未知' : `${usage.totalTokens} tokens`;
}

export function ResetThreadButton() {
  const api = useAui();
  const hasMessages = useAuiState(({ thread }) => thread.messages.length > 0);
  if (!hasMessages) return null;
  return <AgentComposerAction onClick={() => api.thread().reset()}>新会话</AgentComposerAction>;
}
