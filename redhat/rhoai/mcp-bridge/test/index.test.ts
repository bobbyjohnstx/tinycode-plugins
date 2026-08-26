import { describe, it, expect, mock } from "bun:test"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"
import { createBridgeTools, createUnconfiguredBridgeTools } from "../src/index"
import type { McpClient } from "../src/mcp-client"
import { createMcpClient } from "../src/mcp-client"

function createMockMcpClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    listTools: async () => [],
    callTool: async () => "",
    ...overrides,
  }
}

describe("tinycode-plugin-rhoai-mcp-bridge", () => {
  it("loads without error", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks).toBeDefined()
  })

  it("registers two tools", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks.tool).toBeDefined()
    const toolNames = Object.keys(hooks.tool!)
    expect(toolNames).toContain("rhoai_mcp_list")
    expect(toolNames).toContain("rhoai_mcp_call")
    expect(toolNames).toHaveLength(2)
  })

  it("all tools have descriptions", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    for (const [_name, tool] of Object.entries(hooks.tool!)) {
      expect(tool.description).toBeTruthy()
      expect(typeof tool.description).toBe("string")
    }
  })

  it("returns unconfigured message when mcpServerUrl not set", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    const listResult = (await hooks.tool!.rhoai_mcp_list!.execute(
      {},
      undefined as any,
    )) as string
    expect(listResult).toContain("not configured")
    expect(listResult).toContain("mcpServerUrl")

    const callResult = (await hooks.tool!.rhoai_mcp_call!.execute(
      { tool: "anything" },
      undefined as any,
    )) as string
    expect(callResult).toContain("not configured")
    expect(callResult).toContain("mcpServerUrl")
  })

  describe("rhoai_mcp_list", () => {
    it("lists tools from MCP server", async () => {
      const client = createMockMcpClient({
        listTools: async () => [
          { name: "tool-a", description: "Does A", inputSchema: {} },
          { name: "tool-b", description: "Does B", inputSchema: {} },
        ],
      })
      const tools = createBridgeTools(client)
      const result = (await tools.rhoai_mcp_list!.execute(
        {},
        undefined as any,
      )) as string
      expect(result).toContain("tool-a: Does A")
      expect(result).toContain("tool-b: Does B")
    })

    it("returns empty message when no tools available", async () => {
      const client = createMockMcpClient()
      const tools = createBridgeTools(client)
      const result = (await tools.rhoai_mcp_list!.execute(
        {},
        undefined as any,
      )) as string
      expect(result).toContain("No tools available")
    })

    it("returns error on server failure", async () => {
      const client = createMockMcpClient({
        listTools: async () => {
          throw new Error("Connection refused")
        },
      })
      const tools = createBridgeTools(client)
      const result = (await tools.rhoai_mcp_list!.execute(
        {},
        undefined as any,
      )) as string
      expect(result).toContain("Error listing MCP tools")
      expect(result).toContain("Connection refused")
    })
  })

  describe("rhoai_mcp_call", () => {
    it("calls tool and returns result", async () => {
      const client = createMockMcpClient({
        callTool: async (name, args) => `Called ${name} with ${JSON.stringify(args)}`,
      })
      const tools = createBridgeTools(client)
      const result = (await tools.rhoai_mcp_call!.execute(
        { tool: "my-tool", args: '{"key":"value"}' },
        undefined as any,
      )) as string
      expect(result).toContain("Called my-tool")
      expect(result).toContain('"key":"value"')
    })

    it("returns error for invalid JSON args", async () => {
      const client = createMockMcpClient()
      const tools = createBridgeTools(client)
      const result = (await tools.rhoai_mcp_call!.execute(
        { tool: "my-tool", args: "not-json{" },
        undefined as any,
      )) as string
      expect(result).toContain("Invalid JSON in args")
      expect(result).toContain("not-json{")
    })

    it("returns error when tool call fails", async () => {
      const client = createMockMcpClient({
        callTool: async () => {
          throw new Error("Tool not found")
        },
      })
      const tools = createBridgeTools(client)
      const result = (await tools.rhoai_mcp_call!.execute(
        { tool: "nonexistent", args: "{}" },
        undefined as any,
      )) as string
      expect(result).toContain("Error calling MCP tool")
      expect(result).toContain("Tool not found")
    })

    it("calls tool with empty args when not provided", async () => {
      const callToolMock = mock(async (_name: string, _args: Record<string, unknown>) => "ok")
      const client = createMockMcpClient({ callTool: callToolMock })
      const tools = createBridgeTools(client)
      const result = (await tools.rhoai_mcp_call!.execute(
        { tool: "my-tool" },
        undefined as any,
      )) as string
      expect(result).toBe("ok")
      expect(callToolMock).toHaveBeenCalledWith("my-tool", {})
    })
  })

  describe("mcp-client", () => {
    it("constructs correct JSON-RPC requests", async () => {
      let capturedUrl = ""
      let capturedInit: RequestInit | undefined

      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = typeof input === "string" ? input : input.toString()
        capturedInit = init
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { tools: [{ name: "test-tool", description: "A tool", inputSchema: {} }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }) as unknown as typeof fetch

      try {
        const client = createMcpClient({ serverUrl: "http://localhost:8080" })
        const tools = await client.listTools()

        expect(capturedUrl).toBe("http://localhost:8080")
        expect(capturedInit?.method).toBe("POST")
        const body = JSON.parse(capturedInit?.body as string)
        expect(body.jsonrpc).toBe("2.0")
        expect(body.method).toBe("tools/list")
        expect(tools).toHaveLength(1)
        expect(tools[0]!.name).toBe("test-tool")
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})
