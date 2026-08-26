import { createApiClient } from "tinycode-plugin-redhat-shared/api"

export type TrustyMetrics = {
  model: string
  driftScore: number
  biasMetrics: Record<string, number>
  featureDistributions: Record<string, { mean: number; stddev: number }>
}

export type TrustyAlert = {
  id: string
  type: "drift" | "bias"
  model: string
  metric: string
  threshold: number
  currentValue: number
  severity: "critical" | "warning" | "info"
  triggeredAt: string
}

export type TrustyAIClient = {
  getMetrics(model: string): Promise<TrustyMetrics>
  getAlerts(): Promise<TrustyAlert[]>
}

export function createTrustyAIClient(config: {
  apiUrl: string
  tokenFn?: () => Promise<string>
}): TrustyAIClient {
  const client = createApiClient({
    baseUrl: config.apiUrl,
    tokenFn: config.tokenFn ?? (async () => ""),
  })

  return {
    async getMetrics(model) {
      const res = await client.get<TrustyMetrics>(
        `/api/v1/models/${model}/metrics`,
      )
      return res.data
    },

    async getAlerts() {
      const res = await client.get<{ alerts: TrustyAlert[] }>(
        "/api/v1/alerts",
      )
      return res.data.alerts ?? []
    },
  }
}
