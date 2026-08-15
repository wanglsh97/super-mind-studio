import {
  AGENT_SKILL_CATEGORIES,
  AGENT_SKILL_PUBLICATION_STATUSES,
  type AgentSkillCategory,
  type AgentSkillFileEntry,
  type AgentSkillFilePreview,
  type AgentSkillMarketDetail,
  type AgentSkillMarketSummary,
  type AgentSkillPublicationStatus,
} from './agent-skill-types.js';
import { requestJson, requestVoid } from './agent-client.js';
import { AIGatewayProtocolError } from './errors.js';

export interface SkillMarketRequestOptions {
  signal?: AbortSignal;
}

export interface SkillMarketListOptions extends SkillMarketRequestOptions {
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: AgentSkillCategory;
  sort?: 'latest' | 'popular';
}

export interface SkillMarketPage {
  items: AgentSkillMarketSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SubmitSkillRequest {
  uploadSessionId: string;
  name: string;
  title: string;
  description: string;
  category: AgentSkillCategory;
}

export type UpdatePublishedSkillRequest = Omit<SubmitSkillRequest, 'name'>;

export interface OwnerSkillRecord {
  id: string;
  name: string;
  title: string;
  description: string;
  category: AgentSkillCategory;
  publicationStatus: AgentSkillPublicationStatus;
  packageSha256: string | null;
  packageSizeBytes: number | null;
}

export interface AdminSkillReviewRecord {
  id: string;
  name: string;
  title: string;
  description: string;
  category: AgentSkillCategory;
  ownerId: string;
  packageSha256: string | null;
  status: 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'DELISTED';
  createdAt: string;
  updatedAt: string;
}

export interface SkillMarketClient {
  list(options?: SkillMarketListOptions): Promise<SkillMarketPage>;
  detail(name: string, options?: SkillMarketRequestOptions): Promise<AgentSkillMarketDetail>;
  file(
    name: string,
    path: string,
    options?: SkillMarketRequestOptions,
  ): Promise<AgentSkillFilePreview>;
  add(name: string, options?: SkillMarketRequestOptions): Promise<void>;
  remove(name: string, options?: SkillMarketRequestOptions): Promise<void>;
  owner: {
    list(options?: SkillMarketRequestOptions): Promise<OwnerSkillRecord[]>;
    submit(
      input: SubmitSkillRequest,
      options?: SkillMarketRequestOptions,
    ): Promise<OwnerSkillRecord>;
    update(
      name: string,
      input: UpdatePublishedSkillRequest,
      options?: SkillMarketRequestOptions,
    ): Promise<OwnerSkillRecord>;
    delist(name: string, options?: SkillMarketRequestOptions): Promise<OwnerSkillRecord>;
  };
}

export interface AdminSkillClient {
  listPending(options?: SkillMarketRequestOptions): Promise<AdminSkillReviewRecord[]>;
  approve(skillId: string, options?: SkillMarketRequestOptions): Promise<AdminSkillReviewRecord>;
  reject(
    skillId: string,
    reason: string,
    options?: SkillMarketRequestOptions,
  ): Promise<AdminSkillReviewRecord>;
  delist(skillId: string, options?: SkillMarketRequestOptions): Promise<AdminSkillReviewRecord>;
}

export function createSkillMarketClient(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
): SkillMarketClient {
  return {
    list: async (options) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries({
        page: options?.page,
        pageSize: options?.pageSize,
        keyword: options?.keyword,
        category: options?.category,
        sort: options?.sort,
      })) {
        if (value !== undefined) params.set(key, String(value));
      }
      const query = params.toString();
      return decodePage(
        await requestJson(
          fetchImplementation,
          'GET',
          `${baseUrl}/api/v1/skills${query ? `?${query}` : ''}`,
          undefined,
          options,
        ),
      );
    },
    detail: async (name, options) =>
      decodeDetail(
        await requestJson(
          fetchImplementation,
          'GET',
          `${baseUrl}/api/v1/skills/${encodeURIComponent(name)}`,
          undefined,
          options,
        ),
      ),
    file: async (name, path, options) =>
      decodeFilePreview(
        await requestJson(
          fetchImplementation,
          'GET',
          `${baseUrl}/api/v1/skills/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`,
          undefined,
          options,
        ),
      ),
    add: (name, options) =>
      requestVoid(
        fetchImplementation,
        'PUT',
        `${baseUrl}/api/v1/skills/${encodeURIComponent(name)}/add`,
        options,
      ),
    remove: (name, options) =>
      requestVoid(
        fetchImplementation,
        'DELETE',
        `${baseUrl}/api/v1/skills/${encodeURIComponent(name)}/add`,
        options,
      ),
    owner: {
      list: async (options) =>
        decodeArray(
          await requestJson(
            fetchImplementation,
            'GET',
            `${baseUrl}/api/v1/skills/owner`,
            undefined,
            options,
          ),
          decodeOwner,
        ),
      submit: async (input, options) =>
        decodeOwner(
          await requestJson(
            fetchImplementation,
            'POST',
            `${baseUrl}/api/v1/skills/owner`,
            input,
            options,
          ),
        ),
      update: async (name, input, options) =>
        decodeOwner(
          await requestJson(
            fetchImplementation,
            'PATCH',
            `${baseUrl}/api/v1/skills/owner/${encodeURIComponent(name)}`,
            input,
            options,
          ),
        ),
      delist: async (name, options) =>
        decodeOwner(
          await requestJson(
            fetchImplementation,
            'DELETE',
            `${baseUrl}/api/v1/skills/owner/${encodeURIComponent(name)}`,
            undefined,
            options,
          ),
        ),
    },
  };
}

export function createAdminSkillClient(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
): AdminSkillClient {
  const mutate = async (
    skillId: string,
    action: 'approve' | 'reject' | 'delist',
    body: unknown,
    options: SkillMarketRequestOptions | undefined,
  ) =>
    decodeAdmin(
      await requestJson(
        fetchImplementation,
        'POST',
        `${baseUrl}/api/v1/admin/skills/${encodeURIComponent(skillId)}/${action}`,
        body,
        options,
      ),
    );
  return {
    listPending: async (options) =>
      decodeArray(
        await requestJson(
          fetchImplementation,
          'GET',
          `${baseUrl}/api/v1/admin/skills/reviews`,
          undefined,
          options,
        ),
        decodeAdmin,
      ),
    approve: (skillId, options) => mutate(skillId, 'approve', undefined, options),
    reject: (skillId, reason, options) => mutate(skillId, 'reject', { reason }, options),
    delist: (skillId, options) => mutate(skillId, 'delist', undefined, options),
  };
}

function decodePage(value: unknown): SkillMarketPage {
  const record = object(value);
  if (
    !record ||
    !Array.isArray(record.items) ||
    !nonNegativeInteger(record.page) ||
    !nonNegativeInteger(record.pageSize) ||
    !nonNegativeInteger(record.total) ||
    !nonNegativeInteger(record.totalPages)
  ) {
    malformed('Skill market page');
  }
  return {
    items: record.items.map(decodeSummary),
    page: record.page as number,
    pageSize: record.pageSize as number,
    total: record.total as number,
    totalPages: record.totalPages as number,
  };
}

function decodeDetail(value: unknown): AgentSkillMarketDetail {
  const record = object(value);
  const summary = decodeSummary(value);
  if (!record || typeof record.skillMarkdown !== 'string' || !Array.isArray(record.files)) {
    malformed('Skill market detail');
  }
  return {
    ...summary,
    skillMarkdown: record.skillMarkdown as string,
    files: (record.files as unknown[]).map(decodeFile),
  };
}

function decodeSummary(value: unknown): AgentSkillMarketSummary {
  const record = object(value);
  if (
    !record ||
    !strings(record, ['id', 'name', 'title', 'description', 'updatedAt']) ||
    !AGENT_SKILL_CATEGORIES.includes(record.category as AgentSkillCategory) ||
    record.publicationStatus !== 'published' ||
    !['not_added', 'added', 'unavailable'].includes(String(record.addState)) ||
    !nonNegativeInteger(record.addCount) ||
    typeof record.ownedByCurrentUser !== 'boolean'
  ) {
    malformed('Skill market summary');
  }
  return record as unknown as AgentSkillMarketSummary;
}

function decodeOwner(value: unknown): OwnerSkillRecord {
  const record = object(value);
  if (
    !record ||
    !strings(record, ['id', 'name', 'title', 'description']) ||
    !AGENT_SKILL_CATEGORIES.includes(record.category as AgentSkillCategory) ||
    !AGENT_SKILL_PUBLICATION_STATUSES.includes(
      record.publicationStatus as AgentSkillPublicationStatus,
    ) ||
    (record.packageSha256 !== null && typeof record.packageSha256 !== 'string') ||
    (record.packageSizeBytes !== null && !nonNegativeInteger(record.packageSizeBytes))
  ) {
    malformed('Owner Skill');
  }
  return record as unknown as OwnerSkillRecord;
}

function decodeAdmin(value: unknown): AdminSkillReviewRecord {
  const record = object(value);
  if (
    !record ||
    !strings(record, ['id', 'name', 'title', 'description', 'ownerId', 'createdAt', 'updatedAt']) ||
    !AGENT_SKILL_CATEGORIES.includes(record.category as AgentSkillCategory) ||
    !['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'DELISTED'].includes(String(record.status)) ||
    (record.packageSha256 !== null && typeof record.packageSha256 !== 'string')
  ) {
    malformed('Admin Skill review');
  }
  return record as unknown as AdminSkillReviewRecord;
}

function decodeFile(value: unknown): AgentSkillFileEntry {
  const record = object(value);
  if (
    !record ||
    typeof record.path !== 'string' ||
    !['file', 'directory'].includes(String(record.type)) ||
    (record.size !== null && !nonNegativeInteger(record.size))
  ) {
    malformed('Skill file');
  }
  return record as unknown as AgentSkillFileEntry;
}

function decodeFilePreview(value: unknown): AgentSkillFilePreview {
  const record = object(value);
  if (
    !record ||
    typeof record.path !== 'string' ||
    (record.content !== null && typeof record.content !== 'string') ||
    typeof record.previewable !== 'boolean' ||
    typeof record.truncated !== 'boolean'
  ) {
    malformed('Skill file preview');
  }
  return record as unknown as AgentSkillFilePreview;
}

function decodeArray<T>(value: unknown, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) malformed('Skill list');
  return (value as unknown[]).map(decode);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function strings(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof record[key] === 'string');
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function malformed(kind: string): never {
  throw new AIGatewayProtocolError('unknown', `${kind} response is malformed`);
}
