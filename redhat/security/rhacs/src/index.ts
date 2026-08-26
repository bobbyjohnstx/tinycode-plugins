import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createCentralClient } from "./central-client"
import type { Alert, CentralClient, ImageScanResult } from "./central-client"
import { createComplianceTools, createUnconfiguredComplianceTools } from "./compliance-tools"

const optionsSchema = z
  .object({
    centralUrl: z.string().url(),
    apiToken: z.string().optional(),
  })
  .optional()

function notConfigured(): string {
  return "RHACS plugin is not configured. Set centralUrl and apiToken in plugin options."
}

function formatVulns(data: ImageScanResult): string {
  const components = data.components ?? []
  const vulns: Array<{
    cve: string
    severity: string
    cvss: number
    component: string
    version: string
    fixedBy: string
  }> = []

  for (const comp of components) {
    for (const vuln of comp.vulns ?? []) {
      vulns.push({
        cve: vuln.cve ?? "unknown",
        severity: vuln.severity ?? "UNKNOWN",
        cvss: vuln.cvss ?? 0,
        component: comp.name ?? "unknown",
        version: comp.version ?? "unknown",
        fixedBy: vuln.fixedBy ?? "no fix available",
      })
    }
  }

  if (vulns.length === 0) {
    return `Image: ${data.image?.name?.fullName ?? "unknown"}\nNo vulnerabilities found.`
  }

  vulns.sort((a, b) => b.cvss - a.cvss)

  const lines = [
    `Image: ${data.image?.name?.fullName ?? "unknown"}`,
    `Vulnerabilities found: ${vulns.length}`,
    "",
    ...vulns.map(
      (v) =>
        `- ${v.cve} (${v.severity}, CVSS ${v.cvss}) in ${v.component}@${v.version} | Fix: ${v.fixedBy}`,
    ),
  ]

  return lines.join("\n")
}

function formatAlerts(alerts: Alert[]): string {
  if (alerts.length === 0) {
    return "No active violations found."
  }

  const lines = [
    `Active violations: ${alerts.length}`,
    "",
    ...alerts.map((a) => {
      const policy = a.policy?.name ?? "unknown policy"
      const severity = a.policy?.severity ?? "UNKNOWN"
      const deployment = a.deployment?.name ?? "unknown"
      const namespace = a.deployment?.namespace ?? "unknown"
      const state = a.state ?? "unknown"
      return `- [${severity}] ${policy} | Deployment: ${namespace}/${deployment} | State: ${state}`
    }),
  ]

  return lines.join("\n")
}

function createTools(client: CentralClient): Record<string, ToolDefinition> {
  return {
    rhacs_image_scan: {
      description:
        "Scan a container image for vulnerabilities via RHACS Central API. Returns CVE list with severity, CVSS score, and fixable status.",
      args: {
        image: z.string().describe("Full container image reference (e.g. registry.io/repo/image:tag)"),
      },
      async execute(args: { image: string }) {
        try {
          const result = await client.scanImage(args.image)
          return formatVulns(result)
        } catch (error) {
          return `Failed to scan image: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhacs_image_check: {
      description:
        "Check a container image against RHACS deploy-time policies. Returns pass/fail with violated policy names.",
      args: {
        image: z.string().describe("Full container image reference (e.g. registry.io/repo/image:tag)"),
      },
      async execute(args: { image: string }) {
        try {
          const result = await client.checkImage(args.image)
          const alerts = result.alerts ?? []
          if (alerts.length === 0) {
            return `Image ${args.image} passed all deploy-time policy checks.`
          }
          const lines = [
            `Image ${args.image} FAILED policy checks:`,
            "",
            ...alerts.map((a) => {
              const name = a.policy?.name ?? "unknown"
              const severity = a.policy?.severity ?? "UNKNOWN"
              const desc = a.policy?.description ?? ""
              return `- [${severity}] ${name}${desc ? `: ${desc}` : ""}`
            }),
          ]
          return lines.join("\n")
        } catch (error) {
          return `Failed to check image: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhacs_deployment_check: {
      description:
        "Check a deployment YAML against RHACS policies. Catches issues like privileged containers, missing resource limits, etc.",
      args: {
        yaml: z.string().describe("Kubernetes deployment YAML content to check"),
      },
      async execute(args: { yaml: string }) {
        try {
          const result = await client.checkDeployment(args.yaml)
          const alerts = result.alerts ?? []
          if (alerts.length === 0) {
            return "Deployment passed all policy checks."
          }
          const lines = [
            `Deployment FAILED policy checks (${alerts.length} violation(s)):`,
            "",
            ...alerts.map((a) => {
              const name = a.policy?.name ?? "unknown"
              const severity = a.policy?.severity ?? "UNKNOWN"
              const desc = a.policy?.description ?? ""
              return `- [${severity}] ${name}${desc ? `: ${desc}` : ""}`
            }),
          ]
          return lines.join("\n")
        } catch (error) {
          return `Failed to check deployment: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhacs_violations: {
      description:
        "List active policy violations from RHACS. Can filter by namespace or severity.",
      args: {
        namespace: z.string().optional().describe("Filter violations by namespace"),
        severity: z
          .string()
          .optional()
          .describe("Filter by severity (CRITICAL_SEVERITY, HIGH_SEVERITY, MEDIUM_SEVERITY, LOW_SEVERITY)"),
      },
      async execute(args: { namespace?: string; severity?: string }) {
        try {
          const query: Record<string, string> = {}
          const filters: string[] = []
          if (args.namespace) {
            filters.push(`Namespace:${args.namespace}`)
          }
          if (args.severity) {
            filters.push(`Severity:${args.severity}`)
          }
          if (filters.length > 0) {
            query["query"] = filters.join("+")
          }
          const result = await client.listAlerts(Object.keys(query).length > 0 ? query : undefined)
          return formatAlerts(result.alerts ?? [])
        } catch (error) {
          return `Failed to list violations: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhacs_risk: {
      description: "Get the risk score and risk factors for a deployment from RHACS.",
      args: {
        deploymentId: z.string().describe("The RHACS deployment ID"),
      },
      async execute(args: { deploymentId: string }) {
        try {
          const result = await client.getDeploymentRisk(args.deploymentId)
          const name = result.subject?.name ?? "unknown"
          const namespace = result.subject?.namespace ?? "unknown"
          const score = result.score ?? 0
          const riskResults = result.results ?? []

          const lines = [
            `Deployment: ${namespace}/${name}`,
            `Risk Score: ${score}`,
            "",
          ]

          if (riskResults.length > 0) {
            lines.push("Risk Factors:")
            for (const r of riskResults) {
              lines.push(`  ${r.name ?? "unknown"}:`)
              for (const f of r.factors ?? []) {
                lines.push(`    - ${f.message ?? "unknown factor"}`)
              }
            }
          } else {
            lines.push("No risk factors identified.")
          }

          return lines.join("\n")
        } catch (error) {
          return `Failed to get risk: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

function createUnconfiguredTools(): Record<string, ToolDefinition> {
  return {
    rhacs_image_scan: {
      description:
        "Scan a container image for vulnerabilities via RHACS Central API. Returns CVE list with severity, CVSS score, and fixable status.",
      args: {
        image: z.string().describe("Full container image reference (e.g. registry.io/repo/image:tag)"),
      },
      async execute(_args: { image: string }) {
        return notConfigured()
      },
    },

    rhacs_image_check: {
      description:
        "Check a container image against RHACS deploy-time policies. Returns pass/fail with violated policy names.",
      args: {
        image: z.string().describe("Full container image reference (e.g. registry.io/repo/image:tag)"),
      },
      async execute(_args: { image: string }) {
        return notConfigured()
      },
    },

    rhacs_deployment_check: {
      description:
        "Check a deployment YAML against RHACS policies. Catches issues like privileged containers, missing resource limits, etc.",
      args: {
        yaml: z.string().describe("Kubernetes deployment YAML content to check"),
      },
      async execute(_args: { yaml: string }) {
        return notConfigured()
      },
    },

    rhacs_violations: {
      description:
        "List active policy violations from RHACS. Can filter by namespace or severity.",
      args: {
        namespace: z.string().optional().describe("Filter violations by namespace"),
        severity: z.string().optional().describe("Filter by severity"),
      },
      async execute(_args: { namespace?: string; severity?: string }) {
        return notConfigured()
      },
    },

    rhacs_risk: {
      description: "Get the risk score and risk factors for a deployment from RHACS.",
      args: {
        deploymentId: z.string().describe("The RHACS deployment ID"),
      },
      async execute(_args: { deploymentId: string }) {
        return notConfigured()
      },
    },
  }
}

export default {
  schema: optionsSchema,
  server: async (_input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined

    if (!parsed?.centralUrl || !parsed.apiToken) {
      return {
        tool: { ...createUnconfiguredTools(), ...createUnconfiguredComplianceTools() },
      }
    }

    const client = createCentralClient(parsed.centralUrl, parsed.apiToken)

    return {
      tool: { ...createTools(client), ...createComplianceTools(client) },
    }
  },
} satisfies PluginModule
