import type { ApiClient } from "tinycode-plugin-redhat-shared/api"
import { createApiClient } from "tinycode-plugin-redhat-shared/api"

export type Host = {
  id?: number
  name?: string
  operatingsystem_name?: string
  environment_name?: string
  global_status_label?: string
}

export type HostList = {
  total?: number
  results?: Host[]
}

export type Erratum = {
  errata_id?: string
  title?: string
  type?: string
  severity?: string
}

export type ErrataList = {
  total?: number
  results?: Erratum[]
}

export type ContentView = {
  id?: number
  name?: string
  label?: string
  composite?: boolean
  last_published?: string
}

export type ContentViewList = {
  total?: number
  results?: ContentView[]
}

export type LightspeedResponse = {
  answer?: string
}

export type SatelliteClient = {
  queryLightspeed(question: string): Promise<string>
  listHosts(search?: string): Promise<HostList>
  listErrata(search?: string, type?: string): Promise<ErrataList>
  listContentViews(): Promise<ContentViewList>
}

export function createSatelliteClient(
  satelliteUrl: string,
  username: string,
  password: string,
): SatelliteClient {
  const basicAuth = btoa(`${username}:${password}`)
  const api: ApiClient = createApiClient({
    baseUrl: satelliteUrl,
    tokenFn: async () => "",
    headers: {
      Authorization: `Basic ${basicAuth}`,
    },
  })

  return {
    async queryLightspeed(question: string): Promise<string> {
      const response = await api.post<LightspeedResponse>("/api/v2/lightspeed/chats", { question })
      return response.data.answer ?? "No response received."
    },

    async listHosts(search?: string): Promise<HostList> {
      const query: Record<string, string> = {}
      if (search) {
        query["search"] = search
      }
      const response = await api.get<HostList>(
        "/api/v2/hosts",
        Object.keys(query).length > 0 ? query : undefined,
      )
      return response.data
    },

    async listErrata(search?: string, type?: string): Promise<ErrataList> {
      const query: Record<string, string> = {}
      if (search) {
        query["search"] = search
      }
      if (type) {
        query["type"] = type
      }
      const response = await api.get<ErrataList>(
        "/api/v2/errata",
        Object.keys(query).length > 0 ? query : undefined,
      )
      return response.data
    },

    async listContentViews(): Promise<ContentViewList> {
      const response = await api.get<ContentViewList>("/api/v2/content_views")
      return response.data
    },
  }
}
