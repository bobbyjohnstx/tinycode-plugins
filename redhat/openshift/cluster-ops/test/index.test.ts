import { describe, it, expect } from "bun:test"
import {
  createMockShell,
  createMockInput,
} from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"
import { createObsTools } from "../src/obs-tools"
import type { OcClient } from "tinycode-plugin-redhat-shared/oc"

describe("tinycode-plugin-ocp-cluster-ops", () => {
  it("loads without error", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks).toBeDefined()
  })

  it("registers all fifteen tools", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks.tool).toBeDefined()
    const toolNames = Object.keys(hooks.tool!)
    expect(toolNames).toContain("ocp_get_resources")
    expect(toolNames).toContain("ocp_logs")
    expect(toolNames).toContain("ocp_describe")
    expect(toolNames).toContain("ocp_events")
    expect(toolNames).toContain("ocp_apply")
    expect(toolNames).toContain("ocp_status")
    expect(toolNames).toContain("ocp_gitops_apps")
    expect(toolNames).toContain("ocp_gitops_sync")
    expect(toolNames).toContain("ocp_gitops_diff")
    expect(toolNames).toContain("ocp_gitops_history")
    expect(toolNames).toContain("ocp_insights_recommendations")
    expect(toolNames).toContain("ocp_insights_cves")
    expect(toolNames).toContain("ocp_top_pods")
    expect(toolNames).toContain("ocp_resource_usage")
    expect(toolNames).toContain("ocp_error_rate")
    expect(toolNames).toHaveLength(15)
  })

  describe("shell.env", () => {
    it("sets OC_EDITOR to cat", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      const output = { env: {} as Record<string, string> }
      await hooks["shell.env"]!({ cwd: "/tmp" }, output)
      expect(output.env["OC_EDITOR"]).toBe("cat")
    })
  })

  describe("ocp_get_resources", () => {
    it("returns JSON for a resource query", async () => {
      const mockData = {
        items: [
          { metadata: { name: "pod-1" }, status: { phase: "Running" } },
        ],
      }
      const shell = createMockShell([
        {
          match: "oc get pods",
          output: JSON.stringify(mockData),
          json: mockData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_get_resources!.execute(
        { resource: "pods" },
        undefined as any,
      )
      expect(result).toContain("pod-1")
      expect(result).toContain("Running")
    })

    it("passes namespace and selector options", async () => {
      const mockData = { items: [] }
      const shell = createMockShell([
        {
          match: /oc.*get.*deployments.*--namespace.*myns.*--selector.*app=web/,
          output: JSON.stringify(mockData),
          json: mockData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_get_resources!.execute(
        { resource: "deployments", namespace: "myns", selector: "app=web" },
        undefined as any,
      )
      expect(result).toBe(JSON.stringify(mockData, null, 2))
    })

    it("returns error message on failure", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_get_resources!.execute(
        { resource: "pods" },
        undefined as any,
      )
      expect(result).toContain("Error getting resources")
    })
  })

  describe("ocp_logs", () => {
    it("returns pod logs", async () => {
      const logOutput = "2024-01-01 INFO Starting server\n2024-01-01 INFO Ready"
      const shell = createMockShell([
        { match: "oc logs my-pod", output: logOutput },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_logs!.execute(
        { pod: "my-pod" },
        undefined as any,
      )
      expect(result).toBe(logOutput)
    })

    it("passes namespace, container, tail, and since options", async () => {
      const shell = createMockShell([
        {
          match: /oc.*logs.*my-pod.*--namespace.*myns.*--container.*app.*--tail.*100.*--since.*5m/,
          output: "log line",
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_logs!.execute(
        {
          pod: "my-pod",
          namespace: "myns",
          container: "app",
          tail: 100,
          since: "5m",
        },
        undefined as any,
      )
      expect(result).toBe("log line")
    })

    it("returns fallback text when logs are empty", async () => {
      const shell = createMockShell([{ match: "oc logs empty-pod", output: "" }])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_logs!.execute(
        { pod: "empty-pod" },
        undefined as any,
      )
      expect(result).toBe("(no log output)")
    })

    it("returns error message on failure", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_logs!.execute(
        { pod: "missing-pod" },
        undefined as any,
      )
      expect(result).toContain("Error getting logs")
    })
  })

  describe("ocp_describe", () => {
    it("returns resource description", async () => {
      const describeOutput =
        "Name: my-deploy\nNamespace: default\nReplicas: 3"
      const shell = createMockShell([
        { match: "oc describe deployment my-deploy", output: describeOutput },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_describe!.execute(
        { resource: "deployment", name: "my-deploy" },
        undefined as any,
      )
      expect(result).toBe(describeOutput)
    })

    it("passes namespace option", async () => {
      const shell = createMockShell([
        {
          match: /oc.*describe.*pod.*my-pod.*--namespace.*staging/,
          output: "Name: my-pod",
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_describe!.execute(
        { resource: "pod", name: "my-pod", namespace: "staging" },
        undefined as any,
      )
      expect(result).toBe("Name: my-pod")
    })

    it("returns error message on failure", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_describe!.execute(
        { resource: "pod", name: "nonexistent" },
        undefined as any,
      )
      expect(result).toContain("Error describing resource")
    })
  })

  describe("ocp_events", () => {
    it("returns cluster events as JSON", async () => {
      const eventsData = {
        items: [
          {
            reason: "Scheduled",
            message: "Successfully assigned pod",
            type: "Normal",
          },
        ],
      }
      const shell = createMockShell([
        {
          match: "oc get events",
          output: JSON.stringify(eventsData),
          json: eventsData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_events!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Scheduled")
      expect(result).toContain("Successfully assigned pod")
    })

    it("passes namespace and fieldSelector", async () => {
      const eventsData = { items: [] }
      const shell = createMockShell([
        {
          match: /oc.*get.*events.*--namespace.*prod.*--field-selector.*type=Warning/,
          output: JSON.stringify(eventsData),
          json: eventsData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_events!.execute(
        { namespace: "prod", fieldSelector: "type=Warning" },
        undefined as any,
      )
      expect(result).toBe(JSON.stringify(eventsData, null, 2))
    })

    it("returns error message on failure", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_events!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Error getting events")
    })
  })

  describe("ocp_apply", () => {
    it("applies manifest after permission check", async () => {
      const manifest = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: test"
      const shell = createMockShell([
        { match: "oc apply", output: "configmap/test created" },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const mockCtx = {
        ask: async () => {},
      }
      const result = await hooks.tool!.ocp_apply!.execute(
        { manifest },
        mockCtx as any,
      )
      expect(result).toContain("configmap/test created")
    })

    it("returns error when apply fails", async () => {
      const manifest = "invalid: yaml"
      const shell = createMockShell([
        { match: "oc apply", output: "error: invalid manifest", exitCode: 1 },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const mockCtx = {
        ask: async () => {},
      }
      const result = await hooks.tool!.ocp_apply!.execute(
        { manifest },
        mockCtx as any,
      )
      expect(result).toContain("Error applying manifest")
    })
  })

  describe("ocp_status", () => {
    it("returns summarized cluster status with node/operator counts", async () => {
      const nodesData = {
        items: [
          {
            metadata: { name: "node-1" },
            status: {
              conditions: [{ type: "Ready", status: "True" }],
            },
          },
          {
            metadata: { name: "node-2" },
            status: {
              conditions: [{ type: "Ready", status: "False" }],
            },
          },
        ],
      }
      const operatorsData = {
        items: [
          {
            metadata: { name: "authentication" },
            status: {
              conditions: [
                { type: "Available", status: "True" },
                { type: "Degraded", status: "False" },
              ],
            },
          },
          {
            metadata: { name: "dns" },
            status: {
              conditions: [
                { type: "Available", status: "True" },
                { type: "Degraded", status: "True" },
              ],
            },
          },
        ],
      }
      const versionData = {
        clientVersion: { major: "4", minor: "14" },
        openshiftVersion: "4.14.5",
      }
      const shell = createMockShell([
        {
          match: /oc.*get.*nodes/,
          output: JSON.stringify(nodesData),
          json: nodesData,
        },
        {
          match: /oc.*get.*clusteroperators/,
          output: JSON.stringify(operatorsData),
          json: operatorsData,
        },
        {
          match: /oc.*version/,
          output: JSON.stringify(versionData),
          json: versionData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = (await hooks.tool!.ocp_status!.execute(
        {},
        undefined as any,
      )) as string
      expect(result).toContain("Nodes: 1/2 Ready")
      expect(result).toContain("node-1, node-2")
      expect(result).toContain("Cluster Operators: 2/2 Available")
      expect(result).toContain("Degraded: dns")
      expect(result).toContain("4.14.5")
    })

    it("returns partial status when some commands fail", async () => {
      const versionData = {
        clientVersion: { major: "4", minor: "14" },
      }
      const shell = createMockShell([
        {
          match: /oc.*version/,
          output: JSON.stringify(versionData),
          json: versionData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = (await hooks.tool!.ocp_status!.execute(
        {},
        undefined as any,
      )) as string
      expect(result).toContain("Version")
      expect(result).not.toContain("Nodes")
    })

    it("returns fallback message when all commands fail", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.ocp_status!.execute(
        {},
        undefined as any,
      )
      expect(result).toContain("Unable to retrieve cluster status")
    })
  })

  describe("tool descriptions", () => {
    it("all tools have descriptions", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      for (const [, tool] of Object.entries(hooks.tool!)) {
        expect(tool.description).toBeTruthy()
        expect(typeof tool.description).toBe("string")
      }
    })
  })

  describe("ocp_get_resources truncation", () => {
    it("truncates when items exceed default limit of 50", async () => {
      const items = Array.from({ length: 60 }, (_, i) => ({
        metadata: { name: `pod-${i}` },
        status: { phase: "Running" },
      }))
      const mockData = { items }
      const shell = createMockShell([
        {
          match: "oc get pods",
          output: JSON.stringify(mockData),
          json: mockData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = (await hooks.tool!.ocp_get_resources!.execute(
        { resource: "pods" },
        undefined as any,
      )) as string
      expect(result).toContain("Showing 50 of 60 items")
      expect(result).toContain("pod-0")
      expect(result).not.toContain("pod-55")
    })

    it("respects custom limit parameter", async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        metadata: { name: `pod-${i}` },
      }))
      const mockData = { items }
      const shell = createMockShell([
        {
          match: "oc get pods",
          output: JSON.stringify(mockData),
          json: mockData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = (await hooks.tool!.ocp_get_resources!.execute(
        { resource: "pods", limit: 3 },
        undefined as any,
      )) as string
      expect(result).toContain("Showing 3 of 10 items")
    })

    it("does not truncate when items are within limit", async () => {
      const items = [{ metadata: { name: "pod-0" } }]
      const mockData = { items }
      const shell = createMockShell([
        {
          match: "oc get pods",
          output: JSON.stringify(mockData),
          json: mockData,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = (await hooks.tool!.ocp_get_resources!.execute(
        { resource: "pods" },
        undefined as any,
      )) as string
      expect(result).not.toContain("Showing")
      expect(result).toContain("pod-0")
    })
  })

  describe("ocp_error_rate (parseDuration)", () => {
    function createMockOcClient(
      events: unknown[] = [],
    ): OcClient {
      return {
        isAvailable: async () => true,
        isLoggedIn: async () => true,
        get: async () => ({ items: events }),
        apply: async () => "",
        logs: async () => "",
        describe: async () => "",
        whoami: async () => "user",
        token: async () => "token",
        version: async () => ({
          clientVersion: { major: "4", minor: "14" },
        }),
        raw: async () => "",
      } as unknown as OcClient
    }

    it("returns error for invalid duration format", async () => {
      const oc = createMockOcClient([
        {
          reason: "BackOff",
          type: "Warning",
          involvedObject: { name: "pod-1", kind: "Pod" },
          count: 1,
          lastTimestamp: new Date().toISOString(),
        },
      ])
      const tools = createObsTools(oc)
      const result = await tools.ocp_error_rate!.execute(
        { namespace: "test", since: "xyz" },
        undefined as any,
      )
      expect(result).toContain("Invalid duration format")
      expect(result).toContain("xyz")
    })

    it("supports day and week duration units", async () => {
      const now = Date.now()
      const oc = createMockOcClient([
        {
          reason: "BackOff",
          type: "Warning",
          involvedObject: { name: "pod-1", kind: "Pod" },
          count: 1,
          lastTimestamp: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          reason: "OOMKilled",
          type: "Warning",
          involvedObject: { name: "pod-2", kind: "Pod" },
          count: 1,
          lastTimestamp: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ])
      const tools = createObsTools(oc)

      const result7d = (await tools.ocp_error_rate!.execute(
        { namespace: "test", since: "7d" },
        undefined as any,
      )) as string
      expect(result7d).toContain("BackOff")
      expect(result7d).not.toContain("OOMKilled")

      const result2w = (await tools.ocp_error_rate!.execute(
        { namespace: "test", since: "2w" },
        undefined as any,
      )) as string
      expect(result2w).toContain("BackOff")
      expect(result2w).toContain("OOMKilled")
    })
  })
})
