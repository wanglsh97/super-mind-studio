export interface TelemetryBootstrapEnvironment {
  OTEL_ENABLED?: string
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string
  OTEL_SERVICE_NAME?: string
}

export interface TelemetryBootstrapConfig {
  enabled: boolean
  tracesEndpoint?: string
  serviceName: string
  disabledReason?: 'disabled_by_environment' | 'missing_traces_endpoint'
}

export function resolveTelemetryBootstrapConfig(
  environment: TelemetryBootstrapEnvironment = process.env,
): TelemetryBootstrapConfig {
  const serviceName = environment.OTEL_SERVICE_NAME?.trim() || 'supermind-api'
  if (environment.OTEL_ENABLED?.trim().toLowerCase() !== 'true') {
    return { enabled: false, serviceName, disabledReason: 'disabled_by_environment' }
  }

  const tracesEndpoint = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
  if (!tracesEndpoint) {
    return { enabled: false, serviceName, disabledReason: 'missing_traces_endpoint' }
  }

  return { enabled: true, serviceName, tracesEndpoint }
}
