import type { ToolDefinition } from "tinycode-plugin"
import { OcError } from "tinycode-plugin-redhat-shared/oc"
import type { OcClient } from "tinycode-plugin-redhat-shared/oc"
import { z } from "zod"

type ResourceQuotaList = {
  items: Array<{
    metadata: { name: string }
    status: {
      hard: Record<string, string>
      used: Record<string, string>
    }
  }>
}

type EventList = {
  items: Array<{
    reason: string
    type: string
    involvedObject: { name: string; kind: string }
    count: number
    lastTimestamp?: string
    eventTime?: string
  }>
}

function parseCpuToMillicores(value: string): number {
  if (value.endsWith("m")) {
    return parseInt(value.slice(0, -1), 10)
  }
  return parseFloat(value) * 1000
}

function parseMemoryToMiB(value: string): number {
  const num = parseFloat(value)
  if (value.endsWith("Gi")) return num * 1024
  if (value.endsWith("Mi")) return num
  if (value.endsWith("Ki")) return num / 1024
  return num / (1024 * 1024)
}

function formatCpu(millicores: number): string {
  if (millicores >= 1000) {
    return `${(millicores / 1000).toFixed(1)} cores`
  }
  return `${millicores}m`
}

function formatMemory(mib: number): string {
  if (mib >= 1024) {
    return `${(mib / 1024).toFixed(1)} GiB`
  }
  return `${mib.toFixed(0)} MiB`
}

function formatPercentage(used: number, total: number): string {
  if (total === 0) return "N/A"
  return `${Math.round((used / total) * 100)}%`
}

export function createObsTools(
  oc: OcClient,
): Record<string, ToolDefinition> {
  return {
    ocp_top_pods: {
      description:
        "Get pod resource usage (CPU and memory) sorted by CPU or memory. Uses oc adm top pods.",
      args: {
        namespace: z
          .string()
          .optional()
          .describe("Namespace to query pod metrics from"),
        sortBy: z
          .enum(["cpu", "memory"])
          .optional()
          .describe("Sort pods by cpu or memory usage (default: cpu)"),
      },
      async execute(args: { namespace?: string; sortBy?: "cpu" | "memory" }) {
        try {
          const rawArgs: string[] = ["adm", "top", "pods"]
          if (args.namespace) rawArgs.push("-n", args.namespace)
          rawArgs.push(`--sort-by=${args.sortBy ?? "cpu"}`)
          const result = await oc.raw(...rawArgs)
          if (!result.trim()) {
            return "No pod metrics available."
          }
          return result.trim()
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : String(error)
          const stderr =
            error instanceof OcError ? error.stderr : ""
          const combined = `${msg} ${stderr}`
          if (
            combined.includes("Metrics") ||
            combined.includes("metrics") ||
            combined.includes("not available")
          ) {
            return "Metrics server is not available on this cluster. Install the metrics-server or OpenShift monitoring stack to use this tool."
          }
          return `Error getting pod metrics: ${msg}`
        }
      },
    },

    ocp_resource_usage: {
      description:
        "Get resource quota usage for a namespace showing CPU and memory requests, limits, and utilization percentage.",
      args: {
        namespace: z
          .string()
          .describe("Namespace to check resource quota usage"),
      },
      async execute(args: { namespace: string }) {
        try {
          const result = await oc.get<ResourceQuotaList>(
            "resourcequota",
            { namespace: args.namespace },
          )
          const items = result.items
          if (items.length === 0) {
            return `No resource quotas found in namespace ${args.namespace}`
          }
          const lines: string[] = []
          for (const quota of items) {
            lines.push(`## ${quota.metadata.name}`)
            const hard = quota.status.hard
            const used = quota.status.used

            if (hard["requests.cpu"] && used["requests.cpu"]) {
              const usedCpu = parseCpuToMillicores(used["requests.cpu"])
              const hardCpu = parseCpuToMillicores(hard["requests.cpu"])
              lines.push(
                `CPU Requests: ${formatCpu(usedCpu)}/${formatCpu(hardCpu)} (${formatPercentage(usedCpu, hardCpu)})`,
              )
            }
            if (hard["requests.memory"] && used["requests.memory"]) {
              const usedMem = parseMemoryToMiB(used["requests.memory"])
              const hardMem = parseMemoryToMiB(hard["requests.memory"])
              lines.push(
                `Memory Requests: ${formatMemory(usedMem)}/${formatMemory(hardMem)} (${formatPercentage(usedMem, hardMem)})`,
              )
            }
            if (hard["limits.cpu"] && used["limits.cpu"]) {
              const usedCpu = parseCpuToMillicores(used["limits.cpu"])
              const hardCpu = parseCpuToMillicores(hard["limits.cpu"])
              lines.push(
                `CPU Limits: ${formatCpu(usedCpu)}/${formatCpu(hardCpu)} (${formatPercentage(usedCpu, hardCpu)})`,
              )
            }
            if (hard["limits.memory"] && used["limits.memory"]) {
              const usedMem = parseMemoryToMiB(used["limits.memory"])
              const hardMem = parseMemoryToMiB(hard["limits.memory"])
              lines.push(
                `Memory Limits: ${formatMemory(usedMem)}/${formatMemory(hardMem)} (${formatPercentage(usedMem, hardMem)})`,
              )
            }
          }
          return lines.join("\n")
        } catch (error) {
          return `Error getting resource usage: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ocp_error_rate: {
      description:
        "Quick error check using cluster events. Shows warning event count, top reasons, and affected pods for a namespace.",
      args: {
        namespace: z
          .string()
          .describe("Namespace to check for warning events"),
        since: z
          .string()
          .optional()
          .describe(
            "Only show events newer than this duration (e.g. 1h, 30m). Filters by event timestamp.",
          ),
      },
      async execute(args: { namespace: string; since?: string }) {
        try {
          const result = await oc.get<EventList>("events", {
            namespace: args.namespace,
            fieldSelector: "type=Warning",
          })
          let events = result.items
          if (args.since) {
            const durationMs = parseDuration(args.since)
            if (durationMs > 0) {
              const cutoff = Date.now() - durationMs
              events = events.filter((e) => {
                const ts = e.lastTimestamp ?? e.eventTime
                if (!ts) return true
                return new Date(ts).getTime() >= cutoff
              })
            }
          }

          if (events.length === 0) {
            const timeLabel = args.since ? ` (last ${args.since})` : ""
            return `No warning events found in namespace ${args.namespace}${timeLabel}`
          }

          const totalCount = events.reduce((sum, e) => sum + (e.count || 1), 0)

          const reasonMap = new Map<
            string,
            { count: number; pods: Set<string> }
          >()
          for (const event of events) {
            const reason = event.reason
            const entry = reasonMap.get(reason) ?? {
              count: 0,
              pods: new Set<string>(),
            }
            entry.count += event.count || 1
            if (event.involvedObject?.name) {
              entry.pods.add(event.involvedObject.name)
            }
            reasonMap.set(reason, entry)
          }

          const sorted = [...reasonMap.entries()].sort(
            (a, b) => b[1].count - a[1].count,
          )

          const timeLabel = args.since ? ` (last ${args.since})` : ""
          const lines: string[] = [
            `Warning Events${timeLabel}: ${totalCount}`,
            "",
            "Top Reasons:",
          ]
          for (const [reason, data] of sorted) {
            const pods = [...data.pods].join(", ")
            lines.push(
              `- ${reason}: ${data.count} events (pods: ${pods || "none"})`,
            )
          }
          return lines.join("\n")
        } catch (error) {
          return `Error checking events: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(h|m|s)$/)
  if (!match) return 0
  const value = parseInt(match[1]!, 10)
  const unit = match[2]!
  if (unit === "h") return value * 60 * 60 * 1000
  if (unit === "m") return value * 60 * 1000
  return value * 1000
}
