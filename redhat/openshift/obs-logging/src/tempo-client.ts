import { createApiClient } from "tinycode-plugin-redhat-shared/api"

export type TraceSummary = {
  traceID: string
  rootServiceName: string
  rootTraceName: string
  durationMs: number
  startTimeUnixNano: string
  spanCount: number
}

export type Span = {
  traceID: string
  spanID: string
  operationName: string
  serviceName: string
  duration: number
  startTime: number
  tags: Record<string, string>
  children: Span[]
}

export type TraceDetail = {
  traceID: string
  spans: Span[]
}

export type TempoClient = {
  searchTraces(
    service: string,
    operation?: string,
    minDuration?: string,
    limit?: number,
  ): Promise<TraceSummary[]>
  getTrace(traceId: string): Promise<TraceDetail>
}

export function createTempoClient(config: {
  baseUrl: string
  tokenFn?: () => Promise<string>
}): TempoClient {
  const client = createApiClient({
    baseUrl: config.baseUrl,
    tokenFn: config.tokenFn ?? (async () => null),
  })

  return {
    async searchTraces(service, operation, minDuration, limit) {
      const params: Record<string, string> = { "service.name": service }
      if (operation) params.name = operation
      if (minDuration) params.minDuration = minDuration
      if (limit) params.limit = String(limit)

      const res = await client.get<{ traces: TraceSummary[] }>(
        "/api/search",
        params,
      )
      return res.data.traces ?? []
    },

    async getTrace(traceId) {
      const res = await client.get<TraceDetail>(`/api/traces/${traceId}`)
      return res.data
    },
  }
}
