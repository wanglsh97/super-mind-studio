import type { ImageModelAlias, ImageTaskStatus } from '@supermind/sdk'

import type { ImageAdapterId } from '../image.constants'

export interface ImageAdapterSubmitRequest {
  requestId: string
  modelAlias: ImageModelAlias
  resolvedModel: string
  prompt: string
  signal: AbortSignal
  size?: string
  count?: number
}

export type ImageAdapterSubmission =
  | {
      providerTaskId: string
      status: Extract<ImageTaskStatus, 'pending' | 'running'>
    }
  | {
      providerTaskId: string
      status: 'succeeded'
      results: readonly ImageAdapterResult[]
    }

export interface ImageAdapterResult {
  url: string
  width?: number
  height?: number
  contentType?: string
}

export interface ImageAdapterStatusRequest {
  providerTaskId: string
  signal: AbortSignal
}

export interface ImageAdapterStatus {
  status: ImageTaskStatus
  results?: readonly ImageAdapterResult[]
  errorCode?: string
  errorMessage?: string
}

export interface ImageAdapterDownloadRequest {
  url: string
  signal: AbortSignal
}

export interface ImageAdapterDownload {
  body: Uint8Array
  contentType: string
}

export interface ImageAdapter {
  readonly id: ImageAdapterId
  readonly resolvedModel: string
  submit(request: ImageAdapterSubmitRequest): Promise<ImageAdapterSubmission>
  getStatus(request: ImageAdapterStatusRequest): Promise<ImageAdapterStatus>
  download(request: ImageAdapterDownloadRequest): Promise<ImageAdapterDownload>
}

export class ImageAdapterError extends Error {
  constructor(
    message: string,
    readonly options: {
      code: string
      retryable: boolean
      statusCode?: number
      cause?: unknown
    },
  ) {
    super(message, { cause: options.cause })
    this.name = 'ImageAdapterError'
  }
}
