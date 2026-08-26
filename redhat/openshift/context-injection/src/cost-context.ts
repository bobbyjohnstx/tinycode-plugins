import type { ApiClient } from "tinycode-plugin-redhat-shared/api"

export type CostContext = {
  namespace?: string
  monthlyEstimate: string
  topResource?: string
  topResourceCost?: string
  currency: string
  trend?: string
}

type CostValue = {
  value: number
  units: string
}

type CostTotal = {
  total?: CostValue
}

type ProjectEntry = {
  project: string
  values?: Array<{ cost?: CostTotal }>
}

type CostDataEntry = {
  date: string
  projects?: ProjectEntry[]
}

type CostReportResponse = {
  meta?: {
    total?: {
      cost?: CostTotal
    }
  }
  data?: CostDataEntry[]
}

function formatCurrency(value: number): string {
  return value >= 1 ? Math.round(value).toString() : value.toFixed(2)
}

function findTopProject(data: CostDataEntry[]): { name: string; cost: number } | null {
  const projectCosts = new Map<string, number>()

  for (const entry of data) {
    for (const project of entry.projects ?? []) {
      const cost = project.values?.[0]?.cost?.total?.value ?? 0
      const existing = projectCosts.get(project.project) ?? 0
      projectCosts.set(project.project, existing + cost)
    }
  }

  let topName: string | null = null
  let topCost = 0

  for (const [name, cost] of projectCosts) {
    if (cost > topCost) {
      topName = name
      topCost = cost
    }
  }

  if (topName === null || topCost === 0) return null
  return { name: topName, cost: topCost }
}

export async function queryCostContext(
  apiClient: ApiClient,
  clusterId: string,
  namespace?: string,
): Promise<CostContext | null> {
  try {
    const params: Record<string, string> = {
      "filter[cluster]": clusterId,
      "filter[time_scope_value]": "-1",
      "filter[time_scope_units]": "month",
    }
    if (namespace) {
      params["filter[project]"] = namespace
    }

    const response = await apiClient.get<CostReportResponse>(
      "/reports/openshift/costs/",
      params,
    )

    const report = response.data
    const totalCost = report.meta?.total?.cost?.total
    if (!totalCost || totalCost.value === 0) return null

    const currency = totalCost.units ?? "USD"
    const monthlyEstimate = formatCurrency(totalCost.value)

    const result: CostContext = {
      monthlyEstimate,
      currency,
    }

    if (namespace) {
      result.namespace = namespace
    }

    const topProject = findTopProject(report.data ?? [])
    if (topProject) {
      result.topResource = topProject.name
      result.topResourceCost = formatCurrency(topProject.cost)
    }

    return result
  } catch {
    return null
  }
}

export function formatCostBlock(cost: CostContext): string {
  const prefix = cost.currency === "USD" ? "$" : ""
  const parts: string[] = []
  if (cost.namespace) parts.push(`namespace=${cost.namespace}`)
  parts.push(`monthly-cost=${prefix}${cost.monthlyEstimate}`)
  if (cost.topResource) {
    const resourceCost = cost.topResourceCost ? `${prefix}${cost.topResourceCost}` : "?"
    parts.push(`top-resource=${cost.topResource} (${resourceCost}/mo)`)
  }
  if (cost.trend) parts.push(`trend=${cost.trend}`)
  return `<cost-context>${parts.join(" ")}</cost-context>`
}
