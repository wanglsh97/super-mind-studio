import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

import { resolveTelemetryBootstrapConfig } from './telemetry-bootstrap.config'

let sdk: NodeSDK | undefined

const HTTP_REDACTED_QUERY_PARAMS = [
  'access_token',
  'api_key',
  'code',
  'key',
  'password',
  'secret',
  'state',
  'token',
]

function createSafeInstrumentations() {
  return [
    new NestInstrumentation(),
    new HttpInstrumentation({
      headersToSpanAttributes: {},
      redactedQueryParams: HTTP_REDACTED_QUERY_PARAMS,
    }),
    new PgInstrumentation({
      addSqlCommenterCommentToQueries: false,
      enhancedDatabaseReporting: false,
      requestHook(span) {
        span.setAttribute('db.query.text', '[REDACTED]')
        span.setAttribute('db.statement', '[REDACTED]')
      },
    }),
    new RedisInstrumentation({ dbStatementSerializer: (command) => command }),
    new UndiciInstrumentation({ headersToSpanAttributes: {} }),
  ]
}

export function startOpenTelemetry(): void {
  const config = resolveTelemetryBootstrapConfig()
  if (!config.enabled) return

  try {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: config.serviceName }),
      traceExporter: new OTLPTraceExporter(exporterOptions(config.tracesEndpoint, config.ingestToken)),
      metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(exporterOptions(config.metricsEndpoint, config.ingestToken)), exportIntervalMillis: 10_000 }),
      instrumentations: createSafeInstrumentations(),
    })
    sdk.start()

    const shutdown = () => {
      void sdk?.shutdown().catch((error: unknown) => {
        console.warn('[otel] failed to shut down telemetry', error)
      })
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  } catch (error) {
    // Telemetry is diagnostic-only; a setup failure must never prevent the API from starting.
    console.warn('[otel] failed to initialize telemetry; continuing without telemetry', error)
    sdk = undefined
  }
}

function exporterOptions(url: string, ingestToken: string | undefined): { url: string; headers?: Record<string, string> } {
  return ingestToken ? { url, headers: { 'x-otel-ingest-token': ingestToken } } : { url }
}

startOpenTelemetry()
