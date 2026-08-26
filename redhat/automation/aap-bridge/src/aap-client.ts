import type { ApiClient } from "tinycode-plugin-redhat-shared/api"
import { createApiClient } from "tinycode-plugin-redhat-shared/api"

export type JobTemplate = {
  id?: number
  name?: string
  description?: string
  last_job_run?: string
  status?: string
}

export type JobTemplateList = {
  count?: number
  results?: JobTemplate[]
}

export type JobLaunchResult = {
  id?: number
  job?: number
  status?: string
  type?: string
}

export type Job = {
  id?: number
  name?: string
  status?: string
  started?: string
  finished?: string
  failed?: boolean
  elapsed?: number
}

export type Inventory = {
  id?: number
  name?: string
  description?: string
  total_hosts?: number
  hosts_with_active_failures?: number
}

export type InventoryList = {
  count?: number
  results?: Inventory[]
}

export type Collection = {
  namespace?: { name?: string }
  name?: string
  description?: string
  latest_version?: { version?: string }
}

export type CollectionList = {
  count?: number
  results?: Collection[]
}

export type AapClient = {
  listTemplates(search?: string): Promise<JobTemplateList>
  launchJob(templateId: number, extraVars?: string): Promise<JobLaunchResult>
  getJobStatus(jobId: number): Promise<Job>
  getJobOutput(jobId: number): Promise<string>
  listInventories(search?: string): Promise<InventoryList>
  searchCollections(keyword: string): Promise<CollectionList>
}

export function createAapClient(controllerUrl: string, oauthToken: string): AapClient {
  const api: ApiClient = createApiClient({
    baseUrl: controllerUrl,
    tokenFn: async () => oauthToken,
  })

  return {
    async listTemplates(search?: string): Promise<JobTemplateList> {
      const query: Record<string, string> = {}
      if (search) {
        query["search"] = search
      }
      const response = await api.get<JobTemplateList>(
        "/api/v2/job_templates/",
        Object.keys(query).length > 0 ? query : undefined,
      )
      return response.data
    },

    async launchJob(templateId: number, extraVars?: string): Promise<JobLaunchResult> {
      const body: Record<string, unknown> = {}
      if (extraVars) {
        body["extra_vars"] = extraVars
      }
      const response = await api.post<JobLaunchResult>(
        `/api/v2/job_templates/${templateId}/launch/`,
        Object.keys(body).length > 0 ? body : undefined,
      )
      return response.data
    },

    async getJobStatus(jobId: number): Promise<Job> {
      const response = await api.get<Job>(`/api/v2/jobs/${jobId}/`)
      return response.data
    },

    async getJobOutput(jobId: number): Promise<string> {
      const response = await api.get<string>(`/api/v2/jobs/${jobId}/stdout/?format=txt`)
      return response.data
    },

    async listInventories(search?: string): Promise<InventoryList> {
      const query: Record<string, string> = {}
      if (search) {
        query["search"] = search
      }
      const response = await api.get<InventoryList>(
        "/api/v2/inventories/",
        Object.keys(query).length > 0 ? query : undefined,
      )
      return response.data
    },

    async searchCollections(keyword: string): Promise<CollectionList> {
      const response = await api.get<CollectionList>("/api/v2/collections/", {
        keyword,
      })
      return response.data
    },
  }
}
