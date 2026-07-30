import { PLATFORM_MCP_SERVERS } from './agent-mcp.config'

describe('platform MCP configuration', () => {
  it('registers VariFlight with server-side query-key authentication', () => {
    expect(PLATFORM_MCP_SERVERS).toContainEqual(
      expect.objectContaining({
        id: 'variflight-aviation',
        name: '航旅-航班',
        url: 'https://ai.variflight.com/servers/aviation/mcp/',
        auth: {
          type: 'query',
          parameter: 'api_key',
          tokenEnv: 'VARIFLIGHT_MCP_API_KEY',
        },
      }),
    )
  })
})
