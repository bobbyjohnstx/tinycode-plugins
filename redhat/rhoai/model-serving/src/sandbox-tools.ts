import type { ToolContext, ToolDefinition } from "tinycode-plugin"
import type { ApiClient } from "tinycode-plugin-redhat-shared/api"

export type SandboxSignupResponse = {
  status?: {
    ready?: boolean
    verificationRequired?: boolean
  }
  apiEndpoint?: string
  cheDashboardURL?: string
  clusterName?: string
  company?: string
  compliantUsername?: string
  consoleURL?: string
  defaultUserNamespace?: string
  startDate?: string
}

export type SandboxStatus = {
  ready: boolean
  state: "ready" | "pending" | "not-registered"
  clusterUrl?: string
  namespace?: string
  consoleUrl?: string
  provisionedDate?: string
}

export function formatSandboxStatus(response: SandboxSignupResponse): string {
  const status = parseSandboxStatus(response)

  if (status.state === "ready") {
    const lines = ["Developer Sandbox Status: Ready", ""]
    if (status.clusterUrl) lines.push(`Cluster: ${status.clusterUrl}`)
    if (status.namespace) lines.push(`Namespace: ${status.namespace}`)
    if (status.consoleUrl) lines.push(`Console: ${status.consoleUrl}`)
    if (status.provisionedDate) lines.push(`Provisioned: ${status.provisionedDate}`)
    return lines.join("\n")
  }

  if (status.state === "pending") {
    return [
      "Developer Sandbox Status: Pending",
      "",
      "Your sandbox is being provisioned. This typically takes 1-2 minutes.",
      "Use rhoai_sandbox_status to check again.",
    ].join("\n")
  }

  return [
    "Developer Sandbox Status: Not Registered",
    "",
    "Use rhoai_sandbox_provision to create a free sandbox environment with RHOAI pre-installed.",
  ].join("\n")
}

export function parseSandboxStatus(response: SandboxSignupResponse): SandboxStatus {
  if (!response.status) {
    return { ready: false, state: "not-registered" }
  }

  if (response.status.ready) {
    const clusterUrl = response.apiEndpoint
      ? response.apiEndpoint.replace(/^https?:\/\//, "")
      : undefined
    const provisionedDate = response.startDate
      ? response.startDate.split("T")[0]
      : undefined

    return {
      ready: true,
      state: "ready",
      clusterUrl,
      namespace: response.defaultUserNamespace,
      consoleUrl: response.consoleURL,
      provisionedDate,
    }
  }

  return { ready: false, state: "pending" }
}

export function createSandboxTools(apiClient: ApiClient): Record<string, ToolDefinition> {
  return {
    rhoai_sandbox_status: {
      description:
        "Check the status of your Red Hat Developer Sandbox environment. Returns whether a sandbox is available, its cluster URL, namespace, and expiry.",
      args: {},
      async execute() {
        try {
          const response = await apiClient.get<SandboxSignupResponse>("/signup")
          return formatSandboxStatus(response.data)
        } catch (error) {
          return `Failed to check sandbox status: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhoai_sandbox_provision: {
      description:
        "Provision a new Red Hat Developer Sandbox environment. Requires user confirmation. The sandbox includes RHOAI with GPU quotas for model inference.",
      args: {},
      async execute(_args: Record<string, never>, ctx: ToolContext) {
        try {
          await ctx.ask({
            permission: "rhoai_sandbox_provision",
            patterns: ["Provision Developer Sandbox"],
            always: [],
            metadata: {},
          })
          const response = await apiClient.post<SandboxSignupResponse>("/signup", {})
          return formatSandboxStatus(response.data)
        } catch (error) {
          return `Failed to provision sandbox: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredSandboxTools(): Record<string, ToolDefinition> {
  return {
    rhoai_sandbox_status: {
      description: "Check Developer Sandbox status.",
      args: {},
      async execute() {
        return "Developer Sandbox not configured. Set consoleOfflineToken in plugin options to enable sandbox integration."
      },
    },
    rhoai_sandbox_provision: {
      description: "Provision a Developer Sandbox.",
      args: {},
      async execute() {
        return "Developer Sandbox not configured. Set consoleOfflineToken in plugin options to enable sandbox integration."
      },
    },
  }
}
