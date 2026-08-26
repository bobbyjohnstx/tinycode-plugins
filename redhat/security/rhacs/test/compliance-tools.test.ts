import { describe, it, expect, afterEach } from "bun:test"
import { createMockInput, createMockFetch } from "tinycode-plugin-redhat-shared/test-utils"
import type { MockRoute } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const centralUrl = "https://central.example.com"
const apiToken = "test-token"
const configuredOptions = { centralUrl, apiToken }

function setupFetch(routes: MockRoute[]) {
  globalThis.fetch = createMockFetch(routes)
}

async function getTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

describe("tinycode-plugin-rhacs compliance", () => {
  describe("plugin loading", () => {
    it("registers compliance tools when configured", async () => {
      setupFetch([])
      const tools = await getTools(configuredOptions)
      expect(tools.rhacs_compliance_scan).toBeDefined()
      expect(tools.rhacs_compliance_status).toBeDefined()
    })

    it("registers compliance tools when unconfigured", async () => {
      const tools = await getTools(undefined)
      expect(tools.rhacs_compliance_scan).toBeDefined()
      expect(tools.rhacs_compliance_status).toBeDefined()
    })

    it("unconfigured rhacs_compliance_scan returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhacs_compliance_scan.execute({}, {} as never)
      expect(result).toContain("not configured")
    })

    it("unconfigured rhacs_compliance_status returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhacs_compliance_status.execute({}, {} as never)
      expect(result).toContain("not configured")
    })
  })

  describe("rhacs_compliance_scan", () => {
    it("lists available scan results when no scanConfigId provided", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/v2/compliance/results",
          body: {
            results: [
              {
                scanConfigId: "config-1",
                profiles: [
                  { profileName: "CIS Kubernetes", passing: 140, failing: 10, errors: 2 },
                ],
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_compliance_scan.execute({}, {} as never)
      expect(result).toContain("Available compliance scan results")
      expect(result).toContain("config-1")
      expect(result).toContain("CIS Kubernetes")
      expect(result).toContain("140/152 passing")
    })

    it("returns no-results message when no scan results exist", async () => {
      setupFetch([
        { method: "GET", path: "/v2/compliance/results", body: { results: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_compliance_scan.execute({}, {} as never)
      expect(result).toContain("No compliance scan results available")
    })

    it("triggers scan and returns results when scanConfigId provided", async () => {
      setupFetch([
        {
          method: "POST",
          path: "/v2/compliance/scan/configurations/config-1/run",
          body: {},
        },
        {
          method: "GET",
          path: "/v2/compliance/results",
          body: {
            results: [
              {
                scanConfigId: "config-1",
                profiles: [
                  {
                    profileName: "CIS Kubernetes Benchmark v1.6",
                    passing: 142,
                    failing: 14,
                    errors: 0,
                    controls: [
                      {
                        name: "1.2.6 Ensure API server audit log path is set",
                        status: "FAIL",
                        severity: "CRITICAL",
                        remediation: "Set --audit-log-path=<path> on kube-apiserver",
                      },
                      {
                        name: "5.1.3 Minimize wildcard use in Roles",
                        status: "FAIL",
                        severity: "HIGH",
                        remediation: "Replace wildcards with specific resources",
                      },
                      {
                        name: "4.2.1 Restrict kubelet read-only port",
                        status: "PASS",
                        severity: "MEDIUM",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_compliance_scan.execute({ scanConfigId: "config-1" }, {} as never)
      expect(result).toContain("CIS Kubernetes Benchmark v1.6")
      expect(result).toContain("142/156 (91%)")
      expect(result).toContain("Failing: 14")
      expect(result).toContain("[CRITICAL] 1.2.6 Ensure API server audit log path is set")
      expect(result).toContain("Remediation: Set --audit-log-path=<path> on kube-apiserver")
      expect(result).toContain("[HIGH] 5.1.3 Minimize wildcard use in Roles")
      expect(result).not.toContain("4.2.1 Restrict kubelet read-only port")
    })

    it("returns pending message when scan triggered but no results yet", async () => {
      setupFetch([
        {
          method: "POST",
          path: "/v2/compliance/scan/configurations/config-new/run",
          body: {},
        },
        {
          method: "GET",
          path: "/v2/compliance/results",
          body: { results: [] },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_compliance_scan.execute({ scanConfigId: "config-new" }, {} as never)
      expect(result).toContain("Scan triggered for config config-new")
      expect(result).toContain("no results available yet")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/v2/compliance/results", status: 500, body: { error: "Internal error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_compliance_scan.execute({}, {} as never)
      expect(result).toContain("Failed to run compliance scan")
      expect(result).toContain("500")
    })

    it("sorts failing controls by severity (CRITICAL before HIGH before LOW)", async () => {
      setupFetch([
        {
          method: "POST",
          path: "/v2/compliance/scan/configurations/config-sort/run",
          body: {},
        },
        {
          method: "GET",
          path: "/v2/compliance/results",
          body: {
            results: [
              {
                scanConfigId: "config-sort",
                profiles: [
                  {
                    profileName: "Test Profile",
                    passing: 10,
                    failing: 3,
                    errors: 0,
                    controls: [
                      { name: "ctrl-low", status: "FAIL", severity: "LOW" },
                      { name: "ctrl-critical", status: "FAIL", severity: "CRITICAL" },
                      { name: "ctrl-high", status: "FAIL", severity: "HIGH" },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_compliance_scan.execute({ scanConfigId: "config-sort" }, {} as never) as string
      const critIdx = result.indexOf("ctrl-critical")
      const highIdx = result.indexOf("ctrl-high")
      const lowIdx = result.indexOf("ctrl-low")
      expect(critIdx).toBeLessThan(highIdx)
      expect(highIdx).toBeLessThan(lowIdx)
    })
  })

  describe("rhacs_compliance_status", () => {
    it("returns compliance summary for all profiles", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/v2/compliance/profiles",
          body: {
            profiles: [
              {
                id: "p1",
                name: "CIS Kubernetes Benchmark",
                totalControls: 156,
                passingControls: 142,
                failingControls: 14,
              },
              {
                id: "p2",
                name: "NIST SP 800-53",
                totalControls: 200,
                passingControls: 200,
                failingControls: 0,
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_compliance_status.execute({}, {} as never)
      expect(result).toContain("Compliance Status Summary")
      expect(result).toContain("CIS Kubernetes Benchmark")
      expect(result).toContain("91%")
      expect(result).toContain("FAIL")
      expect(result).toContain("NIST SP 800-53")
      expect(result).toContain("100%")
      expect(result).toContain("PASS")
    })

    it("returns no-profiles message when none exist", async () => {
      setupFetch([
        { method: "GET", path: "/v2/compliance/profiles", body: { profiles: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_compliance_status.execute({}, {} as never)
      expect(result).toContain("No compliance profiles found")
    })

    it("filters by profileName when provided", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/v2/compliance/profiles",
          body: {
            profiles: [
              { id: "p1", name: "CIS Benchmark", totalControls: 100, passingControls: 90 },
              { id: "p2", name: "NIST 800-53", totalControls: 200, passingControls: 180 },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_compliance_status.execute({ profileName: "CIS Benchmark" }, {} as never)
      expect(result).toContain("CIS Benchmark")
      expect(result).not.toContain("NIST 800-53")
    })

    it("returns not-found message when profileName filter matches nothing", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/v2/compliance/profiles",
          body: {
            profiles: [
              { id: "p1", name: "CIS Benchmark", totalControls: 100, passingControls: 90 },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_compliance_status.execute({ profileName: "Nonexistent" }, {} as never)
      expect(result).toContain('No compliance profile found matching "Nonexistent"')
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/v2/compliance/profiles", status: 500, body: { error: "error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_compliance_status.execute({}, {} as never)
      expect(result).toContain("Failed to get compliance status")
    })
  })
})
