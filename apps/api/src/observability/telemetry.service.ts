import { Injectable } from '@nestjs/common'
import { metrics, trace, SpanStatusCode, type Attributes, type Span } from '@opentelemetry/api'

export type TelemetrySpanName =
  | 'agent.run'
  | 'agent.context.prepare'
  | 'agent.model.invoke'
  | 'agent.tool.invoke'
  | 'agent.mcp.call'
  | 'request.lifecycle.finalize'

export interface TelemetryAttributes {
  requestId?: string | undefined
  runId?: string | undefined
  capability?: 'agent' | 'image' | 'prompt' | undefined
  provider?: string | undefined
  model?: string | undefined
  toolName?: string | undefined
  mcpServer?: string | undefined
  status?: 'succeeded' | 'failed' | 'cancelled' | undefined
  errorCode?: string | undefined
  failover?: boolean | undefined
  ttfbMs?: number | undefined
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  totalTokens?: number | undefined
  costCny?: number | undefined
}

const tracer = trace.getTracer('supermind.observability')
const meter = metrics.getMeter('supermind.observability')
const agentRunDuration = meter.createHistogram('supermind.agent.run.duration', { unit: 'ms' })
const modelTtfb = meter.createHistogram('supermind.model.ttfb', { unit: 'ms' })
const modelInvocations = meter.createCounter('supermind.model.invocations')

@Injectable()
export class TelemetryService {
  startSpan(name: TelemetrySpanName, attributes: TelemetryAttributes): Span {
    return tracer.startSpan(name, { attributes: toSpanAttributes(attributes) })
  }

  endSpan(span: Span, status: 'ok' | 'error', attributes: TelemetryAttributes = {}): void {
    span.setAttributes(toSpanAttributes(attributes))
    span.setStatus({ code: status === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR })
    span.end()
  }

  async withSpan<T>(
    name: TelemetrySpanName,
    attributes: TelemetryAttributes,
    operation: () => Promise<T>,
  ): Promise<T> {
    return tracer.startActiveSpan(
      name,
      { attributes: toSpanAttributes(attributes) },
      async (span) => {
        try {
          const result = await operation()
          span.setStatus({ code: SpanStatusCode.OK })
          return result
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR })
          throw error
        } finally {
          span.end()
        }
      },
    )
  }

  recordModelInvocation(attributes: TelemetryAttributes): void {
    const metricAttributes = toMetricAttributes(attributes)
    modelInvocations.add(1, metricAttributes)
    if (attributes.ttfbMs !== undefined) modelTtfb.record(attributes.ttfbMs, metricAttributes)
  }

  recordAgentRunDuration(durationMs: number, attributes: TelemetryAttributes): void {
    agentRunDuration.record(durationMs, toMetricAttributes(attributes))
  }

  addOutcome(span: Span, attributes: TelemetryAttributes): void {
    span.setAttributes(toSpanAttributes(attributes))
  }
}

function toSpanAttributes(attributes: TelemetryAttributes): Attributes {
  return compactAttributes({
    'supermind.request_id': attributes.requestId,
    'supermind.agent_run_id': attributes.runId,
    'supermind.capability': attributes.capability,
    'gen_ai.provider.name': attributes.provider,
    'gen_ai.request.model': attributes.model,
    'supermind.tool.name': attributes.toolName,
    'supermind.mcp.server': attributes.mcpServer,
    'supermind.status': attributes.status,
    'error.type': attributes.errorCode,
    'supermind.failover': attributes.failover,
    'supermind.ttfb_ms': attributes.ttfbMs,
    'gen_ai.usage.input_tokens': attributes.inputTokens,
    'gen_ai.usage.output_tokens': attributes.outputTokens,
    'gen_ai.usage.total_tokens': attributes.totalTokens,
    'supermind.cost_cny': attributes.costCny,
  })
}

function toMetricAttributes(attributes: TelemetryAttributes): Attributes {
  return compactAttributes({
    'supermind.capability': attributes.capability,
    'gen_ai.provider.name': attributes.provider,
    'gen_ai.request.model': attributes.model,
    'supermind.tool.name': attributes.toolName,
    'supermind.status': attributes.status,
    'supermind.failover': attributes.failover,
  })
}

function compactAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined),
  ) as Attributes
}
