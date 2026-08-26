import { describe, it, expect, mock } from "bun:test"
import type { ToolContext } from "tinycode-plugin"
import {
  createMockInput,
  createMockFetch,
} from "tinycode-plugin-redhat-shared/test-utils"
import {
  createSandboxTools,
  createUnconfiguredSandboxTools,
  formatSandboxStatus,
  parseSandboxStatus,
  type SandboxSignupResponse,
} from "../src/sandbox-tools"
import { createApiClient, type ApiClient } from "tinycode-plugin-redhat-shared/api"
import plugin from "../src/index"

const readySignupResponse: SandboxSignupResponse = {
  status: { ready: true, verificationRequired: false },
  apiEndpoint: "https://api.sandbox-m2.ll9k.p1.openshiftapps.com:6443",
  cheDashboardURL: "https://che-dashboard.apps.sandbox-m2.ll9k.p1.openshiftapps.com",
  clusterName: "sandbox-m2",
  company: "Test Corp",
  compliantUsername: "testuser",
  consoleURL: "https://console-openshift-console.apps.sandbox-m2.ll9k.p1.openshiftapps.com",
  defaultUserNamespace: "testuser-dev",
  startDate: "2026-01-15T10:30:00Z",
}

const pendingSignupResponse: SandboxSignupResponse = {
  status: { ready: false, verificationRequired: false },
}

const mockCtx = {
  ask: async () => {},
} as unknown as ToolContext

const denyCtx = {
  ask: async () => {
    throw new Error("denied")
  },
} as unknown as ToolContext

function createTestApiClient(routes: Array<{
  method?: string
  path: string | RegExp
  status?: number
  body?: unknown
}>): ApiClient {
  const mockFetchFn = createMockFetch(routes)
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetchFn
  const client = createApiClient({
    baseUrl: "https://api.sandbox.devshift.net/api/v1",
    tokenFn: async () => "test-token",
  })
  globalThis.fetch = originalFetch

  // Return a client that uses the mock fetch directly
  return {
    async get<T>(path: string, query?: Record<string, string>) {
      const prev = globalThis.fetch
      globalThis.fetch = mockFetchFn
      try {
        return await client.get<T>(path, query)
      } finally {
        globalThis.fetch = prev
      }
    },
    async post<T>(path: string, body?: unknown) {
      const prev = globalThis.fetch
      globalThis.fetch = mockFetchFn
      try {
        return await client.post<T>(path, body)
      } finally {
        globalThis.fetch = prev
      }
    },
    async put<T>(path: string, body?: unknown) {
      const prev = globalThis.fetch
      globalThis.fetch = mockFetchFn
      try {
        return await client.put<T>(path, body)
      } finally {
        globalThis.fetch = prev
      }
    },
    async delete<T>(path: string) {
      const prev = globalThis.fetch
      globalThis.fetch = mockFetchFn
      try {
        return await client.delete<T>(path)
      } finally {
        globalThis.fetch = prev
      }
    },
  }
}

describe("sandbox-tools", () => {
  describe("parseSandboxStatus", () => {
    it("parses ready state", () => {
      const status = parseSandboxStatus(readySignupResponse)
      expect(status.ready).toBe(true)
      expect(status.state).toBe("ready")
      expect(status.clusterUrl).toBe(
        "api.sandbox-m2.ll9k.p1.openshiftapps.com:6443",
      )
      expect(status.namespace).toBe("testuser-dev")
      expect(status.consoleUrl).toBe(
        "https://console-openshift-console.apps.sandbox-m2.ll9k.p1.openshiftapps.com",
      )
      expect(status.provisionedDate).toBe("2026-01-15")
    })

    it("parses pending state", () => {
      const status = parseSandboxStatus(pendingSignupResponse)
      expect(status.ready).toBe(false)
      expect(status.state).toBe("pending")
    })

    it("parses not-registered state", () => {
      const status = parseSandboxStatus({})
      expect(status.ready).toBe(false)
      expect(status.state).toBe("not-registered")
    })
  })

  describe("formatSandboxStatus", () => {
    it("formats ready status with cluster details", () => {
      const output = formatSandboxStatus(readySignupResponse)
      expect(output).toContain("Developer Sandbox Status: Ready")
      expect(output).toContain("api.sandbox-m2.ll9k.p1.openshiftapps.com:6443")
      expect(output).toContain("testuser-dev")
      expect(output).toContain("Provisioned: 2026-01-15")
    })

    it("formats pending status", () => {
      const output = formatSandboxStatus(pendingSignupResponse)
      expect(output).toContain("Developer Sandbox Status: Pending")
      expect(output).toContain("1-2 minutes")
    })

    it("formats not-registered status", () => {
      const output = formatSandboxStatus({})
      expect(output).toContain("Developer Sandbox Status: Not Registered")
      expect(output).toContain("rhoai_sandbox_provision")
    })
  })

  describe("rhoai_sandbox_status", () => {
    it("returns formatted status for ready sandbox", async () => {
      const client = createTestApiClient([
        {
          method: "GET",
          path: "/signup",
          body: readySignupResponse,
        },
      ])
      const tools = createSandboxTools(client)
      const result = await tools.rhoai_sandbox_status.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Developer Sandbox Status: Ready")
      expect(result).toContain("testuser-dev")
    })

    it("returns formatted status for pending sandbox", async () => {
      const client = createTestApiClient([
        {
          method: "GET",
          path: "/signup",
          body: pendingSignupResponse,
        },
      ])
      const tools = createSandboxTools(client)
      const result = await tools.rhoai_sandbox_status.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Developer Sandbox Status: Pending")
    })

    it("returns formatted status for not-registered sandbox", async () => {
      const client = createTestApiClient([
        {
          method: "GET",
          path: "/signup",
          body: {},
        },
      ])
      const tools = createSandboxTools(client)
      const result = await tools.rhoai_sandbox_status.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Developer Sandbox Status: Not Registered")
    })

    it("returns error on API failure", async () => {
      const client = createTestApiClient([
        {
          method: "GET",
          path: "/signup",
          status: 500,
          body: { error: "Internal Server Error" },
        },
      ])
      const tools = createSandboxTools(client)
      const result = await tools.rhoai_sandbox_status.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Failed to check sandbox status")
    })
  })

  describe("rhoai_sandbox_provision", () => {
    it("provisions sandbox after user confirmation", async () => {
      const client = createTestApiClient([
        {
          method: "POST",
          path: "/signup",
          body: readySignupResponse,
        },
      ])
      const tools = createSandboxTools(client)
      const result = await tools.rhoai_sandbox_provision.execute(
        {},
        mockCtx,
      )
      expect(result).toContain("Developer Sandbox Status: Ready")
      expect(result).toContain("testuser-dev")
    })

    it("returns error when permission denied", async () => {
      const client = createTestApiClient([])
      const tools = createSandboxTools(client)
      const result = await tools.rhoai_sandbox_provision.execute(
        {},
        denyCtx,
      )
      expect(result).toContain("Failed to provision sandbox")
      expect(result).toContain("denied")
    })

    it("returns error on API failure", async () => {
      const client = createTestApiClient([
        {
          method: "POST",
          path: "/signup",
          status: 503,
          body: { error: "Service Unavailable" },
        },
      ])
      const tools = createSandboxTools(client)
      const result = await tools.rhoai_sandbox_provision.execute(
        {},
        mockCtx,
      )
      expect(result).toContain("Failed to provision sandbox")
    })
  })

  describe("unconfigured sandbox tools", () => {
    it("returns helpful message for status", async () => {
      const tools = createUnconfiguredSandboxTools()
      const result = await tools.rhoai_sandbox_status.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Developer Sandbox not configured")
      expect(result).toContain("consoleOfflineToken")
    })

    it("returns helpful message for provision", async () => {
      const tools = createUnconfiguredSandboxTools()
      const result = await tools.rhoai_sandbox_provision.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Developer Sandbox not configured")
      expect(result).toContain("consoleOfflineToken")
    })
  })

  describe("plugin integration", () => {
    it("registers sandbox tools alongside model tools when no token", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      const toolNames = Object.keys(hooks.tool!)
      expect(toolNames).toContain("rhoai_list_models")
      expect(toolNames).toContain("rhoai_model_status")
      expect(toolNames).toContain("rhoai_list_runtimes")
      expect(toolNames).toContain("rhoai_sandbox_status")
      expect(toolNames).toContain("rhoai_sandbox_provision")
      expect(toolNames).toHaveLength(5)
    })

    it("registers unconfigured sandbox stubs when no token provided", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.rhoai_sandbox_status!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Developer Sandbox not configured")
    })

    it("all tools have descriptions", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      for (const [_name, tool] of Object.entries(hooks.tool!)) {
        expect(tool.description).toBeTruthy()
        expect(typeof tool.description).toBe("string")
      }
    })
  })
})
