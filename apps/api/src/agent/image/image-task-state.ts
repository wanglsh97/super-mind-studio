import type { ImageGenerationStatus } from '@supermind/sdk';

export const IMAGE_TERMINAL_STATUSES = [
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'SUBMISSION_UNKNOWN',
] as const;

export type ImageTaskState =
  | 'PENDING'
  | 'SUBMITTING'
  | 'RUNNING'
  | 'PERSISTING'
  | (typeof IMAGE_TERMINAL_STATUSES)[number]
  | 'CANCEL_REQUESTED';

const TRANSITIONS: Readonly<Record<ImageTaskState, readonly ImageTaskState[]>> = {
  PENDING: ['SUBMITTING', 'CANCELLED', 'FAILED'],
  SUBMITTING: ['RUNNING', 'FAILED', 'CANCEL_REQUESTED', 'SUBMISSION_UNKNOWN', 'EXPIRED'],
  RUNNING: ['PERSISTING', 'FAILED', 'CANCEL_REQUESTED', 'EXPIRED'],
  PERSISTING: ['SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'EXPIRED'],
  CANCEL_REQUESTED: ['CANCELLED', 'FAILED', 'EXPIRED'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
  SUBMISSION_UNKNOWN: [],
};

export function canTransitionImageTask(from: ImageTaskState, to: ImageTaskState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function isTerminalImageTaskStatus(status: ImageTaskState): boolean {
  return (IMAGE_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function toImageGenerationStatus(status: ImageTaskState): ImageGenerationStatus {
  return status.toLowerCase() as ImageGenerationStatus;
}
