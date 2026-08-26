import { describe, it, expect } from "bun:test"
import type { ToolContext } from "tinycode-plugin"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"
import { createRhdpTools, createUnconfiguredRhdpTools } from "../src/index"
import type { RhdpClient } from "../src/rhdp-client"

function createMockRhdpClient(
  overrides: Partial<RhdpClient> = {},
): RhdpClient {
  return {
    searchCatalog: async () => [],
    provision: async () => ({
      orderId: "ord-1",
      status: "pending" as const,
      startedAt: "2026-01-01T00:00:00Z",
    }),
    getStatus: async () => ({
      orderId: "ord-1",
      status: "pending" as const,
      startedAt: "2026-01-01T00:00:00Z",
    }),
    listActive: async () => [],
    ...overrides,
  }
}

const mockCtx = {
  ask: async () => {},
} as unknown as ToolContext

const denyCtx = {
  ask: async () => {
    throw new Error("Permission denied")
  },
} as unknown as ToolContext

async function getTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

describe("tinycode-plugin-rhdp-provisioner", () => {
  describe("plugin loading", () => {
    it("loads without error", async () => {
      const tools = await getTools(undefined)
      expect(tools).toBeDefined()
    })

    it("registers all four tools", async () => {
      const tools = await getTools(undefined)
      expect(tools.rhdp_search).toBeDefined()
      expect(tools.rhdp_provision).toBeDefined()
      expect(tools.rhdp_status).toBeDefined()
      expect(tools.rhdp_list_active).toBeDefined()
    })

    it("all tools have descriptions", async () => {
      const tools = await getTools(undefined)
      expect(tools.rhdp_search.description).toBeTruthy()
      expect(tools.rhdp_provision.description).toBeTruthy()
      expect(tools.rhdp_status.description).toBeTruthy()
      expect(tools.rhdp_list_active.description).toBeTruthy()
    })
  })

  describe("unconfigured tools", () => {
    it("returns unconfigured message when consoleOfflineToken not set", async () => {
      const tools = await getTools(undefined)

      const searchResult = await tools.rhdp_search.execute(
        { query: "openshift" },
        {} as never,
      )
      expect(searchResult).toContain("not configured")

      const provisionResult = await tools.rhdp_provision.execute(
        { catalogItemId: "item-1" },
        {} as never,
      )
      expect(provisionResult).toContain("not configured")

      const statusResult = await tools.rhdp_status.execute(
        { orderId: "ord-1" },
        {} as never,
      )
      expect(statusResult).toContain("not configured")

      const listResult = await tools.rhdp_list_active.execute(
        {},
        {} as never,
      )
      expect(listResult).toContain("not configured")
    })
  })

  describe("rhdp_search", () => {
    it("searches catalog", async () => {
      const client = createMockRhdpClient({
        searchCatalog: async () => [
          {
            id: "item-1",
            name: "OpenShift Workshop",
            description: "Hands-on OpenShift workshop",
            category: "workshop",
            provider: "Red Hat",
            estimatedTime: "2 hours",
          },
          {
            id: "item-2",
            name: "Ansible Demo",
            description: "Ansible automation demo",
            category: "demo",
            provider: "Red Hat",
          },
        ],
      })
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_search.execute(
        { query: "openshift" },
        {} as never,
      )
      expect(result).toContain("OpenShift Workshop")
      expect(result).toContain("Ansible Demo")
      expect(result).toContain("2 hours")
    })

    it("filters by category", async () => {
      const client = createMockRhdpClient({
        searchCatalog: async (_query, category) => {
          if (category === "workshop") {
            return [
              {
                id: "item-1",
                name: "OpenShift Workshop",
                description: "Workshop",
                category: "workshop",
                provider: "Red Hat",
              },
            ]
          }
          return []
        },
      })
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_search.execute(
        { query: "openshift", category: "workshop" },
        {} as never,
      )
      expect(result).toContain("OpenShift Workshop")
    })

    it("returns empty for no matches", async () => {
      const client = createMockRhdpClient()
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_search.execute(
        { query: "nonexistent" },
        {} as never,
      )
      expect(result).toContain("No catalog items found")
    })

    it("returns error on failure", async () => {
      const client = createMockRhdpClient({
        searchCatalog: async () => {
          throw new Error("Connection refused")
        },
      })
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_search.execute(
        { query: "openshift" },
        {} as never,
      )
      expect(result).toContain("Catalog search failed")
      expect(result).toContain("Connection refused")
    })
  })

  describe("rhdp_provision", () => {
    it("provisions after permission", async () => {
      const client = createMockRhdpClient({
        provision: async () => ({
          orderId: "ord-42",
          status: "provisioning" as const,
          startedAt: "2026-01-15T10:00:00Z",
        }),
      })
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_provision.execute(
        { catalogItemId: "item-1" },
        mockCtx,
      )
      expect(result).toContain("ord-42")
      expect(result).toContain("provisioning")
    })

    it("returns error on permission denied", async () => {
      const client = createMockRhdpClient()
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_provision.execute(
        { catalogItemId: "item-1" },
        denyCtx,
      )
      expect(result).toContain("Provisioning failed")
      expect(result).toContain("Permission denied")
    })

    it("returns error on provision failure", async () => {
      const client = createMockRhdpClient({
        provision: async () => {
          throw new Error("Service unavailable")
        },
      })
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_provision.execute(
        { catalogItemId: "item-1" },
        mockCtx,
      )
      expect(result).toContain("Provisioning failed")
      expect(result).toContain("Service unavailable")
    })
  })

  describe("rhdp_status", () => {
    it("returns ready status with connection details", async () => {
      const client = createMockRhdpClient({
        getStatus: async () => ({
          orderId: "ord-42",
          status: "ready" as const,
          startedAt: "2026-01-15T10:00:00Z",
          readyAt: "2026-01-15T10:15:00Z",
          consoleUrl: "https://console.example.com",
          apiUrl: "https://api.example.com:6443",
          credentials: { username: "admin", password: "secret123" },
          expiresAt: "2026-01-16T10:00:00Z",
        }),
      })
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_status.execute(
        { orderId: "ord-42" },
        {} as never,
      )
      expect(result).toContain("ready")
      expect(result).toContain("https://console.example.com")
      expect(result).toContain("admin")
      expect(result).not.toContain("secret123")
      expect(result).toContain("[REDACTED")
      expect(result).toContain("2026-01-16T10:00:00Z")
    })

    it("returns pending status", async () => {
      const client = createMockRhdpClient()
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_status.execute(
        { orderId: "ord-1" },
        {} as never,
      )
      expect(result).toContain("pending")
      expect(result).toContain("ord-1")
    })

    it("returns error on failure", async () => {
      const client = createMockRhdpClient({
        getStatus: async () => {
          throw new Error("Not found")
        },
      })
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_status.execute(
        { orderId: "invalid" },
        {} as never,
      )
      expect(result).toContain("Status check failed")
      expect(result).toContain("Not found")
    })
  })

  describe("rhdp_list_active", () => {
    it("lists active environments", async () => {
      const client = createMockRhdpClient({
        listActive: async () => [
          {
            orderId: "ord-1",
            catalogItemName: "OpenShift Workshop",
            status: "ready",
            consoleUrl: "https://console.example.com",
            expiresAt: "2026-01-16T10:00:00Z",
            startedAt: "2026-01-15T10:00:00Z",
          },
          {
            orderId: "ord-2",
            catalogItemName: "Ansible Demo",
            status: "provisioning",
            startedAt: "2026-01-15T11:00:00Z",
          },
        ],
      })
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_list_active.execute({}, {} as never)
      expect(result).toContain("OpenShift Workshop")
      expect(result).toContain("Ansible Demo")
      expect(result).toContain("https://console.example.com")
    })

    it("returns empty when no active environments", async () => {
      const client = createMockRhdpClient()
      const tools = createRhdpTools(client)
      const result = await tools.rhdp_list_active.execute({}, {} as never)
      expect(result).toContain("No active environments")
    })
  })
})
