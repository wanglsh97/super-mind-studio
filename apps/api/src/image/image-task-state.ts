import type { ImageTaskStatus } from '@supermind/sdk'

const ALLOWED_TRANSITIONS: Readonly<Record<ImageTaskStatus, readonly ImageTaskStatus[]>> = {
  pending: ['running', 'succeeded', 'failed'],
  running: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
}

export function canTransitionImageTask(from: ImageTaskStatus, to: ImageTaskStatus): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to)
}

export function assertImageTaskTransition(from: ImageTaskStatus, to: ImageTaskStatus): void {
  if (!canTransitionImageTask(from, to)) {
    throw new ImageTaskTransitionError(from, to)
  }
}

export function isTerminalImageTaskStatus(status: ImageTaskStatus): boolean {
  return status === 'succeeded' || status === 'failed'
}

export class ImageTaskTransitionError extends Error {
  constructor(
    readonly from: ImageTaskStatus,
    readonly to: ImageTaskStatus,
  ) {
    super(`Image task cannot transition from "${from}" to "${to}"`)
    this.name = 'ImageTaskTransitionError'
  }
}
