import { createApiClient, type ApiClient } from "tinycode-plugin-redhat-shared/api"

export type McpToolDef = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpToolResult = {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

export type McpClientConfig = {
  serverUrl: string
  tokenFn?: () => Promise<string>
}

export type McpClient = {
  listTools(): Promise<McpToolDef[]>
  callTool(name: string, args: Record<string, unknown>): Promise<string>
}

export function createMcpClient(config: McpClientConfig): McpClient {
  const client = createApiClient({
    baseUrl: config.serverUrl,
    tokenFn: config.tokenFn ?? (async () => ""),
  })

  async function rpcCall(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const body = { jsonrpc: "2.0", id: 1, method, params: params ?? {} }
    const response = await client.post<{ result?: unknown; error?: { message: string } }>("", body)
    if (response.data.error) {
      throw new Error(response.data.error.message)
    }
    return response.data.result
  }

  return {
    async listTools(): Promise<McpToolDef[]> {
      const result = await rpcCall("tools/list") as { tools: McpToolDef[] }
      return result.tools ?? []
    },

    async callTool(name: string, args: Record<string, unknown>): Promise<string> {
      const result = await rpcCall("tools/call", { name, arguments: args }) as McpToolResult
      if (result.isError) {
        throw new Error(result.content.map(c => c.text ?? "").join("\n") || "Tool call failed")
      }
      return result.content.map(c => c.text ?? "").join("\n")
    },
  }
}
