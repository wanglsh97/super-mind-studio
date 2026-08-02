import { resolveTelemetryBootstrapConfig } from './telemetry-bootstrap.config'

describe('resolveTelemetryBootstrapConfig', () => {
  it('enables telemetry with the internal collector default', () => {
    expect(resolveTelemetryBootstrapConfig({})).toEqual({
      enabled: true,
      serviceName: 'supermind-api',
      tracesEndpoint: 'http://otel-collector:4318/v1/traces',
    })
  })

  it('allows the Collector endpoint and service name to be overridden', () => {
    expect(
      resolveTelemetryBootstrapConfig({
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
