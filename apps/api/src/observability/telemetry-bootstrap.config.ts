export interface TelemetryBootstrapEnvironment {
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string
  OTEL_SERVICE_NAME?: string
}

export interface TelemetryBootstrapConfig {
  enabled: boolean
  tracesEndpoint: string
  serviceName: string
}

const DEFAULT_TRACES_ENDPOINT = 'http://otel-collector:4318/v1/traces'

export function resolveTelemetryBootstrapConfig(
  environment: TelemetryBootstrapEnvironment = process.env,
): TelemetryBootstrapConfig {
  const serviceName = environment.OTEL_SERVICE_NAME?.trim() || 'supermind-api'
  const tracesEndpoint =
    environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || DEFAULT_TRACES_ENDPOINT

  return { enabled: true, serviceName, tracesEndpoint }
}
