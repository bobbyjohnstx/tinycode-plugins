import type { ApiClient } from "tinycode-plugin-redhat-shared/api"
import { createApiClient } from "tinycode-plugin-redhat-shared/api"

export type PackageCheckResult = {
  found?: boolean
  ecosystem?: string
  name?: string
  version?: string
  lightwellVersion?: string
  patchAvailable?: boolean
  cveCount?: number
  cves?: Array<{
    id?: string
    severity?: string
    fixedIn?: string
  }>
}

export type OsvVulnerability = {
  id?: string
  summary?: string
  severity?: string
  published?: string
  modified?: string
  affected?: Array<{
    package?: string
    versions?: string[]
  }>
  references?: Array<{
    type?: string
    url?: string
  }>
}

export type OsvResult = {
  vulnerabilities?: OsvVulnerability[]
}

export type ProvenanceResult = {
  verified?: boolean
  buildType?: string
  builder?: string
  sourceUri?: string
  digest?: string
  slsaLevel?: string
  attestations?: Array<{
    type?: string
    verified?: boolean
    issuer?: string
  }>
}

export type LightwellClient = {
  checkPackage(ecosystem: string, name: string, version: string): Promise<PackageCheckResult>
  queryOsv(ecosystem: string, name: string): Promise<OsvResult>
  getProvenance(ecosystem: string, name: string, version: string): Promise<ProvenanceResult>
}

export function createLightwellClient(baseUrl: string, token?: string): LightwellClient {
  const api: ApiClient = createApiClient({
    baseUrl,
    tokenFn: async () => token ?? null,
  })

  return {
    async checkPackage(ecosystem: string, name: string, version: string): Promise<PackageCheckResult> {
      const response = await api.get<PackageCheckResult>(
        `/api/v1/packages/${ecosystem}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      )
      return response.data
    },

    async queryOsv(ecosystem: string, name: string): Promise<OsvResult> {
      const response = await api.get<OsvResult>(
        `/api/v1/osv/${ecosystem}/${encodeURIComponent(name)}`,
      )
      return response.data
    },

    async getProvenance(ecosystem: string, name: string, version: string): Promise<ProvenanceResult> {
      const response = await api.get<ProvenanceResult>(
        `/api/v1/provenance/${ecosystem}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      )
      return response.data
    },
  }
}
