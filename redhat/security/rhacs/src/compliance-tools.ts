import type { ToolDefinition } from "tinycode-plugin"
import type { CentralClient, ComplianceScanResult } from "./central-client"
import { z } from "zod"

const severityOrder: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

function formatScanResult(result: ComplianceScanResult): string {
  const profiles = result.profiles ?? []
  if (profiles.length === 0) {
    return "No compliance scan results available."
  }

  const lines: string[] = []

  for (const profile of profiles) {
    const passing = profile.passing ?? 0
    const failing = profile.failing ?? 0
    const total = passing + failing + (profile.errors ?? 0)
    const pct = total > 0 ? Math.round((passing / total) * 100) : 0

    lines.push(`Profile: ${profile.profileName ?? "unknown"}`)
    lines.push(`Passing: ${passing}/${total} (${pct}%)`)
    lines.push(`Failing: ${failing}`)

    const controls = profile.controls ?? []
    const failingControls = controls.filter((c) => c.status === "FAIL")

    if (failingControls.length > 0) {
      failingControls.sort((a, b) => {
        const aOrder = severityOrder[a.severity ?? "LOW"] ?? 4
        const bOrder = severityOrder[b.severity ?? "LOW"] ?? 4
        return aOrder - bOrder
      })

      lines.push("")
      lines.push("Failing Controls:")
      for (const ctrl of failingControls) {
        const severity = ctrl.severity ?? "UNKNOWN"
        const name = ctrl.name ?? "unknown"
        lines.push(`- [${severity}] ${name}`)
        if (ctrl.remediation) {
          lines.push(`  Remediation: ${ctrl.remediation}`)
        }
      }
    }

    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

function notConfigured(): string {
  return "RHACS plugin is not configured. Set centralUrl and apiToken in plugin options."
}

export function createComplianceTools(client: CentralClient): Record<string, ToolDefinition> {
  return {
    rhacs_compliance_scan: {
      description:
        "Run or get compliance scan results from RHACS. If scanConfigId is provided, triggers that scan config and returns results. Otherwise lists available scan configurations.",
      args: {
        scanConfigId: z
          .string()
          .optional()
          .describe("Scan configuration ID to trigger. If omitted, lists available configs."),
      },
      async execute(args: { scanConfigId?: string }) {
        try {
          if (!args.scanConfigId) {
            const configs = await client.getComplianceResults()
            const results = configs.results ?? []
            if (results.length === 0) {
              return "No compliance scan results available. Provide a scanConfigId to trigger a scan."
            }
            const lines: string[] = ["Available compliance scan results:", ""]
            for (const r of results) {
              lines.push(`- Scan Config: ${r.scanConfigId ?? "unknown"}`)
              const profiles = r.profiles ?? []
              for (const p of profiles) {
                const passing = p.passing ?? 0
                const failing = p.failing ?? 0
                const total = passing + failing + (p.errors ?? 0)
                lines.push(`  Profile: ${p.profileName ?? "unknown"} (${passing}/${total} passing)`)
              }
            }
            return lines.join("\n")
          }

          await client.runComplianceScan(args.scanConfigId)
          const results = await client.getComplianceResults(args.scanConfigId)
          const scanResults = results.results ?? []
          const match = scanResults.find((r) => r.scanConfigId === args.scanConfigId)

          if (!match) {
            return `Scan triggered for config ${args.scanConfigId} but no results available yet.`
          }

          return formatScanResult(match)
        } catch (error) {
          return `Failed to run compliance scan: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    rhacs_compliance_status: {
      description:
        "Get compliance summary across all profiles from RHACS. Shows pass rate and top failing controls per profile.",
      args: {
        profileName: z
          .string()
          .optional()
          .describe("Filter results to a specific profile name"),
      },
      async execute(args: { profileName?: string }) {
        try {
          const data = await client.getComplianceProfiles()
          let profiles = data.profiles ?? []

          if (profiles.length === 0) {
            return "No compliance profiles found."
          }

          if (args.profileName) {
            profiles = profiles.filter((p) => p.name === args.profileName)
            if (profiles.length === 0) {
              return `No compliance profile found matching "${args.profileName}".`
            }
          }

          const lines: string[] = ["Compliance Status Summary", ""]
          const header = "Profile                                  | Passing | Total | Status"
          const separator = "-".repeat(header.length)
          lines.push(header)
          lines.push(separator)

          for (const p of profiles) {
            const total = p.totalControls ?? 0
            const passing = p.passingControls ?? 0
            const pct = total > 0 ? Math.round((passing / total) * 100) : 0
            const name = (p.name ?? "unknown").padEnd(40)
            const passingStr = `${pct}%`.padEnd(9)
            const totalStr = String(total).padEnd(7)
            const status = pct === 100 ? "PASS" : "FAIL"
            lines.push(`${name} | ${passingStr} | ${totalStr} | ${status}`)
          }

          return lines.join("\n")
        } catch (error) {
          return `Failed to get compliance status: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredComplianceTools(): Record<string, ToolDefinition> {
  return {
    rhacs_compliance_scan: {
      description:
        "Run or get compliance scan results from RHACS. If scanConfigId is provided, triggers that scan config and returns results. Otherwise lists available scan configurations.",
      args: {
        scanConfigId: z
          .string()
          .optional()
          .describe("Scan configuration ID to trigger. If omitted, lists available configs."),
      },
      async execute(_args: { scanConfigId?: string }) {
        return notConfigured()
      },
    },

    rhacs_compliance_status: {
      description:
        "Get compliance summary across all profiles from RHACS. Shows pass rate and top failing controls per profile.",
      args: {
        profileName: z
          .string()
          .optional()
          .describe("Filter results to a specific profile name"),
      },
      async execute(_args: { profileName?: string }) {
        return notConfigured()
      },
    },
  }
}
