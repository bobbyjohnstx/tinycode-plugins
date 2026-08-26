import { describe, it, expect, afterEach } from "bun:test"
import { createMockInput, createMockFetch } from "tinycode-plugin-redhat-shared/test-utils"
import type { MockRoute } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const controllerUrl = "https://controller.example.com"
const oauthToken = "test-token"
const configuredOptions = { controllerUrl, oauthToken }

function setupFetch(routes: MockRoute[]) {
  globalThis.fetch = createMockFetch(routes)
}

async function getTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

async function getHooks(options?: Record<string, unknown>) {
  const input = createMockInput()
  return plugin.server(input, options)
}

describe("tinycode-plugin-aap-bridge", () => {
  describe("plugin loading", () => {
    it("loads without options and returns tools", async () => {
      const tools = await getTools(undefined)
      expect(tools).toBeDefined()
      expect(tools.aap_list_templates).toBeDefined()
      expect(tools.aap_launch_job).toBeDefined()
      expect(tools.aap_job_status).toBeDefined()
      expect(tools.aap_job_output).toBeDefined()
      expect(tools.aap_list_inventories).toBeDefined()
      expect(tools.aap_hub_search).toBeDefined()
    })

    it("returns config-needed message when no options provided", async () => {
      const tools = await getTools(undefined)
      const result = await tools.aap_list_templates.execute({}, {} as never)
      expect(result).toContain("not configured")
    })

    it("returns config-needed message when controllerUrl missing", async () => {
      const tools = await getTools({ oauthToken: "token" })
      const result = await tools.aap_list_templates.execute({}, {} as never)
      expect(result).toContain("not configured")
    })

    it("returns config-needed message when oauthToken missing", async () => {
      const tools = await getTools({ controllerUrl: "https://controller.example.com" })
      const result = await tools.aap_list_templates.execute({}, {} as never)
      expect(result).toContain("not configured")
    })
  })

  describe("unconfigured tools return config message for all tools", () => {
    it("aap_launch_job returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.aap_launch_job.execute({ templateId: 1 }, {} as never)
      expect(result).toContain("not configured")
    })

    it("aap_job_status returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.aap_job_status.execute({ jobId: 1 }, {} as never)
      expect(result).toContain("not configured")
    })

    it("aap_job_output returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.aap_job_output.execute({ jobId: 1 }, {} as never)
      expect(result).toContain("not configured")
    })

    it("aap_list_inventories returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.aap_list_inventories.execute({}, {} as never)
      expect(result).toContain("not configured")
    })

    it("aap_hub_search returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.aap_hub_search.execute({ keyword: "test" }, {} as never)
      expect(result).toContain("not configured")
    })
  })

  describe("shell.env hook", () => {
    it("sets CONTROLLER_HOST and CONTROLLER_OAUTH_TOKEN when configured", async () => {
      setupFetch([])
      const hooks = await getHooks(configuredOptions)
      const shellEnv = hooks["shell.env"]
      expect(shellEnv).toBeDefined()
      const output = { env: {} as Record<string, string> }
      await shellEnv!({ cwd: "/tmp" }, output)
      expect(output.env["CONTROLLER_HOST"]).toBe(controllerUrl)
      expect(output.env["CONTROLLER_OAUTH_TOKEN"]).toBe(oauthToken)
    })

    it("does not set shell.env when not configured", async () => {
      const hooks = await getHooks(undefined)
      expect(hooks["shell.env"]).toBeUndefined()
    })
  })

  describe("aap_list_templates", () => {
    it("returns formatted template list on success", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v2/job_templates/",
          body: {
            count: 2,
            results: [
              { id: 1, name: "Deploy App", description: "Deploy to production", status: "successful" },
              { id: 2, name: "Run Tests", description: "Execute test suite", status: "failed" },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_list_templates.execute({}, {} as never)
      expect(result).toContain("Job templates: 2")
      expect(result).toContain("#1 Deploy App")
      expect(result).toContain("Deploy to production")
      expect(result).toContain("[successful]")
      expect(result).toContain("#2 Run Tests")
      expect(result).toContain("[failed]")
    })

    it("returns no-templates message when empty", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/job_templates/", body: { count: 0, results: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_list_templates.execute({}, {} as never)
      expect(result).toContain("No job templates found")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/job_templates/", status: 500, body: { error: "Internal error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_list_templates.execute({}, {} as never)
      expect(result).toContain("Failed to list templates")
    })
  })

  describe("aap_launch_job", () => {
    it("launches job after confirmation and returns job ID", async () => {
      setupFetch([
        {
          method: "POST",
          path: "/api/v2/job_templates/1/launch/",
          body: { id: 42, job: 42, status: "pending" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const mockCtx = { ask: async () => {} }
      const result = await tools.aap_launch_job.execute({ templateId: 1 }, mockCtx as never)
      expect(result).toContain("Job launched successfully")
      expect(result).toContain("42")
    })

    it("returns error when user denies launch", async () => {
      setupFetch([])
      const tools = await getTools(configuredOptions)
      const mockCtx = {
        ask: async () => {
          throw new Error("Permission denied")
        },
      }
      const result = await tools.aap_launch_job.execute({ templateId: 1 }, mockCtx as never)
      expect(result).toContain("Failed to launch job")
      expect(result).toContain("Permission denied")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "POST", path: "/api/v2/job_templates/99/launch/", status: 404, body: { error: "Not found" } },
      ])
      const tools = await getTools(configuredOptions)
      const mockCtx = { ask: async () => {} }
      const result = await tools.aap_launch_job.execute({ templateId: 99 }, mockCtx as never)
      expect(result).toContain("Failed to launch job")
    })
  })

  describe("aap_job_status", () => {
    it("returns formatted job status", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v2/jobs/42/",
          body: {
            id: 42,
            name: "Deploy App",
            status: "successful",
            started: "2025-01-15T10:00:00Z",
            finished: "2025-01-15T10:05:00Z",
            elapsed: 300,
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_job_status.execute({ jobId: 42 }, {} as never)
      expect(result).toContain("Job #42")
      expect(result).toContain("Deploy App")
      expect(result).toContain("successful")
      expect(result).toContain("300s")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/jobs/999/", status: 404, body: { error: "Not found" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_job_status.execute({ jobId: 999 }, {} as never)
      expect(result).toContain("Failed to get job status")
    })
  })

  describe("aap_job_output", () => {
    it("returns job stdout output", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v2/jobs/42/stdout/",
          body: "PLAY [all] ***\nTASK [setup] ***\nok: [host1]\n",
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_job_output.execute({ jobId: 42 }, {} as never)
      expect(result).toContain("PLAY [all]")
      expect(result).toContain("TASK [setup]")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/jobs/999/stdout/", status: 404, body: { error: "Not found" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_job_output.execute({ jobId: 999 }, {} as never)
      expect(result).toContain("Failed to get job output")
    })
  })

  describe("aap_list_inventories", () => {
    it("returns formatted inventory list", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v2/inventories/",
          body: {
            count: 2,
            results: [
              { id: 1, name: "Production", description: "Prod servers", total_hosts: 50, hosts_with_active_failures: 2 },
              { id: 2, name: "Staging", description: "Stage servers", total_hosts: 10, hosts_with_active_failures: 0 },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_list_inventories.execute({}, {} as never)
      expect(result).toContain("Inventories: 2")
      expect(result).toContain("#1 Production")
      expect(result).toContain("50 hosts")
      expect(result).toContain("2 failures")
      expect(result).toContain("#2 Staging")
      expect(result).toContain("0 failures")
    })

    it("returns no-inventories message when empty", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/inventories/", body: { count: 0, results: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_list_inventories.execute({}, {} as never)
      expect(result).toContain("No inventories found")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/inventories/", status: 500, body: { error: "error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_list_inventories.execute({}, {} as never)
      expect(result).toContain("Failed to list inventories")
    })
  })

  describe("aap_hub_search", () => {
    it("returns formatted collection list", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v2/collections/",
          body: {
            count: 1,
            results: [
              {
                namespace: { name: "ansible" },
                name: "netcommon",
                description: "Network common utilities",
                latest_version: { version: "5.1.0" },
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_hub_search.execute({ keyword: "network" }, {} as never)
      expect(result).toContain("Collections: 1")
      expect(result).toContain("ansible.netcommon")
      expect(result).toContain("v5.1.0")
      expect(result).toContain("Network common utilities")
    })

    it("returns no-collections message when empty", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/collections/", body: { count: 0, results: [] } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_hub_search.execute({ keyword: "nonexistent" }, {} as never)
      expect(result).toContain("No collections found")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/api/v2/collections/", status: 500, body: { error: "error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.aap_hub_search.execute({ keyword: "test" }, {} as never)
      expect(result).toContain("Failed to search collections")
    })
  })
})
