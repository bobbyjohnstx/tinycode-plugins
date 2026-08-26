import type { ApiClient } from "tinycode-plugin-redhat-shared/api"
import { createApiClient } from "tinycode-plugin-redhat-shared/api"

export type ImageScanResult = {
  image?: {
    name?: { fullName?: string }
  }
  components?: Array<{
    name?: string
    version?: string
    vulns?: Array<{
      cve?: string
      severity?: string
      cvss?: number
      link?: string
      fixedBy?: string
    }>
  }>
}

export type PolicyViolation = {
  name?: string
  description?: string
  severity?: string
  failingCheck?: boolean
}

export type ImageCheckResult = {
  alerts?: Array<{
    policy?: PolicyViolation
  }>
}

export type DeploymentCheckResult = {
  alerts?: Array<{
    policy?: PolicyViolation
  }>
}

export type Alert = {
  id?: string
  policy?: { name?: string; severity?: string; description?: string }
  deployment?: { name?: string; namespace?: string; clusterName?: string }
  state?: string
  time?: string
}

export type AlertListResult = {
  alerts?: Alert[]
}

export type RiskResult = {
  subject?: { id?: string; namespace?: string; name?: string; type?: string }
  score?: number
  results?: Array<{
    name?: string
    factors?: Array<{ message?: string }>
  }>
}

export type ComplianceProfile = {
  id?: string
  name?: string
  description?: string
  totalControls?: number
  passingControls?: number
  failingControls?: number
  profileVersion?: string
}

export type ComplianceControl = {
  id?: string
  name?: string
  description?: string
  status?: string
  severity?: string
  remediation?: string
}

export type ComplianceScanResult = {
  scanConfigId?: string
  profiles?: Array<{
    profileName?: string
    passing?: number
    failing?: number
    errors?: number
    controls?: ComplianceControl[]
  }>
}

export type CentralClient = {
  scanImage(imageName: string): Promise<ImageScanResult>
  checkImage(imageName: string): Promise<ImageCheckResult>
  checkDeployment(yaml: string): Promise<DeploymentCheckResult>
  listAlerts(query?: Record<string, string>): Promise<AlertListResult>
  getDeploymentRisk(deploymentId: string): Promise<RiskResult>
  getComplianceProfiles(): Promise<{ profiles?: ComplianceProfile[] }>
  runComplianceScan(scanConfigId: string): Promise<ComplianceScanResult>
  getComplianceResults(scanConfigId?: string): Promise<{ results?: ComplianceScanResult[] }>
}

export function createCentralClient(centralUrl: string, apiToken: string): CentralClient {
  const api: ApiClient = createApiClient({
    baseUrl: centralUrl,
    tokenFn: async () => apiToken,
  })

  return {
    async scanImage(imageName: string): Promise<ImageScanResult> {
      const response = await api.post<ImageScanResult>("/v1/images/scan", {
        imageName,
      })
      return response.data
    },

    async checkImage(imageName: string): Promise<ImageCheckResult> {
      const response = await api.post<ImageCheckResult>("/v1/images/check", {
        imageName,
      })
      return response.data
    },

    async checkDeployment(yaml: string): Promise<DeploymentCheckResult> {
      const response = await api.post<DeploymentCheckResult>("/v1/deploymentcheck", {
        resources: yaml,
      })
      return response.data
    },

    async listAlerts(query?: Record<string, string>): Promise<AlertListResult> {
      const response = await api.get<AlertListResult>("/v1/alerts", query)
      return response.data
    },

    async getDeploymentRisk(deploymentId: string): Promise<RiskResult> {
      const response = await api.get<RiskResult>(`/v1/deployments/${encodeURIComponent(deploymentId)}/risk`)
      return response.data
    },

    async getComplianceProfiles(): Promise<{ profiles?: ComplianceProfile[] }> {
      const response = await api.get<{ profiles?: ComplianceProfile[] }>("/v2/compliance/profiles")
      return response.data
    },

    async runComplianceScan(scanConfigId: string): Promise<ComplianceScanResult> {
      const response = await api.post<ComplianceScanResult>(
        `/v2/compliance/scan/configurations/${encodeURIComponent(scanConfigId)}/run`,
        {},
      )
      return response.data
    },

    async getComplianceResults(scanConfigId?: string): Promise<{ results?: ComplianceScanResult[] }> {
      const query = scanConfigId ? { scanConfigId } : undefined
      const response = await api.get<{ results?: ComplianceScanResult[] }>("/v2/compliance/results", query)
      return response.data
    },
  }
}
