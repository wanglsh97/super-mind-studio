export interface TelemetryBootstrapEnvironment {
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?: string
  OTEL_INGEST_TOKEN?: string
  OTEL_SERVICE_NAME?: string
}

export interface TelemetryBootstrapConfig {
  enabled: boolean
  tracesEndpoint: string
  metricsEndpoint: string
  ingestToken?: string | undefined
  serviceName: string
}

const DEFAULT_TRACES_ENDPOINT = 'http://otel-collector:4318/v1/traces'
const DEFAULT_METRICS_ENDPOINT = 'http://otel-collector:4318/v1/metrics'

export function resolveTelemetryBootstrapConfig(
  environment: TelemetryBootstrapEnvironment = process.env,
): TelemetryBootstrapConfig {
  const serviceName = environment.OTEL_SERVICE_NAME?.trim() || 'supermind-api'
  const tracesEndpoint =
    environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || DEFAULT_TRACES_ENDPOINT

  const metricsEndpoint = environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim() || DEFAULT_METRICS_ENDPOINT
  const ingestToken = environment.OTEL_INGEST_TOKEN?.trim() || undefined
  return { enabled: true, serviceName, tracesEndpoint, metricsEndpoint, ingestToken }
}
