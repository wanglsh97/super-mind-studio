import { resolveTelemetryBootstrapConfig } from './telemetry-bootstrap.config'

describe('resolveTelemetryBootstrapConfig', () => {
  it('disables telemetry by default', () => {
    expect(resolveTelemetryBootstrapConfig({})).toEqual({
      enabled: false,
      serviceName: 'supermind-api',
      disabledReason: 'disabled_by_environment',
    })
  })

  it('fails open when telemetry is enabled without a collector endpoint', () => {
    expect(resolveTelemetryBootstrapConfig({ OTEL_ENABLED: 'true' })).toEqual({
      enabled: false,
      serviceName: 'supermind-api',
      disabledReason: 'missing_traces_endpoint',
    })
  })

  it('enables telemetry only with an explicit collector endpoint', () => {
    expect(
      resolveTelemetryBootstrapConfig({
        OTEL_ENABLED: 'TRUE',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://otel-collector:4318/v1/traces',
        OTEL_SERVICE_NAME: ' api ',
      }),
    ).toEqual({
      enabled: true,
      serviceName: 'api',
      tracesEndpoint: 'http://otel-collector:4318/v1/traces',
    })
  })
})
