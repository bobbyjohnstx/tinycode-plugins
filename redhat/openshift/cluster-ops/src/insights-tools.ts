import type { ToolDefinition } from "tinycode-plugin"
import type { ApiClient } from "tinycode-plugin-redhat-shared/api"
import { z } from "zod"

type InsightsReport = {
  rule: {
    description: string
    total_risk: number
    resolution_set?: Array<{ resolution: string }>
    category?: { name: string }
  }
  impacted_date?: string
}

type InsightsRecommendationsResponse = {
  data: InsightsReport[]
  meta?: { count: number }
}

type InsightsCve = {
  id: string
  synopsis: string
  severity: number
  public_date?: string
  advisories_list?: string[]
  description?: string
}

type InsightsCvesResponse = {
  data: InsightsCve[]
  meta?: { total_items: number }
}

const RISK_LABELS: Record<number, string> = {
  1: "Low",
  2: "Moderate",
  3: "Important",
  4: "Critical",
}

const SEVERITY_LABELS: Record<number, string> = {
  1: "Low",
  2: "Moderate",
  3: "Important",
  4: "Critical",
}

const RISK_MAP: Record<string, string> = {
  critical: "4",
  important: "3",
  moderate: "2",
  low: "1",
}

function formatRecommendations(reports: InsightsReport[]): string {
  const sorted = [...reports].sort(
    (a, b) => (b.rule.total_risk ?? 0) - (a.rule.total_risk ?? 0),
  )

  const lines = [`Insights Advisor Recommendations: ${sorted.length}`, ""]
  for (const report of sorted) {
    const riskLevel = RISK_LABELS[report.rule.total_risk] ?? "Unknown"
    const riskNum = report.rule.total_risk ?? 0
    const description = report.rule.description ?? "No description"
    const category = report.rule.category?.name ?? "General"
    const resolution =
      report.rule.resolution_set?.[0]?.resolution ??
      "No remediation available"

    lines.push(`- [${riskLevel}, Risk ${riskNum}] ${description}`)
    lines.push(`  Impact: ${category}`)
    lines.push(`  Resolution: ${resolution}`)
    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

function formatCves(cves: InsightsCve[]): string {
  const sorted = [...cves].sort(
    (a, b) => (b.severity ?? 0) - (a.severity ?? 0),
  )

  const lines = [`CVE Exposure: ${sorted.length} CVEs`, ""]
  for (const cve of sorted) {
    const severityLabel = SEVERITY_LABELS[cve.severity] ?? "Unknown"
    const synopsis = cve.synopsis ?? cve.id
    const published = cve.public_date
      ? cve.public_date.substring(0, 10)
      : "Unknown"
    const advisory = cve.advisories_list?.[0] ?? "None"

    lines.push(`- ${cve.id} [${severityLabel}] -- ${synopsis}`)
    lines.push(`  Published: ${published} | Advisory: ${advisory}`)
    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

export function createInsightsTools(
  insightsClient: ApiClient,
  vulnerabilityClient: ApiClient,
  clusterId: string,
): Record<string, ToolDefinition> {
  return {
    ocp_insights_recommendations: {
      description:
        "Get Red Hat Insights Advisor recommendations for this cluster. Shows potential issues, risk levels, and remediation steps.",
      args: {
        riskLevel: z
          .enum(["critical", "important", "moderate", "low"])
          .optional()
          .describe("Filter by risk level"),
      },
      async execute(args: { riskLevel?: string }) {
        try {
          const params: Record<string, string> = {}
          if (args.riskLevel) {
            params["total_risk"] = RISK_MAP[args.riskLevel] ?? "4"
          }
          const response =
            await insightsClient.get<InsightsRecommendationsResponse>(
              `/system/${clusterId}/reports/`,
              params,
            )
          const reports = response.data.data ?? []
          if (reports.length === 0) {
            return "No Insights Advisor recommendations found for this cluster."
          }
          return formatRecommendations(reports)
        } catch (error) {
          return `Failed to get recommendations: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    ocp_insights_cves: {
      description:
        "Get container CVE exposure for this OpenShift cluster from the OCP Vulnerability service.",
      args: {
        severity: z
          .enum(["critical", "important", "moderate", "low"])
          .optional()
          .describe("Filter by CVE severity"),
      },
      async execute(args: { severity?: string }) {
        try {
          const params: Record<string, string> = {}
          if (args.severity) {
            params["cvss_severity"] = args.severity
          }
          const response =
            await vulnerabilityClient.get<InsightsCvesResponse>(
              `/systems/${clusterId}/cves`,
              params,
            )
          const cves = response.data.data ?? []
          if (cves.length === 0) {
            return "No CVEs found for this cluster."
          }
          return formatCves(cves)
        } catch (error) {
          return `Failed to get CVEs: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export function createUnconfiguredInsightsTools(): Record<
  string,
  ToolDefinition
> {
  return {
    ocp_insights_recommendations: {
      description:
        "Get Red Hat Insights Advisor recommendations for this cluster.",
      args: {
        riskLevel: z
          .enum(["critical", "important", "moderate", "low"])
          .optional()
          .describe("Filter by risk level"),
      },
      async execute() {
        return "Insights not configured. Set consoleOfflineToken and clusterId in plugin options to enable Insights integration."
      },
    },
    ocp_insights_cves: {
      description:
        "Get container CVE exposure for this OpenShift cluster from the OCP Vulnerability service.",
      args: {
        severity: z
          .enum(["critical", "important", "moderate", "low"])
          .optional()
          .describe("Filter by CVE severity"),
      },
      async execute() {
        return "Insights not configured. Set consoleOfflineToken and clusterId in plugin options to enable Insights integration."
      },
    },
  }
}
