import { describe, it, expect } from "bun:test"
import {
  createMockShell,
  createMockInput,
} from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const mockClustersData = {
  items: [
    {
      metadata: {
        name: "cluster-east",
        labels: { cloud: "AWS", env: "production" },
      },
      status: {
        conditions: [
          { type: "ManagedClusterConditionAvailable", status: "True" },
        ],
        version: { kubernetes: "1.28.6" },
      },
    },
    {
      metadata: {
        name: "cluster-west",
        labels: { cloud: "GCP", env: "staging" },
      },
      status: {
        conditions: [
          { type: "ManagedClusterConditionAvailable", status: "False" },
        ],
        version: { kubernetes: "1.27.4" },
      },
    },
  ],
}

const mockAddonsData = {
  items: [
    {
      metadata: { name: "application-manager" },
      status: {
        conditions: [{ type: "Available", status: "True" }],
      },
    },
    {
      metadata: { name: "governance-policy-framework" },
      status: {
        conditions: [{ type: "Available", status: "False" }],
      },
    },
  ],
}

const mockPoliciesData = {
  items: [
    {
      metadata: { name: "require-labels", namespace: "policies" },
      spec: { severity: "medium" },
      status: { compliant: "Compliant" },
    },
    {
      metadata: { name: "limit-ranges", namespace: "policies" },
      spec: { severity: "high" },
      status: {
        compliant: "NonCompliant",
        status: [
          { clustername: "cluster-east", compliant: "NonCompliant" },
          { clustername: "cluster-west", compliant: "Compliant" },
        ],
        details: [
          {
            templateMeta: { name: "limit-ranges" },
            history: [{ message: "LimitRange not found in namespace default" }],
          },
        ],
      },
    },
  ],
}

const mockAppsData = {
  items: [
    {
      metadata: { name: "frontend", namespace: "argocd" },
      spec: { destination: { name: "cluster-east" } },
      status: { sync: { status: "Synced" } },
    },
    {
      metadata: { name: "backend", namespace: "argocd" },
      spec: { destination: { name: "cluster-west" } },
      status: { sync: { status: "OutOfSync" } },
    },
  ],
}

describe("tinycode-plugin-rhacm", () => {
  it("loads without error", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks).toBeDefined()
  })

  it("registers all seven tools", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks.tool).toBeDefined()
    const toolNames = Object.keys(hooks.tool!)
    expect(toolNames).toContain("acm_clusters")
    expect(toolNames).toContain("acm_cluster_detail")
    expect(toolNames).toContain("acm_policies")
    expect(toolNames).toContain("acm_violations")
    expect(toolNames).toContain("acm_applications")
    expect(toolNames).toContain("acm_app_deploy")
    expect(toolNames).toContain("acm_observability")
    expect(toolNames).toHaveLength(7)
  })

  it("all tools have descriptions", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    for (const [, tool] of Object.entries(hooks.tool!)) {
      expect(tool.description).toBeTruthy()
      expect(typeof tool.description).toBe("string")
    }
  })

  describe("acm_clusters", () => {
    it("lists managed clusters", async () => {
      const shell = createMockShell([
        {
          match: "oc get managedclusters",
          output: JSON.stringify(mockClustersData),
          json: mockClustersData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_clusters!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("cluster-east")
      expect(result).toContain("cluster-west")
      expect(result).toContain("Ready")
      expect(result).toContain("NotReady")
      expect(result).toContain("AWS")
      expect(result).toContain("GCP")
    })

    it("filters by status", async () => {
      const shell = createMockShell([
        {
          match: "oc get managedclusters",
          output: JSON.stringify(mockClustersData),
          json: mockClustersData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_clusters!.execute(
        { status: "Ready" },
        undefined as any,
      )
      expect(result).toContain("cluster-east")
      expect(result).not.toContain("cluster-west")
    })

    it("returns error on failure", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_clusters!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Error listing clusters")
    })
  })

  describe("acm_cluster_detail", () => {
    it("returns cluster detail with addons", async () => {
      const singleCluster = {
        metadata: {
          name: "cluster-east",
          labels: { cloud: "AWS" },
        },
        status: {
          conditions: [
            { type: "ManagedClusterConditionAvailable", status: "True" },
          ],
          version: { kubernetes: "1.28.6" },
        },
      }
      const shell = createMockShell([
        {
          match: "oc get managedcluster/cluster-east",
          output: JSON.stringify(singleCluster),
          json: singleCluster,
        },
        {
          match: "oc get managedclusteraddons",
          output: JSON.stringify(mockAddonsData),
          json: mockAddonsData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_cluster_detail!.execute(
        { name: "cluster-east" },
        undefined as any,
      )
      expect(result).toContain("cluster-east")
      expect(result).toContain("application-manager")
      expect(result).toContain("Available")
      expect(result).toContain("governance-policy-framework")
      expect(result).toContain("Unavailable")
    })

    it("returns error for missing cluster", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_cluster_detail!.execute(
        { name: "nonexistent" },
        undefined as any,
      )
      expect(result).toContain("Error getting cluster detail")
    })
  })

  describe("acm_policies", () => {
    it("lists governance policies", async () => {
      const shell = createMockShell([
        {
          match: "oc get policies.policy.open-cluster-management.io",
          output: JSON.stringify(mockPoliciesData),
          json: mockPoliciesData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_policies!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("require-labels")
      expect(result).toContain("limit-ranges")
      expect(result).toContain("Compliant")
      expect(result).toContain("NonCompliant")
    })

    it("returns empty when no policies", async () => {
      const emptyPolicies = { items: [] }
      const shell = createMockShell([
        {
          match: "oc get policies.policy.open-cluster-management.io",
          output: JSON.stringify(emptyPolicies),
          json: emptyPolicies,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_policies!.execute(
        {},
        undefined as any,
      )
      expect(result).toBe("No governance policies found.")
    })
  })

  describe("acm_violations", () => {
    it("lists violations grouped by cluster", async () => {
      const shell = createMockShell([
        {
          match: "oc get policies.policy.open-cluster-management.io",
          output: JSON.stringify(mockPoliciesData),
          json: mockPoliciesData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_violations!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("limit-ranges")
      expect(result).toContain("cluster-east")
      expect(result).toContain("LimitRange not found")
    })

    it("filters by cluster", async () => {
      const shell = createMockShell([
        {
          match: "oc get policies.policy.open-cluster-management.io",
          output: JSON.stringify(mockPoliciesData),
          json: mockPoliciesData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_violations!.execute(
        { cluster: "cluster-west" },
        undefined as any,
      )
      expect(result).toBe("No active policy violations.")
    })

    it("returns no violations message", async () => {
      const compliantPolicies = {
        items: [
          {
            metadata: { name: "all-good", namespace: "policies" },
            spec: { severity: "low" },
            status: { compliant: "Compliant" },
          },
        ],
      }
      const shell = createMockShell([
        {
          match: "oc get policies.policy.open-cluster-management.io",
          output: JSON.stringify(compliantPolicies),
          json: compliantPolicies,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_violations!.execute(
        {},
        undefined as any,
      )
      expect(result).toBe("No active policy violations.")
    })
  })

  describe("acm_applications", () => {
    it("lists applications", async () => {
      const shell = createMockShell([
        {
          match: "oc get applications.argoproj.io",
          output: JSON.stringify(mockAppsData),
          json: mockAppsData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_applications!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("frontend")
      expect(result).toContain("backend")
      expect(result).toContain("Synced")
      expect(result).toContain("OutOfSync")
    })

    it("returns empty when no apps", async () => {
      const emptyApps = { items: [] }
      const shell = createMockShell([
        {
          match: "oc get applications.argoproj.io",
          output: JSON.stringify(emptyApps),
          json: emptyApps,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_applications!.execute(
        {},
        undefined as any,
      )
      expect(result).toBe("No ACM-managed applications found.")
    })
  })

  describe("acm_app_deploy", () => {
    it("deploys after permission", async () => {
      const yaml = "apiVersion: v1\nkind: Application\nmetadata:\n  name: test"
      const shell = createMockShell([
        { match: "oc apply", output: "application/test created" },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const mockCtx = {
        ask: async () => {},
      }
      const result = await hooks.tool!.acm_app_deploy!.execute(
        { yaml },
        mockCtx as any,
      )
      expect(result).toContain("application/test created")
    })

    it("returns error on permission denied", async () => {
      const yaml = "apiVersion: v1\nkind: Application"
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const mockCtx = {
        ask: async () => {
          throw new Error("User denied permission")
        },
      }
      const result = await hooks.tool!.acm_app_deploy!.execute(
        { yaml },
        mockCtx as any,
      )
      expect(result).toContain("Error deploying application")
      expect(result).toContain("User denied permission")
    })
  })

  describe("acm_observability", () => {
    it("runs PromQL query when configured", async () => {
      const promqlResult = {
        resultType: "vector",
        result: [
          { metric: { __name__: "up" }, value: [1700000000, "1"] },
        ],
      }
      const mockFetchFn = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ status: "success", data: promqlResult }),
            { status: 200 },
          ),
        )) as unknown as typeof fetch

      const originalFetch = globalThis.fetch
      globalThis.fetch = mockFetchFn
      try {
        const shell = createMockShell([])
        const input = createMockInput(shell)
        const hooks = await plugin.server(input, {
          thanosUrl: "https://thanos.example.com",
          token: "test-token",
        })
        const result = await hooks.tool!.acm_observability!.execute(
          { query: "up" },
          undefined as any,
        )
        expect(result).toContain("vector")
        expect(result).toContain("up")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it("returns not configured when thanosUrl missing", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.acm_observability!.execute(
        { query: "up" },
        undefined as any,
      )
      expect(result).toContain("ACM observability not configured")
    })
  })

  describe("system prompt", () => {
    it("injects ACM context into system prompt", async () => {
      const shell = createMockShell([
        {
          match: "oc get managedclusters",
          output: JSON.stringify(mockClustersData),
          json: mockClustersData,
        },
        {
          match: "oc get policies.policy.open-cluster-management.io",
          output: JSON.stringify(mockPoliciesData),
          json: mockPoliciesData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)

      const output = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]!(
        { model: {} as never },
        output,
      )

      expect(output.system.length).toBe(1)
      expect(output.system[0]).toContain("<acm-context>")
      expect(output.system[0]).toContain("clusters: 2 (1 ready)")
      expect(output.system[0]).toContain("violations: 1")
      expect(output.system[0]).toContain("</acm-context>")
    })

    it("handles ACM unavailable gracefully", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)

      const output = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]!(
        { model: {} as never },
        output,
      )

      expect(output.system.length).toBe(1)
      expect(output.system[0]).toContain("ACM hub unavailable")
    })
  })
})
