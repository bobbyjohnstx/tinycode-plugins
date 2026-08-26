import type { ToolContext, ToolDefinition } from "tinycode-plugin"
import type { OcClient } from "tinycode-plugin-redhat-shared/oc"
import { z } from "zod"

export function createCoreTools(
  oc: OcClient,
): Record<string, ToolDefinition> {
  return {
    ocp_get_resources: {
      description:
        "Get OpenShift/Kubernetes resources (pods, deployments, services, routes, etc.) by namespace. Returns structured JSON, limited to avoid overwhelming output.",
      args: {
        resource: z
          .string()
          .describe(
            "Resource type to get (e.g. pods, deployments, services, routes, configmaps)",
          ),
        namespace: z
          .string()
          .optional()
          .describe("Kubernetes namespace to query"),
        selector: z
          .string()
          .optional()
          .describe("Label selector to filter resources (e.g. app=myapp)"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of items to return (default: 50)"),
      },
      async execute(
        args: {
          resource: string
          namespace?: string
          selector?: string
          limit?: number
        },
      ) {
        try {
          const result = await oc.get<{ items?: unknown[] }>(args.resource, {
            namespace: args.namespace,
            selector: args.selector,
          })
          const max = args.limit ?? 50
          if (result.items && result.items.length > max) {
            const total = result.items.length
            const truncated = { ...result, items: result.items.slice(0, max) }
            return JSON.stringify(truncated, null, 2) +
              `\n\n(Showing ${max} of ${total} items. Use --selector or increase limit to see more.)`
          }
          return JSON.stringify(result, null, 2)
        } catch (error) {
          return `Error getting resources: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ocp_logs: {
      description:
        "Tail pod logs with optional container selection and time filtering.",
      args: {
        pod: z.string().describe("Pod name to get logs from"),
        namespace: z
          .string()
          .optional()
          .describe("Namespace of the pod"),
        container: z
          .string()
          .optional()
          .describe("Specific container name within the pod"),
        tail: z
          .number()
          .optional()
          .describe("Number of recent log lines to return"),
        since: z
          .string()
          .optional()
          .describe(
            "Only return logs newer than this duration (e.g. 5m, 1h, 2h30m)",
          ),
      },
      async execute(
        args: {
          pod: string
          namespace?: string
          container?: string
          tail?: number
          since?: string
        },
      ) {
        try {
          const logArgs: string[] = ["logs", args.pod]
          if (args.namespace) logArgs.push("--namespace", args.namespace)
          if (args.container) logArgs.push("--container", args.container)
          if (args.tail !== undefined)
            logArgs.push("--tail", String(args.tail))
          if (args.since) logArgs.push("--since", args.since)
          const result = await oc.raw(...logArgs)
          return result || "(no log output)"
        } catch (error) {
          return `Error getting logs: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ocp_describe: {
      description:
        "Describe any OpenShift/Kubernetes resource with events and conditions in structured format.",
      args: {
        resource: z
          .string()
          .describe("Resource type (e.g. pod, deployment, service, route)"),
        name: z.string().describe("Name of the resource to describe"),
        namespace: z
          .string()
          .optional()
          .describe("Namespace of the resource"),
      },
      async execute(
        args: { resource: string; name: string; namespace?: string },
      ) {
        try {
          const result = await oc.describe(
            args.resource,
            args.name,
            args.namespace,
          )
          return result || "(no output)"
        } catch (error) {
          return `Error describing resource: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ocp_events: {
      description:
        "Get cluster or namespace events, optionally filtered by type, reason, or involved object. Limited to avoid overwhelming output.",
      args: {
        namespace: z
          .string()
          .optional()
          .describe(
            "Namespace to get events from. Omit for all namespaces.",
          ),
        fieldSelector: z
          .string()
          .optional()
          .describe(
            "Field selector to filter events (e.g. type=Warning, involvedObject.name=my-pod, reason=FailedScheduling)",
          ),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of events to return (default: 50)"),
      },
      async execute(
        args: { namespace?: string; fieldSelector?: string; limit?: number },
      ) {
        try {
          const result = await oc.get<{ items?: unknown[] }>("events", {
            namespace: args.namespace,
            fieldSelector: args.fieldSelector,
          })
          const max = args.limit ?? 50
          if (result.items && result.items.length > max) {
            const total = result.items.length
            const truncated = { ...result, items: result.items.slice(0, max) }
            return JSON.stringify(truncated, null, 2) +
              `\n\n(Showing ${max} of ${total} events. Use fieldSelector to narrow results or increase limit.)`
          }
          return JSON.stringify(result, null, 2)
        } catch (error) {
          return `Error getting events: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ocp_apply: {
      description:
        "Apply a YAML manifest to the cluster. Requires user confirmation before executing.",
      args: {
        manifest: z
          .string()
          .describe("YAML manifest content to apply to the cluster"),
      },
      async execute(args: { manifest: string }, ctx: ToolContext) {
        try {
          await ctx.ask({
            permission: "ocp_apply",
            patterns: ["oc apply"],
            always: [],
            metadata: { manifest: args.manifest },
          })
          const result = await oc.apply(args.manifest)
          return result || "Applied successfully"
        } catch (error) {
          return `Error applying manifest: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ocp_status: {
      description:
        "Get cluster health summary including node count/status, cluster operator count/status, and version.",
      args: {},
      async execute() {
        try {
          const sections: string[] = []

          type NodeItem = {
            metadata: { name: string }
            status: {
              conditions: Array<{ type: string; status: string }>
            }
          }
          const nodes = await oc
            .get<{ items: NodeItem[] }>("nodes")
            .catch(() => null)
          if (nodes) {
            const ready = nodes.items.filter((n) =>
              n.status.conditions.some(
                (c) => c.type === "Ready" && c.status === "True",
              ),
            ).length
            const total = nodes.items.length
            const names = nodes.items.map((n) => n.metadata.name)
            sections.push(
              `## Nodes: ${ready}/${total} Ready\n${names.join(", ")}`,
            )
          }

          type OperatorItem = {
            metadata: { name: string }
            status: {
              conditions: Array<{ type: string; status: string }>
            }
          }
          const clusterOperators = await oc
            .get<{ items: OperatorItem[] }>("clusteroperators")
            .catch(() => null)
          if (clusterOperators) {
            const available = clusterOperators.items.filter((o) =>
              o.status.conditions.some(
                (c) => c.type === "Available" && c.status === "True",
              ),
            ).length
            const degraded = clusterOperators.items.filter((o) =>
              o.status.conditions.some(
                (c) => c.type === "Degraded" && c.status === "True",
              ),
            )
            const total = clusterOperators.items.length
            const lines = [`## Cluster Operators: ${available}/${total} Available`]
            if (degraded.length > 0) {
              lines.push(
                `Degraded: ${degraded.map((o) => o.metadata.name).join(", ")}`,
              )
            }
            sections.push(lines.join("\n"))
          }

          const version = await oc.version().catch(() => null)
          if (version) {
            sections.push(
              "## Version\n" + JSON.stringify(version, null, 2),
            )
          }

          if (sections.length === 0) {
            return "Unable to retrieve cluster status. Ensure you are logged in."
          }

          return sections.join("\n\n")
        } catch (error) {
          return `Error getting cluster status: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}
