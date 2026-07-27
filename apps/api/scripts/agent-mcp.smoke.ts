import { AgentMcpSdkClient } from '../src/agent/mcp/agent-mcp.client'
import { startMcpFixtureServer } from './mcp-fixture'

async function main(): Promise<void> {
  const fixture = await startMcpFixtureServer()
  try {
    const client = new AgentMcpSdkClient()
    const signal = new AbortController().signal
    const discovery = await client.discover({
      url: fixture.url,
      signal,
      timeoutMs: 5_000,
      maxResponseBytes: 100_000,
      maxTools: 10,
    })
    const invocation = await client.callTool({
      url: fixture.url,
      toolName: 'echo',
      arguments: { text: 'MCP_OK' },
      signal,
      timeoutMs: 5_000,
      maxResponseBytes: 100_000,
      maxOutputChars: 1_000,
    })
    console.log(
      JSON.stringify({
        mode: 'local-streamable-http-fixture',
        server: discovery.serverName,
        version: discovery.serverVersion,
        tools: discovery.tools.map((tool) => tool.name),
        result: invocation.content,
        calls: fixture.calls.length,
      }),
    )
  } finally {
    await fixture.close()
  }
}

void main()
