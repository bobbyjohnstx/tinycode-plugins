import type { ToolContext, ToolDefinition } from "tinycode-plugin"
import type { OcClient } from "tinycode-plugin-redhat-shared/oc"
import { z } from "zod"

export function createCoreTools(
  oc: OcClient,
): Record<string, ToolDefinition> {
  return {
    ocp_get_resources: {
      description:
        "Get OpenShift/Kubernetes resources (pods, deployments, services, routes, etc.) by namespace. Returns structured JSON.",
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
      },
      async execute(
        args: {
          resource: string
          namespace?: string
          selector?: string
        },
      ) {
        try {
          const result = await oc.get(args.resource, {
            namespace: args.namespace,
            selector: args.selector,
          })
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
        "Get cluster or namespace events, optionally filtered by type, reason, or involved object.",
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
      },
      async execute(
        args: { namespace?: string; fieldSelector?: string },
      ) {
        try {
          const result = await oc.get("events", {
            namespace: args.namespace,
            fieldSelector: args.fieldSelector,
          })
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
        "Get cluster health summary including node status, cluster operators, and API server availability.",
      args: {},
      async execute() {
        try {
          const sections: string[] = []

          const nodes = await oc
            .get<{ items: unknown[] }>("nodes")
            .catch(() => null)
          if (nodes) {
            sections.push(
              "## Nodes\n" + JSON.stringify(nodes, null, 2),
            )
          }

          const clusterOperators = await oc
            .get<{ items: unknown[] }>("clusteroperators")
            .catch(() => null)
          if (clusterOperators) {
            sections.push(
              "## Cluster Operators\n" +
                JSON.stringify(clusterOperators, null, 2),
            )
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
