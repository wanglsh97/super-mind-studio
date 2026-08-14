import { AIGatewayProtocolError } from './errors.js';

export type CreativeItemType = 'website' | 'image';

export interface CreativeItem {
  id: string;
  projectId?: string;
  type: CreativeItemType;
  status: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  threadId?: string | null;
  runId?: string | null;
  imageTaskId?: string;
  imageCount?: number;
  assets?: Array<{
    id: string;
    kind: string;
    name: string;
    expiresAt: string | null;
    downloadUrl?: string;
    previewUrl?: string;
  }>;
}

export async function requestCreativeJson<T>(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchImplementation(url, init);
  if (!response.ok)
    throw new AIGatewayProtocolError(
      response.headers.get('x-request-id') ?? 'unknown',
      `Creative API request failed (${response.status})`,
    );
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new AIGatewayProtocolError('unknown', 'Creative API response is not valid JSON', error);
  }
}
