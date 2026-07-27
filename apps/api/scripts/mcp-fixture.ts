import { createServer, type IncomingMessage } from 'node:http'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

export interface McpFixtureServer {
  url: string
  calls: Array<{ toolName: string; arguments: Record<string, unknown> }>
  close(): Promise<void>
}

export async function startMcpFixtureServer(
  options: {
    bearerToken?: string
  } = {},
): Promise<McpFixtureServer> {
  const calls: Array<{ toolName: string; arguments: Record<string, unknown> }> = []
  const server = createServer(async (request, response) => {
    if (request.url !== '/mcp' || request.method !== 'POST') {
      response.writeHead(405, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Method not allowed' },
        }),
      )
      return
    }
    if (options.bearerToken && request.headers.authorization !== `Bearer ${options.bearerToken}`) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }

    const mcp = createFixtureMcpServer(calls)
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    response.once('close', () => {
      void transport.close()
      void mcp.close()
    })
    try {
      const body = await readJsonBody(request)
      await mcp.connect(transport as unknown as Parameters<McpServer['connect']>[0])
      await transport.handleRequest(request, response, body)
    } catch {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: 'Fixture failure' },
          }),
        )
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable')

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

function createFixtureMcpServer(
  calls: Array<{ toolName: string; arguments: Record<string, unknown> }>,
): McpServer {
  const server = new McpServer({ name: 'supermind-mcp-fixture', version: '1.0.0' })
  server.registerTool(
    'echo',
    {
      description: 'Echo fixture text',
      inputSchema: { text: z.string().min(1).max(500) },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ text }) => {
      calls.push({ toolName: 'echo', arguments: { text } })
      return { content: [{ type: 'text', text: `fixture:${text}` }] }
    },
  )
  server.registerTool(
    'hidden',
    {
      description: 'Must remain outside the platform allowlist',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async () => {
      calls.push({ toolName: 'hidden', arguments: {} })
      return { content: [{ type: 'text', text: 'should-not-run' }] }
    },
  )
  return server
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > 1_000_000) throw new Error('request too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
