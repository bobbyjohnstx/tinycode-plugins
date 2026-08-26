import { describe, it, expect } from "bun:test"
import { createMockShell } from "tinycode-plugin-redhat-shared/test-utils"
import type { ToolContext } from "tinycode-plugin"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { createObsTools } from "../src/obs-tools"

function setupTools(commands: Parameters<typeof createMockShell>[0]) {
  const shell = createMockShell(commands)
  const oc = createOcClient(shell)
  return createObsTools(oc)
}

const ctx = undefined as unknown as ToolContext

describe("obs-tools", () => {
  describe("ocp_top_pods", () => {
    it("returns pod metrics table", async () => {
      const output = [
        "NAME         CPU(cores)   MEMORY(bytes)",
        "api-pod-1    250m         512Mi",
        "worker-1     100m         256Mi",
      ].join("\n")
      const tools = setupTools([
        { match: /oc.*adm.*top.*pods/, output },
      ])
      const result = await tools.ocp_top_pods.execute({}, ctx)
      expect(result).toContain("api-pod-1")
      expect(result).toContain("250m")
      expect(result).toContain("512Mi")
      expect(result).toContain("worker-1")
    })

    it("passes namespace argument", async () => {
      const output = "NAME         CPU(cores)   MEMORY(bytes)\nmy-pod    50m    128Mi"
      const tools = setupTools([
        { match: /oc.*adm.*top.*pods.*-n.*my-ns/, output },
      ])
      const result = await tools.ocp_top_pods.execute(
        { namespace: "my-ns" },
        ctx,
      )
      expect(result).toContain("my-pod")
    })

    it("sorts by memory when requested", async () => {
      const output = "NAME         CPU(cores)   MEMORY(bytes)\napi-pod-1    250m    512Mi"
      const tools = setupTools([
        { match: /oc.*adm.*top.*pods.*--sort-by=memory/, output },
      ])
      const result = await tools.ocp_top_pods.execute(
        { sortBy: "memory" },
        ctx,
      )
      expect(result).toContain("api-pod-1")
    })

    it("returns error message when oc adm top pods fails", async () => {
      const tools = setupTools([
        {
          match: /oc.*adm.*top.*pods/,
          output: "",
          exitCode: 1,
        },
      ])
      const result = await tools.ocp_top_pods.execute({}, ctx)
      expect(result).toContain("Error getting pod metrics")
    })

    it("returns no metrics message for empty output", async () => {
      const tools = setupTools([
        { match: /oc.*adm.*top.*pods/, output: "   " },
      ])
      const result = await tools.ocp_top_pods.execute({}, ctx)
      expect(result).toContain("No pod metrics available")
    })
  })

  describe("ocp_resource_usage", () => {
    it("displays resource quota usage with percentages", async () => {
      const quotaData = {
        items: [
          {
            metadata: { name: "compute-resources" },
            status: {
              hard: {
                "requests.cpu": "4",
                "requests.memory": "8Gi",
                "limits.cpu": "8",
                "limits.memory": "16Gi",
              },
              used: {
                "requests.cpu": "2500m",
                "requests.memory": "4Gi",
                "limits.cpu": "4000m",
                "limits.memory": "8Gi",
              },
            },
          },
        ],
      }
      const tools = setupTools([
        {
          match: /oc.*get.*resourcequota/,
          output: JSON.stringify(quotaData),
          json: quotaData,
        },
      ])
      const result = await tools.ocp_resource_usage.execute(
        { namespace: "prod" },
        ctx,
      )
      expect(result).toContain("compute-resources")
      expect(result).toContain("CPU Requests:")
      expect(result).toContain("63%")
      expect(result).toContain("Memory Requests:")
      expect(result).toContain("50%")
      expect(result).toContain("CPU Limits:")
      expect(result).toContain("Memory Limits:")
    })

    it("returns message when no quotas exist", async () => {
      const emptyData = { items: [] }
      const tools = setupTools([
        {
          match: /oc.*get.*resourcequota/,
          output: JSON.stringify(emptyData),
          json: emptyData,
        },
      ])
      const result = await tools.ocp_resource_usage.execute(
        { namespace: "dev" },
        ctx,
      )
      expect(result).toContain("No resource quotas found in namespace dev")
    })

    it("returns error on failure", async () => {
      const tools = setupTools([])
      const result = await tools.ocp_resource_usage.execute(
        { namespace: "prod" },
        ctx,
      )
      expect(result).toContain("Error getting resource usage")
    })
  })

  describe("ocp_error_rate", () => {
    it("aggregates warning events by reason with affected pods", async () => {
      const eventsData = {
        items: [
          {
            reason: "BackOff",
            type: "Warning",
            involvedObject: { name: "api-pod-1", kind: "Pod" },
            count: 5,
            lastTimestamp: "2026-08-25T10:00:00Z",
          },
          {
            reason: "BackOff",
            type: "Warning",
            involvedObject: { name: "worker-pod-3", kind: "Pod" },
            count: 7,
            lastTimestamp: "2026-08-25T10:05:00Z",
          },
          {
            reason: "FailedScheduling",
            type: "Warning",
            involvedObject: { name: "batch-job-7", kind: "Pod" },
            count: 5,
            lastTimestamp: "2026-08-25T10:10:00Z",
          },
        ],
      }
      const tools = setupTools([
        {
          match: /oc.*get.*events.*type=Warning/,
          output: JSON.stringify(eventsData),
          json: eventsData,
        },
      ])
      const result = await tools.ocp_error_rate.execute(
        { namespace: "prod" },
        ctx,
      )
      expect(result).toContain("Warning Events: 17")
      expect(result).toContain("Top Reasons:")
      expect(result).toContain("BackOff: 12 events")
      expect(result).toContain("api-pod-1")
      expect(result).toContain("worker-pod-3")
      expect(result).toContain("FailedScheduling: 5 events")
      expect(result).toContain("batch-job-7")
    })

    it("returns no events message when namespace is clean", async () => {
      const emptyData = { items: [] }
      const tools = setupTools([
        {
          match: /oc.*get.*events.*type=Warning/,
          output: JSON.stringify(emptyData),
          json: emptyData,
        },
      ])
      const result = await tools.ocp_error_rate.execute(
        { namespace: "clean-ns" },
        ctx,
      )
      expect(result).toContain("No warning events found in namespace clean-ns")
    })

    it("includes time label when since is provided", async () => {
      const emptyData = { items: [] }
      const tools = setupTools([
        {
          match: /oc.*get.*events.*type=Warning/,
          output: JSON.stringify(emptyData),
          json: emptyData,
        },
      ])
      const result = await tools.ocp_error_rate.execute(
        { namespace: "prod", since: "1h" },
        ctx,
      )
      expect(result).toContain("last 1h")
    })

    it("returns error on oc command failure", async () => {
      const tools = setupTools([])
      const result = await tools.ocp_error_rate.execute(
        { namespace: "prod" },
        ctx,
      )
      expect(result).toContain("Error checking events")
    })

    it("sorts reasons by event count descending", async () => {
      const eventsData = {
        items: [
          {
            reason: "Unhealthy",
            type: "Warning",
            involvedObject: { name: "pod-a", kind: "Pod" },
            count: 2,
            lastTimestamp: "2026-08-25T10:00:00Z",
          },
          {
            reason: "OOMKilling",
            type: "Warning",
            involvedObject: { name: "ml-worker-1", kind: "Pod" },
            count: 10,
            lastTimestamp: "2026-08-25T10:00:00Z",
          },
          {
            reason: "BackOff",
            type: "Warning",
            involvedObject: { name: "pod-b", kind: "Pod" },
            count: 5,
            lastTimestamp: "2026-08-25T10:00:00Z",
          },
        ],
      }
      const tools = setupTools([
        {
          match: /oc.*get.*events.*type=Warning/,
          output: JSON.stringify(eventsData),
          json: eventsData,
        },
      ])
      const result = await tools.ocp_error_rate.execute(
        { namespace: "prod" },
        ctx,
      )
      const resultStr = result as string
      const oomIndex = resultStr.indexOf("OOMKilling")
      const backoffIndex = resultStr.indexOf("BackOff")
      const unhealthyIndex = resultStr.indexOf("Unhealthy")
      expect(oomIndex).toBeLessThan(backoffIndex)
      expect(backoffIndex).toBeLessThan(unhealthyIndex)
    })
  })
})
