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
                  rule_id: "etcd_encryption|ETCD_ENCRYPT_001",
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
                  rule_id: "deprecated_api|DEPRECATED_API_002",
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
      // Verify rule_id is present
      expect(result).toContain("etcd_encryption|ETCD_ENCRYPT_001")
      expect(result).toContain("deprecated_api|DEPRECATED_API_002")
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
                  rule_id: "critical_finding|CRIT_001",
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
      expect(result).toContain("critical_finding|CRIT_001")
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
          path: `/clusters/${configuredOptions.clusterId}/cves`,
          body: {
            data: [
              {
                synopsis: "CVE-2024-5678",
                description: "Another CVE description",
                severity: "Important",
                cvss2_score: 0,
                cvss3_score: 7.5,
                publish_date: "2024-02-20",
                exploits: false,
              },
              {
                synopsis: "CVE-2024-1234",
                description: "Description of the CVE",
                severity: "Critical",
                cvss2_score: 0,
                cvss3_score: 9.8,
                publish_date: "2024-01-15",
                exploits: true,
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
      expect(result).toContain("CVE-2024-1234 [Critical] CVSS 9.8")
      expect(result).toContain("Known Exploit")
      expect(result).toContain("CVE-2024-5678 [Important] CVSS 7.5")
      expect(result).toContain("Published: 2024-01-15")
      expect(result).toContain("Description of the CVE")
      // Verify sorted: Critical before Important
      const criticalIdx = result.indexOf("CVE-2024-1234")
      const importantIdx = result.indexOf("CVE-2024-5678")
      expect(criticalIdx).toBeLessThan(importantIdx)
    })

    it("returns empty message when no CVEs found", async () => {
      setupFetch([
        {
          method: "GET",
          path: `/clusters/${configuredOptions.clusterId}/cves`,
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
          path: /clusters\/.*\/cves.*severity=critical/,
          body: {
            data: [
              {
                synopsis: "CVE-2024-9999",
                description: "Critical vuln",
                severity: "Critical",
                cvss2_score: 0,
                cvss3_score: 9.1,
                publish_date: "2024-03-01",
                exploits: false,
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
      expect(result).toContain("CVSS 9.1")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: `/clusters/${configuredOptions.clusterId}/cves`,
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
