import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TraceSpanSummary {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'error' | 'unset';
  attributes: Record<string, string | number | boolean>;
}

export interface TraceInfrastructureSummary {
  databaseCalls: number;
  redisCalls: number;
  httpCalls: number;
}

const ALLOWED_ATTRIBUTES = new Set([
  'supermind.request_id',
  'supermind.agent_run_id',
  'supermind.capability',
  'gen_ai.provider.name',
  'gen_ai.request.model',
  'supermind.tool.name',
  'supermind.mcp.server',
  'supermind.status',
  'error.type',
  'supermind.failover',
  'supermind.ttfb_ms',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.total_tokens',
  'supermind.cost_cny',
]);

@Injectable()
export class TempoTraceStore {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async findByRequestId(
    requestId: string,
  ): Promise<{
    traceId?: string;
    spans: TraceSpanSummary[];
    infrastructure: TraceInfrastructureSummary;
  }> {
    const baseUrl =
      this.config.get<string>('TEMPO_QUERY_URL')?.replace(/\/$/, '') || 'http://tempo:3200';
    try {
      const search = await fetch(
        `${baseUrl}/api/search?tags=${encodeURIComponent(`supermind.request_id=${requestId}`)}`,
        { signal: AbortSignal.timeout(3_000) },
      );
      if (!search.ok) throw new Error(`tempo search ${search.status}`);
      const body = (await search.json()) as { traces?: Array<{ traceID?: string }> };
      const traceId = body.traces?.[0]?.traceID;
      if (!traceId) return { spans: [], infrastructure: emptyInfrastructure() };
      const trace = await fetch(`${baseUrl}/api/traces/${encodeURIComponent(traceId)}`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!trace.ok) throw new Error(`tempo trace ${trace.status}`);
      const allSpans = extractSpans(await trace.json());
      return {
        traceId,
        spans: allSpans.filter(isBusinessSpan),
        infrastructure: summarizeInfrastructure(allSpans),
      };
    } catch (error) {
      throw new ServiceUnavailableException('调用链暂不可用');
    }
  }
}

function isBusinessSpan(span: TraceSpanSummary): boolean {
  return span.name.startsWith('agent.') || span.name === 'request.lifecycle.finalize';
}

function summarizeInfrastructure(spans: TraceSpanSummary[]): TraceInfrastructureSummary {
  return {
    databaseCalls: spans.filter(
      (span) => span.name.startsWith('pg.') || span.name.startsWith('pg-pool.'),
    ).length,
    redisCalls: spans.filter((span) => span.name.toLowerCase().includes('redis')).length,
    httpCalls: spans.filter(
      (span) => span.name === 'GET' || span.name === 'POST' || span.name.startsWith('HTTP '),
    ).length,
  };
}

function emptyInfrastructure(): TraceInfrastructureSummary {
  return { databaseCalls: 0, redisCalls: 0, httpCalls: 0 };
}

function extractSpans(payload: unknown): TraceSpanSummary[] {
  const batches =
    (
      payload as {
        batches?: Array<{
          scopeSpans?: Array<{ spans?: unknown[] }>;
          instrumentationLibrarySpans?: Array<{ spans?: unknown[] }>;
        }>;
      }
    ).batches ?? [];
  return batches
    .flatMap((batch) => batch.scopeSpans ?? batch.instrumentationLibrarySpans ?? [])
    .flatMap((scope) => scope.spans ?? [])
    .map(toSummary);
}

function toSummary(span: unknown): TraceSpanSummary {
  const value = span as {
    spanId?: string;
    parentSpanId?: string;
    name?: string;
    startTimeUnixNano?: string;
    endTimeUnixNano?: string;
    durationNanos?: string;
    duration?: string;
    status?: { code?: number };
    attributes?: Array<{
      key?: string;
      value?: { stringValue?: string; intValue?: string; boolValue?: boolean };
    }>;
  };
  const attributes = Object.fromEntries(
    (value.attributes ?? []).flatMap((attribute) => {
      if (!attribute.key || !ALLOWED_ATTRIBUTES.has(attribute.key)) return [];
      const raw = attribute.value;
      const result = raw?.stringValue ?? raw?.intValue ?? raw?.boolValue;
      return result === undefined
        ? []
        : [
            [
              attribute.key,
              typeof result === 'string' && /^\d+$/.test(result) ? Number(result) : result,
            ] as const,
          ];
    }),
  );
  const durationNs =
    value.durationNanos ??
    value.duration ??
    (value.endTimeUnixNano && value.startTimeUnixNano
      ? String(BigInt(value.endTimeUnixNano) - BigInt(value.startTimeUnixNano))
      : '0');
  return {
    spanId: value.spanId ?? '',
    ...(value.parentSpanId ? { parentSpanId: value.parentSpanId } : {}),
    name: value.name ?? 'unknown',
    startedAt: value.startTimeUnixNano ?? '',
    durationMs: Number(durationNs) / 1_000_000,
    status: value.status?.code === 2 ? 'error' : value.status?.code === 1 ? 'ok' : 'unset',
    attributes,
  };
}
