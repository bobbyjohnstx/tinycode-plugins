import { describe, it, expect, afterEach } from "bun:test"
import {
  createMockInput,
  createMockFetch,
} from "tinycode-plugin-redhat-shared/test-utils"
import type { MockRoute } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const configuredOptions = {
  consoleOfflineToken: "test-offline-token",
  clusterId: "cluster-uuid-1234",
}

function setupFetch(routes: MockRoute[]) {
  globalThis.fetch = createMockFetch([
    {
      method: "POST",
      path: "/auth/realms/redhat-external/protocol/openid-connect/token",
      body: { access_token: "mock-access-token", expires_in: 900 },
    },
    ...routes,
  ])
}

async function getTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

describe("insights-tools", () => {
  describe("plugin loading", () => {
    it("registers insights tools when configured", async () => {
      setupFetch([])
      const tools = await getTools(configuredOptions)
      expect(tools.ocp_insights_recommendations).toBeDefined()
      expect(tools.ocp_insights_cves).toBeDefined()
    })

    it("registers unconfigured stubs when no token provided", async () => {
      const tools = await getTools(undefined)
      expect(tools.ocp_insights_recommendations).toBeDefined()
      expect(tools.ocp_insights_cves).toBeDefined()
    })

    it("registers unconfigured stubs when only token provided without clusterId", async () => {
      const tools = await getTools({ consoleOfflineToken: "token-only" })
      expect(tools.ocp_insights_recommendations).toBeDefined()
      expect(tools.ocp_insights_cves).toBeDefined()
    })
  })

  describe("unconfigured tools", () => {
    it("ocp_insights_recommendations returns config-needed message", async () => {
      const tools = await getTools(undefined)
      const result = await tools.ocp_insights_recommendations.execute(
        {},
        {} as never,
      )
      expect(result).toContain("Insights not configured")
      expect(result).toContain("consoleOfflineToken")
      expect(result).toContain("clusterId")
    })

    it("ocp_insights_cves returns config-needed message", async () => {
      const tools = await getTools(undefined)
      const result = await tools.ocp_insights_cves.execute({}, {} as never)
      expect(result).toContain("Insights not configured")
      expect(result).toContain("consoleOfflineToken")
      expect(result).toContain("clusterId")
    })
  })

  describe("ocp_insights_recommendations", () => {
    it("returns formatted recommendations sorted by risk", async () => {
      setupFetch([
        {
          method: "GET",
          path: `/system/${configuredOptions.clusterId}/reports/`,
          body: {
            data: [
              {
                rule: {
                  description: "etcd encryption is not enabled",
                  total_risk: 3,
                  category: { name: "Secrets stored unencrypted in etcd" },
                  resolution_set: [
                    {
                      resolution:
                        "Enable etcd encryption via API server configuration",
                    },
                  ],
                },
              },
              {
                rule: {
                  description: "Cluster has deprecated API resources",
                  total_risk: 4,
                  category: {
                    name: "API deprecations may break workloads after upgrade",
                  },
                  resolution_set: [
                    {
                      resolution:
                        "Review and migrate deprecated APIs before upgrading",
                    },
                  ],
                },
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = (await tools.ocp_insights_recommendations.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("Insights Advisor Recommendations: 2")
      expect(result).toContain("[Critical, Risk 4]")
      expect(result).toContain("Cluster has deprecated API resources")
      expect(result).toContain("[Important, Risk 3]")
      expect(result).toContain("etcd encryption is not enabled")
      // Verify sorted: Critical before Important
      const criticalIdx = result.indexOf("Critical, Risk 4")
      const importantIdx = result.indexOf("Important, Risk 3")
      expect(criticalIdx).toBeLessThan(importantIdx)
    })

    it("returns empty message when no recommendations exist", async () => {
      setupFetch([
        {
          method: "GET",
          path: `/system/${configuredOptions.clusterId}/reports/`,
          body: { data: [] },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.ocp_insights_recommendations.execute(
        {},
        {} as never,
      )
      expect(result).toContain("No Insights Advisor recommendations found")
    })

    it("passes risk level filter as query parameter", async () => {
      setupFetch([
        {
          method: "GET",
          path: /system\/.*\/reports\/.*total_risk=4/,
          body: {
            data: [
              {
                rule: {
                  description: "Critical finding",
                  total_risk: 4,
                  resolution_set: [{ resolution: "Fix it" }],
                },
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.ocp_insights_recommendations.execute(
        { riskLevel: "critical" },
        {} as never,
      )
      expect(result).toContain("Critical finding")
      expect(result).toContain("[Critical, Risk 4]")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: `/system/${configuredOptions.clusterId}/reports/`,
          status: 500,
          body: { error: "Internal server error" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.ocp_insights_recommendations.execute(
        {},
        {} as never,
      )
      expect(result).toContain("Failed to get recommendations")
      expect(result).toContain("500")
    })
  })

  describe("ocp_insights_cves", () => {
    it("returns formatted CVEs sorted by severity", async () => {
      setupFetch([
        {
          method: "GET",
          path: `/systems/${configuredOptions.clusterId}/cves`,
          body: {
            data: [
              {
                id: "CVE-2024-5678",
                synopsis: "Another CVE description",
                severity: 3,
                public_date: "2024-02-20T00:00:00Z",
                advisories_list: ["RHSA-2024:0042"],
              },
              {
                id: "CVE-2024-1234",
                synopsis: "Description of the CVE",
                severity: 4,
                public_date: "2024-01-15T00:00:00Z",
                advisories_list: ["RHSA-2024:0001"],
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = (await tools.ocp_insights_cves.execute(
        {},
        {} as never,
      )) as string
      expect(result).toContain("CVE Exposure: 2 CVEs")
      expect(result).toContain("CVE-2024-1234 [Critical]")
      expect(result).toContain("CVE-2024-5678 [Important]")
      expect(result).toContain("Published: 2024-01-15")
      expect(result).toContain("Advisory: RHSA-2024:0001")
      // Verify sorted: Critical before Important
      const criticalIdx = result.indexOf("CVE-2024-1234")
      const importantIdx = result.indexOf("CVE-2024-5678")
      expect(criticalIdx).toBeLessThan(importantIdx)
    })

    it("returns empty message when no CVEs found", async () => {
      setupFetch([
        {
          method: "GET",
          path: `/systems/${configuredOptions.clusterId}/cves`,
          body: { data: [] },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.ocp_insights_cves.execute({}, {} as never)
      expect(result).toContain("No CVEs found for this cluster")
    })

    it("passes severity filter as query parameter", async () => {
      setupFetch([
        {
          method: "GET",
          path: /systems\/.*\/cves.*cvss_severity=critical/,
          body: {
            data: [
              {
                id: "CVE-2024-9999",
                synopsis: "Critical vuln",
                severity: 4,
                public_date: "2024-03-01T00:00:00Z",
                advisories_list: ["RHSA-2024:0099"],
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.ocp_insights_cves.execute(
        { severity: "critical" },
        {} as never,
      )
      expect(result).toContain("CVE-2024-9999")
      expect(result).toContain("[Critical]")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: `/systems/${configuredOptions.clusterId}/cves`,
          status: 500,
          body: { error: "Server error" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.ocp_insights_cves.execute({}, {} as never)
      expect(result).toContain("Failed to get CVEs")
      expect(result).toContain("500")
    })
  })
})
