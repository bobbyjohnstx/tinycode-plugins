import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createMcpClient } from "./mcp-client"
import type { McpClient } from "./mcp-client"

const optionsSchema = z
  .object({
    mcpServerUrl: z.string().url().describe("URL of the RHOAI MCP server endpoint"),
    oauthToken: z.string().optional().describe("OAuth token for MCP server authentication"),
  })
  .optional()

export function createBridgeTools(client: McpClient): Record<string, ToolDefinition> {
  return {
    rhoai_mcp_list: {
      description:
        "List available tools from the RHOAI MCP server. Returns tool names, descriptions, and input schemas.",
      args: {},
      async execute() {
        try {
          const tools = await client.listTools()
          if (tools.length === 0) {
            return "No tools available on the RHOAI MCP server."
          }
          return tools.map(t => `- ${t.name}: ${t.description}`).join("\n")
        } catch (error) {
          return `Error listing MCP tools: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhoai_mcp_call: {
      description:
        "Call any tool on the RHOAI MCP server by name. Pass tool arguments as a JSON string.",
      args: {
        tool: z.string().describe("Name of the MCP tool to call"),
        args: z.string().optional().describe("JSON string of arguments to pass to the tool"),
      },
      async execute(toolArgs: { tool: string; args?: string }) {
        let parsedArgs: Record<string, unknown> = {}
        if (toolArgs.args) {
          try {
            parsedArgs = JSON.parse(toolArgs.args) as Record<string, unknown>
          } catch {
            return `Invalid JSON in args: ${toolArgs.args}`
          }
        }
        try {
          return await client.callTool(toolArgs.tool, parsedArgs)
        } catch (error) {
          return `Error calling MCP tool '${toolArgs.tool}': ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredBridgeTools(): Record<string, ToolDefinition> {
  const message = "RHOAI MCP Bridge not configured. Set mcpServerUrl in plugin options."
  return {
    rhoai_mcp_list: {
      description: "List available tools from the RHOAI MCP server.",
      args: {},
      async execute() {
        return message
      },
    },
    rhoai_mcp_call: {
      description: "Call any tool on the RHOAI MCP server by name.",
      args: {
        tool: z.string().describe("Name of the MCP tool to call"),
        args: z.string().optional().describe("JSON string of arguments to pass to the tool"),
      },
      async execute() {
        return message
      },
    },
  }
}

export default {
  schema: optionsSchema,
  server: async (_input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined

    let bridgeTools: Record<string, ToolDefinition>
    if (parsed?.mcpServerUrl) {
      const client = createMcpClient({
        serverUrl: parsed.mcpServerUrl,
        tokenFn: parsed.oauthToken ? async () => parsed.oauthToken! : undefined,
      })
      bridgeTools = createBridgeTools(client)
    } else {
      bridgeTools = createUnconfiguredBridgeTools()
    }

    return {
      tool: {
        ...bridgeTools,
      },
    }
  },
} satisfies PluginModule
