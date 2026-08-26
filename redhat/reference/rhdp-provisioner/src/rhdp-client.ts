import { createApiClient } from "tinycode-plugin-redhat-shared/api"
import type { ApiClient } from "tinycode-plugin-redhat-shared/api"

export type CatalogItem = {
  id: string
  name: string
  description: string
  category: string
  provider: string
  estimatedTime?: string
}

export type ProvisionStatus = {
  orderId: string
  status: "pending" | "provisioning" | "ready" | "failed" | "retired"
  startedAt: string
  readyAt?: string
  consoleUrl?: string
  apiUrl?: string
  credentials?: { username: string; password: string }
  expiresAt?: string
  error?: string
}

export type ActiveEnvironment = {
  orderId: string
  catalogItemName: string
  status: string
  consoleUrl?: string
  expiresAt?: string
  startedAt: string
}

export type RhdpClient = {
  searchCatalog(query: string, category?: string): Promise<CatalogItem[]>
  provision(catalogItemId: string): Promise<ProvisionStatus>
  getStatus(orderId: string): Promise<ProvisionStatus>
  listActive(): Promise<ActiveEnvironment[]>
}

export function createRhdpClient(config: {
  apiUrl: string
  tokenFn: () => Promise<string>
}): RhdpClient {
  const client = createApiClient({
    baseUrl: config.apiUrl,
    tokenFn: config.tokenFn,
  })

  return {
    async searchCatalog(query, category) {
      const params: Record<string, string> = { q: query }
      if (category) params.category = category
      const res = await client.get<{ items: CatalogItem[] }>(
        "/catalog/search",
        params,
      )
      return res.data.items ?? []
    },

    async provision(catalogItemId) {
      const res = await client.post<ProvisionStatus>("/orders", {
        catalog_item_id: catalogItemId,
      })
      return res.data
    },

    async getStatus(orderId) {
      const res = await client.get<ProvisionStatus>(`/orders/${orderId}`)
      return res.data
    },

    async listActive() {
      const res = await client.get<{ environments: ActiveEnvironment[] }>(
        "/environments",
      )
      return res.data.environments ?? []
    },
  }
}
