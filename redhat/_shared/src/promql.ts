import { createApiClient, type ApiClient } from "./api"

export type PromQLClientConfig = {
  baseUrl: string
  tokenFn: () => Promise<string>
  alertManagerUrl?: string
}

export type PromQLResult = {
  resultType: "vector" | "matrix" | "scalar" | "string"
  result: PromQLVector[] | PromQLMatrix[] | [number, string]
}

export type PromQLVector = {
  metric: Record<string, string>
  value: [number, string]
}

export type PromQLMatrix = {
  metric: Record<string, string>
  values: [number, string][]
}

export type Alert = {
  labels: Record<string, string>
  annotations: Record<string, string>
  state: "firing" | "pending" | "suppressed"
  activeAt: string
  value: string
  fingerprint: string
}

export type AlertMatcher = {
  name: string
  value: string
  isRegex: boolean
  isEqual: boolean
}

export type PromQLClient = {
  instantQuery(query: string, time?: string): Promise<PromQLResult>
  rangeQuery(query: string, start: string, end: string, step: string): Promise<PromQLResult>
  alerts(active?: boolean, silenced?: boolean): Promise<Alert[]>
  silenceAlert(matchers: AlertMatcher[], duration: string, createdBy: string, comment: string): Promise<string>
}

type PrometheusResponse = {
  status: "success" | "error"
  data: PromQLResult
  errorType?: string
  error?: string
}

type SilenceResponse = {
  silenceID: string
}

export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhdw])$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use e.g. "30s", "5m", "1h", "7d", "1w"`)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2]!

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  }

  return value * multipliers[unit]!
}

export function createPromQLClient(config: PromQLClientConfig): PromQLClient {
  const prometheusClient = createApiClient({
    baseUrl: config.baseUrl,
    tokenFn: config.tokenFn,
  })

  const alertManagerClient: ApiClient = config.alertManagerUrl
    ? createApiClient({ baseUrl: config.alertManagerUrl, tokenFn: config.tokenFn })
    : prometheusClient

  return {
    async instantQuery(query: string, time?: string): Promise<PromQLResult> {
      const params: Record<string, string> = { query }
      if (time) {
        params.time = time
      }
      const response = await prometheusClient.get<PrometheusResponse>("/api/v1/query", params)
      return response.data.data
    },

    async rangeQuery(query: string, start: string, end: string, step: string): Promise<PromQLResult> {
      const params: Record<string, string> = { query, start, end, step }
      const response = await prometheusClient.get<PrometheusResponse>("/api/v1/query_range", params)
      return response.data.data
    },

    async alerts(active?: boolean, silenced?: boolean): Promise<Alert[]> {
      const params: Record<string, string> = {}
      if (active !== undefined) {
        params.active = String(active)
      }
      if (silenced !== undefined) {
        params.silenced = String(silenced)
      }
      const response = await alertManagerClient.get<Alert[]>("/api/v2/alerts", params)
      return response.data
    },

    async silenceAlert(
      matchers: AlertMatcher[],
      duration: string,
      createdBy: string,
      comment: string,
    ): Promise<string> {
      const now = new Date()
      const endsAt = new Date(now.getTime() + parseDuration(duration))

      const body = {
        matchers,
        startsAt: now.toISOString(),
        endsAt: endsAt.toISOString(),
        createdBy,
        comment,
      }

      const response = await alertManagerClient.post<SilenceResponse>("/api/v2/silences", body)
      return response.data.silenceID
    },
  }
}
