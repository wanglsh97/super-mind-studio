import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

import { resolveTelemetryBootstrapConfig } from './telemetry-bootstrap.config'

let sdk: NodeSDK | undefined

export function startOpenTelemetry(): void {
  const config = resolveTelemetryBootstrapConfig()
  if (!config.enabled || !config.tracesEndpoint) {
    if (config.disabledReason === 'missing_traces_endpoint') {
      console.warn(
        '[otel] OTEL_ENABLED=true but OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is not configured; telemetry is disabled',
      )
    }
    return
  }

  try {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: config.serviceName }),
      traceExporter: new OTLPTraceExporter({ url: config.tracesEndpoint }),
      instrumentations: [getNodeAutoInstrumentations()],
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

startOpenTelemetry()
