import { PLATFORM_MCP_SERVERS } from './agent-mcp.config'

describe('platform MCP configuration', () => {
  it('keeps VariFlight disabled until it provides a non-downgraded HTTPS endpoint', () => {
    expect(PLATFORM_MCP_SERVERS).not.toContainEqual(
      expect.objectContaining({ id: 'variflight-aviation' }),
    )
  })
})
