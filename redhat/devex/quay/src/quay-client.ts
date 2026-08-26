import type { ApiClient } from "tinycode-plugin-redhat-shared/api"
import { createApiClient } from "tinycode-plugin-redhat-shared/api"

export type QuayRepository = {
  namespace?: string
  name?: string
  description?: string
  star_count?: number
  last_modified?: number
  is_public?: boolean
}

export type QuaySearchResult = {
  results?: QuayRepository[]
}

export type QuayTag = {
  name?: string
  manifest_digest?: string
  size?: number
  last_modified?: string
  start_ts?: number
}

export type QuayTagList = {
  tags?: QuayTag[]
  has_additional?: boolean
}

export type QuayManifestInfo = {
  digest?: string
  is_manifest_list?: boolean
  manifest_data?: string
  config_media_type?: string
  layers_compressed_size?: number
}

export type QuayVulnerability = {
  Name?: string
  Severity?: string
  FixedBy?: string
  Link?: string
  Description?: string
}

export type QuayFeature = {
  Name?: string
  Version?: string
  Vulnerabilities?: QuayVulnerability[]
}

export type QuaySecurityResult = {
  status?: string
  data?: {
    Layer?: {
      Features?: QuayFeature[]
    }
  }
}

export type QuayLabel = {
  id?: string
  key?: string
  value?: string
  source_type?: string
  media_type?: string
}

export type QuayLabelList = {
  labels?: QuayLabel[]
}

export type QuayClient = {
  searchRepositories(query: string): Promise<QuaySearchResult>
  listTags(namespace: string, name: string): Promise<QuayTagList>
  getManifest(namespace: string, name: string, digest: string): Promise<QuayManifestInfo>
  getVulnerabilities(namespace: string, name: string, digest: string): Promise<QuaySecurityResult>
  getLabels(namespace: string, name: string, digest: string): Promise<QuayLabelList>
}

export function createQuayClient(registryUrl: string, apiToken?: string): QuayClient {
  const api: ApiClient = createApiClient({
    baseUrl: registryUrl,
    tokenFn: async () => apiToken ?? "",
  })

  return {
    async searchRepositories(query: string): Promise<QuaySearchResult> {
      const response = await api.get<QuaySearchResult>("/api/v1/find/repositories", { query })
      return response.data
    },

    async listTags(namespace: string, name: string): Promise<QuayTagList> {
      const response = await api.get<QuayTagList>(`/api/v1/repository/${namespace}/${name}/tag/`)
      return response.data
    },

    async getManifest(namespace: string, name: string, digest: string): Promise<QuayManifestInfo> {
      const response = await api.get<QuayManifestInfo>(
        `/api/v1/repository/${namespace}/${name}/manifest/${digest}`,
      )
      return response.data
    },

    async getVulnerabilities(
      namespace: string,
      name: string,
      digest: string,
    ): Promise<QuaySecurityResult> {
      const response = await api.get<QuaySecurityResult>(
        `/api/v1/repository/${namespace}/${name}/manifest/${digest}/security`,
      )
      return response.data
    },

    async getLabels(namespace: string, name: string, digest: string): Promise<QuayLabelList> {
      const response = await api.get<QuayLabelList>(
        `/api/v1/repository/${namespace}/${name}/manifest/${digest}/labels`,
      )
      return response.data
    },
  }
}
