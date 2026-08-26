import { describe, it, expect, afterEach } from "bun:test"
import type { PluginInput, Hooks } from "tinycode-plugin"
import { createMockShell, createMockFetch } from "tinycode-plugin-redhat-shared/test-utils"
import { queryCostContext, formatCostBlock, type CostContext } from "../src/cost-context"
import { createConsoleApiClient } from "tinycode-plugin-redhat-shared/console-auth"
import plugin from "../src/index"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const mockCostReport = {
  meta: {
    total: {
      cost: { total: { value: 847.23, units: "USD" } },
    },
  },
  data: [
    {
      date: "2026-08",
      projects: [
        {
          project: "gpu-worker-0",
          values: [{ cost: { total: { value: 412.0, units: "USD" } } }],
        },
        {
          project: "web-frontend",
          values: [{ cost: { total: { value: 235.0, units: "USD" } } }],
        },
      ],
    },
  ],
}

const emptyCostReport = {
  meta: { total: { cost: { total: { value: 0, units: "USD" } } } },
  data: [],
}

function createCostApiClient() {
  globalThis.fetch = createMockFetch([
    { method: "POST", path: "/auth/realms/redhat-external", status: 200, body: { access_token: "test-token", expires_in: 3600 } },
    { method: "GET", path: "/reports/openshift/costs/", status: 200, body: mockCostReport },
  ])

  return createConsoleApiClient(
    { offlineToken: "test-offline-token" },
    "/api/cost-management/v1",
  )
}

function createFailingCostApiClient() {
  globalThis.fetch = createMockFetch([
    { method: "POST", path: "/auth/realms/redhat-external", status: 200, body: { access_token: "test-token", expires_in: 3600 } },
    { method: "GET", path: "/reports/openshift/costs/", status: 500, body: { error: "Internal Server Error" } },
  ])

  return createConsoleApiClient(
    { offlineToken: "test-offline-token" },
    "/api/cost-management/v1",
  )
}

function createEmptyCostApiClient() {
  globalThis.fetch = createMockFetch([
    { method: "POST", path: "/auth/realms/redhat-external", status: 200, body: { access_token: "test-token", expires_in: 3600 } },
    { method: "GET", path: "/reports/openshift/costs/", status: 200, body: emptyCostReport },
  ])

  return createConsoleApiClient(
    { offlineToken: "test-offline-token" },
    "/api/cost-management/v1",
  )
}

function createMockInput(shell: PluginInput["$"]): PluginInput {
  return {
    client: {} as PluginInput["client"],
    project: {
      id: "test-project",
      worktree: "/tmp/test",
      time: { created: Date.now() },
    },
    directory: "/tmp/test",
    worktree: "/tmp/test",
    serverUrl: new URL("http://localhost:4096"),
    $: shell,
  }
}

const mockVersionData = {
  clientVersion: { major: "4", minor: "22" },
  serverVersion: { major: "1", minor: "31" },
  openshiftVersion: "4.22.3",
}

const mockNodesData = {
  items: [
    { metadata: { labels: { "node-role.kubernetes.io/control-plane": "" } } },
    { metadata: { labels: { "node-role.kubernetes.io/worker": "" } } },
  ],
}

const mockCsvData = {
  items: [{ spec: { displayName: "OpenShift Virtualization" } }],
}

const baseConnectedCommands = [
  { match: "which oc", output: "/usr/local/bin/oc" },
  { match: "oc whoami", output: "admin" },
  { match: "oc version -o json", json: mockVersionData, output: JSON.stringify(mockVersionData) },
  { match: "oc get nodes -o json", json: mockNodesData, output: JSON.stringify(mockNodesData) },
  { match: "oc config current-context", output: "my-namespace/api-cluster-example-com:6443/admin" },
  { match: "oc get csv -A -o json", output: JSON.stringify(mockCsvData) },
  { match: "alertmanager-main-0", exitCode: 1 },
] as const

function createConnectedShell() {
  return createMockShell([...baseConnectedCommands])
}

async function loadPlugin(shell: PluginInput["$"], options?: Record<string, unknown>): Promise<Hooks> {
  const input = createMockInput(shell)
  return plugin.server(input, options)
}

describe("queryCostContext", () => {
  it("returns CostContext with data from a successful API response", async () => {
    const apiClient = createCostApiClient()
    const result = await queryCostContext(apiClient, "cluster-1")

    expect(result).not.toBeNull()
    expect(result!.monthlyEstimate).toBe("847")
    expect(result!.currency).toBe("USD")
    expect(result!.topResource).toBe("gpu-worker-0")
    expect(result!.topResourceCost).toBe("412")
  })

  it("returns null when API returns an error", async () => {
    const apiClient = createFailingCostApiClient()
    const result = await queryCostContext(apiClient, "cluster-1")

    expect(result).toBeNull()
  })

  it("returns null when data has zero total cost", async () => {
    const apiClient = createEmptyCostApiClient()
    const result = await queryCostContext(apiClient, "cluster-1")

    expect(result).toBeNull()
  })

  it("includes namespace in result when namespace filter is provided", async () => {
    const apiClient = createCostApiClient()
    const result = await queryCostContext(apiClient, "cluster-1", "my-app")

    expect(result).not.toBeNull()
    expect(result!.namespace).toBe("my-app")
  })

  it("omits namespace from result when no namespace filter is provided", async () => {
    const apiClient = createCostApiClient()
    const result = await queryCostContext(apiClient, "cluster-1")

    expect(result).not.toBeNull()
    expect(result!.namespace).toBeUndefined()
  })
})

describe("formatCostBlock", () => {
  it("produces correct cost-context tag with all fields", () => {
    const cost: CostContext = {
      namespace: "my-app",
      monthlyEstimate: "847",
      topResource: "gpu-worker-0",
      topResourceCost: "412",
      currency: "USD",
      trend: "+12%",
    }

    const result = formatCostBlock(cost)
    expect(result).toBe(
      "<cost-context>namespace=my-app monthly-cost=$847 top-resource=gpu-worker-0 ($412/mo) trend=+12%</cost-context>",
    )
  })

  it("produces correct tag with only required fields", () => {
    const cost: CostContext = {
      monthlyEstimate: "50",
      currency: "USD",
    }

    const result = formatCostBlock(cost)
    expect(result).toBe("<cost-context>monthly-cost=$50</cost-context>")
  })

  it("omits dollar prefix for non-USD currency", () => {
    const cost: CostContext = {
      monthlyEstimate: "750",
      currency: "EUR",
    }

    const result = formatCostBlock(cost)
    expect(result).toBe("<cost-context>monthly-cost=750</cost-context>")
  })
})

describe("cost context integration", () => {
  it("injects cost context block when console token is configured", async () => {
    globalThis.fetch = createMockFetch([
      { method: "POST", path: "/auth/realms/redhat-external", status: 200, body: { access_token: "test-token", expires_in: 3600 } },
      { method: "GET", path: "/reports/openshift/costs/", status: 200, body: mockCostReport },
    ])

    const shell = createConnectedShell()
    const hooks = await loadPlugin(shell, { consoleOfflineToken: "my-token" })

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output)

    expect(output.system.length).toBe(2)
    expect(output.system[0]).toContain("<cluster-context>")
    expect(output.system[1]).toContain("<cost-context>")
    expect(output.system[1]).toContain("monthly-cost=$847")
  })

  it("skips cost context when no console token is provided", async () => {
    const shell = createConnectedShell()
    const hooks = await loadPlugin(shell, undefined)

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output)

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toContain("<cluster-context>")
    expect(output.system[0]).not.toContain("<cost-context>")
  })

  it("does not crash when cost API fails with console token configured", async () => {
    globalThis.fetch = createMockFetch([
      { method: "POST", path: "/auth/realms/redhat-external", status: 200, body: { access_token: "test-token", expires_in: 3600 } },
      { method: "GET", path: "/reports/openshift/costs/", status: 500, body: { error: "fail" } },
    ])

    const shell = createConnectedShell()
    const hooks = await loadPlugin(shell, { consoleOfflineToken: "my-token" })

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output)

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toContain("<cluster-context>")
  })
})
