import type { ApiClient } from "tinycode-plugin-redhat-shared/api"
import { createApiClient } from "tinycode-plugin-redhat-shared/api"

export type CatalogEntity = {
  apiVersion?: string
  kind?: string
  metadata?: {
    name?: string
    namespace?: string
    description?: string
    title?: string
    annotations?: Record<string, string>
    tags?: string[]
    links?: Array<{ url?: string; title?: string; icon?: string }>
    uid?: string
  }
  spec?: {
    type?: string
    lifecycle?: string
    owner?: string
    system?: string
    definition?: string
    providesApis?: string[]
    consumesApis?: string[]
    dependsOn?: string[]
    dependencyOf?: string[]
    [key: string]: unknown
  }
  relations?: Array<{
    type?: string
    targetRef?: string
  }>
}

export type CatalogEntityList = CatalogEntity[]

export type RhdhClient = {
  searchEntities(filter: Record<string, string>): Promise<CatalogEntityList>
  getEntity(kind: string, namespace: string, name: string): Promise<CatalogEntity>
  getTechDocs(namespace: string, kind: string, name: string): Promise<string>
}

export function createRhdhClient(baseUrl: string, apiToken?: string): RhdhClient {
  const api: ApiClient = createApiClient({
    baseUrl,
    tokenFn: async () => apiToken ?? null,
  })

  return {
    async searchEntities(filter: Record<string, string>): Promise<CatalogEntityList> {
      const query: Record<string, string> = {}
      for (const [key, value] of Object.entries(filter)) {
        query[`filter`] = query[`filter`]
          ? `${query[`filter`]},${key}=${value}`
          : `${key}=${value}`
      }
      const response = await api.get<CatalogEntityList>("/api/catalog/entities", query)
      return response.data
    },

    async getEntity(kind: string, namespace: string, name: string): Promise<CatalogEntity> {
      const response = await api.get<CatalogEntity>(
        `/api/catalog/entities/by-name/${kind}/${namespace}/${name}`,
      )
      return response.data
    },

    async getTechDocs(namespace: string, kind: string, name: string): Promise<string> {
      const url = `/api/techdocs/static/docs/${namespace}/${kind}/${name}/index.html`
      const response = await api.get<string>(url)
      return typeof response.data === "string" ? response.data : JSON.stringify(response.data)
    },
  }
}
