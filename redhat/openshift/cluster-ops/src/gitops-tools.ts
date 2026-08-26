import type { ToolContext, ToolDefinition } from "tinycode-plugin"
import type { OcClient } from "tinycode-plugin-redhat-shared/oc"
import { z } from "zod"

type ArgoApplication = {
  metadata: { name: string; namespace?: string }
  spec: {
    project: string
    source: { repoURL: string; path?: string; targetRevision?: string }
  }
  status: {
    sync: { status: string }
    health: { status: string }
    resources?: Array<{
      kind: string
      namespace?: string
      name: string
      status: string
      health?: { status: string }
    }>
    history?: Array<{
      id: number
      revision: string
      deployedAt: string
      source: { repoURL: string; path?: string; targetRevision?: string }
    }>
  }
}

type ArgoApplicationList = {
  items: ArgoApplication[]
}

const DEFAULT_NAMESPACE = "openshift-gitops"

export function createGitOpsTools(
  oc: OcClient,
): Record<string, ToolDefinition> {
  return {
    ocp_gitops_apps: {
      description:
        "List ArgoCD applications in the cluster with sync status, health, project, and repo URL.",
      args: {
        namespace: z
          .string()
          .optional()
          .describe(
            "Namespace where ArgoCD applications are deployed (default: openshift-gitops)",
          ),
      },
      async execute(args: { namespace?: string }) {
        try {
          const ns = args.namespace ?? DEFAULT_NAMESPACE
          const result = await oc.get<ArgoApplicationList>(
            "applications.argoproj.io",
            { namespace: ns },
          )
          const apps = result.items
          if (apps.length === 0) {
            return "No ArgoCD applications found."
          }
          const lines = apps.map((app) => {
            const name = app.metadata.name
            const syncStatus = app.status?.sync?.status ?? "Unknown"
            const healthStatus = app.status?.health?.status ?? "Unknown"
            const project = app.spec?.project ?? "Unknown"
            const repoURL = app.spec?.source?.repoURL ?? "Unknown"
            return `- ${name} | Sync: ${syncStatus} | Health: ${healthStatus} | Project: ${project} | Repo: ${repoURL}`
          })
          return `## ArgoCD Applications (${ns})\n\n${lines.join("\n")}`
        } catch (error) {
          return `Error listing GitOps applications: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ocp_gitops_sync: {
      description:
        "Trigger a sync operation on an ArgoCD application. Requires user confirmation before executing.",
      args: {
        name: z
          .string()
          .describe("Name of the ArgoCD application to sync"),
        namespace: z
          .string()
          .optional()
          .describe(
            "Namespace of the ArgoCD application (default: openshift-gitops)",
          ),
        revision: z
          .string()
          .optional()
          .describe("Git revision to sync to (default: HEAD)"),
      },
      async execute(
        args: { name: string; namespace?: string; revision?: string },
        ctx: ToolContext,
      ) {
        try {
          const ns = args.namespace ?? DEFAULT_NAMESPACE
          const rev = args.revision ?? "HEAD"
          await ctx.ask({
            permission: "ocp_gitops_sync",
            patterns: ["oc patch application"],
            always: [],
            metadata: {
              application: args.name,
              namespace: ns,
              revision: rev,
            },
          })
          const patch = JSON.stringify({
            operation: {
              initiatedBy: { username: "tinycode" },
              sync: { revision: rev },
            },
          })
          const result = await oc.raw(
            "patch",
            "application",
            args.name,
            "-n",
            ns,
            "--type=merge",
            "-p",
            patch,
          )
          return result || `Sync triggered for application '${args.name}'`
        } catch (error) {
          return `Error syncing application: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ocp_gitops_diff: {
      description:
        "Show out-of-sync resources for an ArgoCD application.",
      args: {
        name: z
          .string()
          .describe("Name of the ArgoCD application"),
        namespace: z
          .string()
          .optional()
          .describe(
            "Namespace of the ArgoCD application (default: openshift-gitops)",
          ),
      },
      async execute(args: { name: string; namespace?: string }) {
        try {
          const ns = args.namespace ?? DEFAULT_NAMESPACE
          const app = await oc.get<ArgoApplication>(
            "applications.argoproj.io/" + args.name,
            { namespace: ns },
          )
          const resources = app.status?.resources ?? []
          const outOfSync = resources.filter((r) => r.status !== "Synced")
          if (outOfSync.length === 0) {
            return `All resources in '${args.name}' are synced.`
          }
          const lines = outOfSync.map((r) => {
            const health = r.health?.status ?? "Unknown"
            return `- ${r.kind}/${r.name} | Namespace: ${r.namespace ?? "N/A"} | Status: ${r.status} | Health: ${health}`
          })
          return `## Out-of-Sync Resources for '${args.name}'\n\n${lines.join("\n")}`
        } catch (error) {
          return `Error getting application diff: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ocp_gitops_history: {
      description:
        "Show deployment history for an ArgoCD application.",
      args: {
        name: z
          .string()
          .describe("Name of the ArgoCD application"),
        namespace: z
          .string()
          .optional()
          .describe(
            "Namespace of the ArgoCD application (default: openshift-gitops)",
          ),
      },
      async execute(args: { name: string; namespace?: string }) {
        try {
          const ns = args.namespace ?? DEFAULT_NAMESPACE
          const app = await oc.get<ArgoApplication>(
            "applications.argoproj.io/" + args.name,
            { namespace: ns },
          )
          const history = app.status?.history ?? []
          if (history.length === 0) {
            return `No deployment history found for '${args.name}'.`
          }
          const lines = history.map((entry) => {
            const shortRev = entry.revision?.substring(0, 7) ?? "unknown"
            const source = entry.source?.repoURL ?? "unknown"
            return `- #${entry.id} | Revision: ${shortRev} | Deployed: ${entry.deployedAt} | Source: ${source}`
          })
          return `## Deployment History for '${args.name}'\n\n${lines.join("\n")}`
        } catch (error) {
          return `Error getting deployment history: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}
