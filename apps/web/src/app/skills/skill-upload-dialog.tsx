'use client'

import { createAIGatewayClient } from '@supermind/sdk'
import type { SkillUploadProgress } from '@supermind/sdk'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { useAuthenticationFailure } from '../../components/use-authentication-failure'
import { cn } from '../../lib/cn'
import {
  prepareSkillFolder,
  type PreparedSkillFolder,
  type SkillFolderFile,
} from './skill-folder-package'
import {
  SKILL_CATEGORIES,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_TITLE_MAX_LENGTH,
  validateSkillMetadata,
  type SkillCategory,
} from './skill-upload-form'

const client = createAIGatewayClient()

type UploadState = 'idle' | 'preparing' | 'ready' | 'uploading' | 'submitting' | 'submitted'

export function SkillUploadDialog({
  selectedFiles,
  onChooseFolder,
  onClose,
}: Readonly<{
  selectedFiles: readonly SkillFolderFile[]
  onChooseFolder(): void
  onClose(): void
}>) {
  const handleAuthenticationFailure = useAuthenticationFailure()
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const activeUploadRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const [prepared, setPrepared] = useState<PreparedSkillFolder | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<SkillCategory>('development')
  const [state, setState] = useState<UploadState>('preparing')
  const [progress, setProgress] = useState<SkillUploadProgress | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploadError, setUploadError] = useState('')
  const [finalizedSessionId, setFinalizedSessionId] = useState('')
  const busy = state === 'preparing' || state === 'uploading' || state === 'submitting'
  busyRef.current = busy
  onCloseRef.current = onClose

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) onCloseRef.current()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
      activeUploadRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setState('preparing')
    setPrepared(null)
    setProgress(null)
    setFinalizedSessionId('')
    setErrors({})
    setUploadError('')

    void prepareSkillFolder(selectedFiles)
      .then((next) => {
        if (cancelled) return
        setPrepared(next)
        setTitle(next.title)
        setDescription(next.description)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setState('idle')
        setUploadError(cause instanceof Error ? cause.message : '无法读取 Skill 文件夹')
      })

    return () => {
      cancelled = true
    }
  }, [selectedFiles])

  async function uploadAndSubmit() {
    if (!prepared || busy) return
    const metadataErrors = validateSkillMetadata({
      name: prepared.name,
      title,
      description,
      category,
    })
    if (metadataErrors.name) {
      metadataErrors.package = `${metadataErrors.name}，请修改 SKILL.md 中的 name`
      delete metadataErrors.name
    }
    setErrors(metadataErrors)
    if (Object.keys(metadataErrors).length > 0) return

    setUploadError('')
    let sessionId = finalizedSessionId
    try {
      if (!sessionId) {
        const controller = new AbortController()
        activeUploadRef.current = controller
        setState('uploading')
        const finalized = await client.agent.skills.uploadPackage(prepared.archive, {
          signal: controller.signal,
          maxRetries: 2,
          onProgress: setProgress,
        })
        sessionId = finalized.sessionId
        setFinalizedSessionId(sessionId)
        activeUploadRef.current = null
      }

      setState('submitting')
      await client.skills.owner.submit({
        uploadSessionId: sessionId,
        name: prepared.name,
        title: title.trim(),
        description: description.trim(),
        category,
      })
      setState('submitted')
    } catch (cause) {
      const wasCancelled = activeUploadRef.current?.signal.aborted ?? false
      activeUploadRef.current = null
      setState('ready')
      if (wasCancelled) {
        setUploadError('上传已取消，可直接重新提交。')
      } else if (!handleAuthenticationFailure(cause)) {
        setUploadError(cause instanceof Error ? cause.message : '上传失败，请重试')
      }
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 grid place-items-center bg-[#171220]/55 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-upload-title"
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-[1.6rem] border border-white/70 bg-surface-card p-5 shadow-[0_30px_100px_rgb(16_10_28/0.35)] sm:max-h-[calc(100dvh-3rem)] sm:p-7"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="liquid-label text-brand">UPLOAD SKILL</p>
            <h2 id="skill-upload-title" className="mt-2 text-2xl font-extrabold tracking-tight">
              上传 Skill
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="关闭上传弹窗"
            disabled={busy}
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-xl text-ink-muted transition hover:border-brand/40 hover:text-brand disabled:opacity-40"
          >
            ×
          </button>
        </header>

        {uploadError ? (
          <div className="mt-6">
            <p
              role="alert"
              className="rounded-xl border border-rose-300/60 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200"
            >
              {uploadError}
            </p>
            <button
              type="button"
              onClick={onChooseFolder}
              className="mt-3 text-sm font-bold text-brand hover:text-brand-hover"
            >
              重新选择
            </button>
          </div>
        ) : null}

        {state === 'preparing' ? (
          <p aria-live="polite" className="mt-8 py-8 text-center text-sm text-ink-muted">
            正在读取 Skill…
          </p>
        ) : null}

        {prepared ? (
          <div className="mt-6 border-t border-line pt-6">
            <div className="grid gap-5">
              <Field label="标题" error={errors.title}>
                <input
                  value={title}
                  maxLength={SKILL_TITLE_MAX_LENGTH}
                  onChange={(event) => setTitle(event.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="描述" error={errors.description}>
                <textarea
                  value={description}
                  maxLength={SKILL_DESCRIPTION_MAX_LENGTH}
                  rows={4}
                  onChange={(event) => setDescription(event.target.value)}
                  className={cn(inputClass, 'resize-y leading-6')}
                />
                <p className="mt-1.5 text-right font-mono text-[0.62rem] text-ink-faint">
                  {description.length} / {SKILL_DESCRIPTION_MAX_LENGTH}
                </p>
              </Field>

              <Field label="分类" error={errors.category}>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as SkillCategory)}
                  className={inputClass}
                >
                  {SKILL_CATEGORIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>

              <FieldError message={errors.package} />

              {state === 'uploading' && progress ? (
                <div aria-live="polite">
                  <div className="mb-2 flex justify-between text-xs text-ink-muted">
                    <span>
                      {progress.phase === 'hashing' ? '正在计算文件摘要' : '正在上传 OSS'}
                    </span>
                    <span>{progress.percent}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-inset">
                    <div
                      className="h-full rounded-full bg-brand transition-[width]"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {state === 'submitted' ? (
                <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                  已提交管理员首次发布审核。
                  <Link href="/skills/mine" className="ml-2 font-bold underline underline-offset-2">
                    查看我的 Skill
                  </Link>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void uploadAndSubmit()}
                    className="rounded-xl bg-[#24202e] px-5 py-3 text-sm font-bold text-white transition hover:bg-brand disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-[#24202e]"
                  >
                    {state === 'uploading'
                      ? '正在上传…'
                      : state === 'submitting'
                        ? '正在提交审核…'
                        : finalizedSessionId
                          ? '重新提交审核'
                          : '上传并提交审核'}
                  </button>
                  {state === 'uploading' ? (
                    <button
                      type="button"
                      onClick={() => activeUploadRef.current?.abort()}
                      className="rounded-xl border border-line px-5 py-3 text-sm font-semibold text-ink-muted hover:text-ink"
                    >
                      取消
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

const inputClass =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-3 focus:ring-brand/10 dark:bg-surface-inset'

function Field({
  label,
  error,
  children,
}: Readonly<{ label: string; error?: string | undefined; children: React.ReactNode }>) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold text-ink-muted">{label}</span>
      {children}
      <FieldError message={error} />
    </label>
  )
}

function FieldError({ message }: Readonly<{ message?: string | undefined }>) {
  return message ? (
    <span role="alert" className="mt-1.5 block text-xs leading-5 text-rose-700 dark:text-rose-300">
      {message}
    </span>
  ) : null
}
