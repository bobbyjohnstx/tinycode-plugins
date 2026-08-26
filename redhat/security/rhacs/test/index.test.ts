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

describe("tinycode-plugin-rhacs", () => {
  describe("plugin loading", () => {
    it("loads without options and returns tools", async () => {
      const tools = await getTools(undefined)
      expect(tools).toBeDefined()
      expect(tools.rhacs_image_scan).toBeDefined()
      expect(tools.rhacs_image_check).toBeDefined()
      expect(tools.rhacs_deployment_check).toBeDefined()
      expect(tools.rhacs_violations).toBeDefined()
      expect(tools.rhacs_risk).toBeDefined()
    })

    it("returns config-needed message when no options provided", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhacs_image_scan.execute({ image: "nginx:latest" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("returns config-needed message when centralUrl missing", async () => {
      const tools = await getTools({ apiToken: "token" })
      const result = await tools.rhacs_image_scan.execute({ image: "nginx:latest" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("returns config-needed message when apiToken missing", async () => {
      const tools = await getTools({ centralUrl: "https://central.example.com" })
      const result = await tools.rhacs_image_scan.execute({ image: "nginx:latest" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("loads with valid options and returns configured tools", async () => {
      setupFetch([
        { method: "POST", path: "/v1/images/scan", body: { components: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_image_scan.execute({ image: "nginx:latest" }, {} as never)
      expect(result).not.toContain("not configured")
    })
  })

  describe("rhacs_image_scan", () => {
    it("returns formatted vulnerability list on success", async () => {
      setupFetch([
        {
          method: "POST",
          path: "/v1/images/scan",
          body: {
            image: { name: { fullName: "nginx:1.25" } },
            components: [
              {
                name: "openssl",
                version: "1.1.1",
                vulns: [
                  {
                    cve: "CVE-2023-0001",
                    severity: "CRITICAL_SEVERITY",
                    cvss: 9.8,
                    fixedBy: "1.1.2",
                  },
                  {
                    cve: "CVE-2023-0002",
                    severity: "LOW_SEVERITY",
                    cvss: 2.1,
                    fixedBy: "",
                  },
                ],
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_image_scan.execute({ image: "nginx:1.25" }, {} as never)
      expect(result).toContain("nginx:1.25")
      expect(result).toContain("CVE-2023-0001")
      expect(result).toContain("CRITICAL_SEVERITY")
      expect(result).toContain("9.8")
      expect(result).toContain("openssl@1.1.1")
      expect(result).toContain("Fix: 1.1.2")
      expect(result).toContain("Vulnerabilities found: 2")
    })

    it("returns no-vulnerabilities message when scan is clean", async () => {
      setupFetch([
        {
          method: "POST",
          path: "/v1/images/scan",
          body: { image: { name: { fullName: "nginx:latest" } }, components: [] },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_image_scan.execute({ image: "nginx:latest" }, {} as never)
      expect(result).toContain("No vulnerabilities found")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "POST", path: "/v1/images/scan", status: 500, body: { error: "Internal error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_image_scan.execute({ image: "bad:image" }, {} as never)
      expect(result).toContain("Failed to scan image")
      expect(result).toContain("500")
    })

    it("sorts vulnerabilities by CVSS score descending", async () => {
      setupFetch([
        {
          method: "POST",
          path: "/v1/images/scan",
          body: {
            image: { name: { fullName: "test:latest" } },
            components: [
              {
                name: "lib-a",
                version: "1.0",
                vulns: [{ cve: "CVE-LOW", severity: "LOW_SEVERITY", cvss: 2.0 }],
              },
              {
                name: "lib-b",
                version: "2.0",
                vulns: [{ cve: "CVE-HIGH", severity: "CRITICAL_SEVERITY", cvss: 9.5 }],
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_image_scan.execute({ image: "test:latest" }, {} as never)
      const highIdx = result.indexOf("CVE-HIGH")
      const lowIdx = result.indexOf("CVE-LOW")
      expect(highIdx).toBeLessThan(lowIdx)
    })
  })

  describe("rhacs_image_check", () => {
    it("returns pass message when no policy violations", async () => {
      setupFetch([
        { method: "POST", path: "/v1/images/check", body: { alerts: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_image_check.execute({ image: "nginx:latest" }, {} as never)
      expect(result).toContain("passed all deploy-time policy checks")
    })

    it("returns violated policies on failure", async () => {
      setupFetch([
        {
          method: "POST",
          path: "/v1/images/check",
          body: {
            alerts: [
              {
                policy: {
                  name: "No root user",
                  severity: "HIGH_SEVERITY",
                  description: "Container runs as root",
                },
              },
              {
                policy: {
                  name: "Image age",
                  severity: "MEDIUM_SEVERITY",
                  description: "Image is older than 90 days",
                },
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_image_check.execute({ image: "old-image:v1" }, {} as never)
      expect(result).toContain("FAILED policy checks")
      expect(result).toContain("No root user")
      expect(result).toContain("HIGH_SEVERITY")
      expect(result).toContain("Image age")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "POST", path: "/v1/images/check", status: 403, body: { error: "Forbidden" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_image_check.execute({ image: "test:v1" }, {} as never)
      expect(result).toContain("Failed to check image")
    })
  })

  describe("rhacs_deployment_check", () => {
    it("returns pass message when deployment complies", async () => {
      setupFetch([
        { method: "POST", path: "/v1/deploymentcheck", body: { alerts: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_deployment_check.execute(
        { yaml: "apiVersion: apps/v1\nkind: Deployment" },
        {} as never,
      )
      expect(result).toContain("passed all policy checks")
    })

    it("returns violations when deployment fails checks", async () => {
      setupFetch([
        {
          method: "POST",
          path: "/v1/deploymentcheck",
          body: {
            alerts: [
              {
                policy: {
                  name: "Privileged Container",
                  severity: "CRITICAL_SEVERITY",
                  description: "Container is running in privileged mode",
                },
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_deployment_check.execute(
        { yaml: "apiVersion: apps/v1\nkind: Deployment" },
        {} as never,
      )
      expect(result).toContain("FAILED policy checks")
      expect(result).toContain("Privileged Container")
      expect(result).toContain("CRITICAL_SEVERITY")
      expect(result).toContain("1 violation")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "POST", path: "/v1/deploymentcheck", status: 400, body: { error: "Bad request" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_deployment_check.execute(
        { yaml: "invalid yaml" },
        {} as never,
      )
      expect(result).toContain("Failed to check deployment")
    })
  })

  describe("rhacs_violations", () => {
    it("returns formatted violation list", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/v1/alerts",
          body: {
            alerts: [
              {
                id: "alert-1",
                policy: { name: "CVE Fixable", severity: "HIGH_SEVERITY" },
                deployment: { name: "web-app", namespace: "production", clusterName: "prod-1" },
                state: "ACTIVE",
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_violations.execute({}, {} as never)
      expect(result).toContain("Active violations: 1")
      expect(result).toContain("CVE Fixable")
      expect(result).toContain("production/web-app")
      expect(result).toContain("ACTIVE")
    })

    it("returns no-violations message when none exist", async () => {
      setupFetch([
        { method: "GET", path: "/v1/alerts", body: { alerts: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_violations.execute({}, {} as never)
      expect(result).toContain("No active violations found")
    })

    it("passes namespace filter in query", async () => {
      const requests: string[] = []
      const mock = createMockFetch([
        { method: "GET", path: "/v1/alerts", body: { alerts: [] } },
      ])
      globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        requests.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)
        return mock(input, init)
      }) as typeof fetch

      const tools = await getTools(configuredOptions)
      await tools.rhacs_violations.execute({ namespace: "kube-system" }, {} as never)
      expect(requests[0]).toContain("Namespace%3Akube-system")
    })

    it("passes severity filter in query", async () => {
      const requests: string[] = []
      const mock = createMockFetch([
        { method: "GET", path: "/v1/alerts", body: { alerts: [] } },
      ])
      globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        requests.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)
        return mock(input, init)
      }) as typeof fetch

      const tools = await getTools(configuredOptions)
      await tools.rhacs_violations.execute({ severity: "CRITICAL_SEVERITY" }, {} as never)
      expect(requests[0]).toContain("Severity%3ACRITICAL_SEVERITY")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/v1/alerts", status: 500, body: { error: "error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_violations.execute({}, {} as never)
      expect(result).toContain("Failed to list violations")
    })
  })

  describe("rhacs_risk", () => {
    it("returns risk score and factors", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/v1/deployments/dep-123/risk",
          body: {
            subject: { id: "dep-123", name: "api-server", namespace: "default" },
            score: 7.5,
            results: [
              {
                name: "Image Vulnerabilities",
                factors: [
                  { message: "Contains 5 critical CVEs" },
                  { message: "Image not scanned in 30 days" },
                ],
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_risk.execute({ deploymentId: "dep-123" }, {} as never)
      expect(result).toContain("default/api-server")
      expect(result).toContain("Risk Score: 7.5")
      expect(result).toContain("Image Vulnerabilities")
      expect(result).toContain("Contains 5 critical CVEs")
    })

    it("returns no risk factors message when none exist", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/v1/deployments/dep-456/risk",
          body: {
            subject: { id: "dep-456", name: "static-site", namespace: "web" },
            score: 0,
            results: [],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_risk.execute({ deploymentId: "dep-456" }, {} as never)
      expect(result).toContain("Risk Score: 0")
      expect(result).toContain("No risk factors identified")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/v1/deployments/bad-id/risk", status: 404, body: { error: "not found" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhacs_risk.execute({ deploymentId: "bad-id" }, {} as never)
      expect(result).toContain("Failed to get risk")
    })
  })

  describe("unconfigured tools return config message for all tools", () => {
    it("rhacs_image_check returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhacs_image_check.execute({ image: "test" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("rhacs_deployment_check returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhacs_deployment_check.execute({ yaml: "test" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("rhacs_violations returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhacs_violations.execute({}, {} as never)
      expect(result).toContain("not configured")
    })

    it("rhacs_risk returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhacs_risk.execute({ deploymentId: "test" }, {} as never)
      expect(result).toContain("not configured")
    })
  })
})
