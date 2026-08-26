import type { OcClient } from "tinycode-plugin-redhat-shared/oc"

export type ManagedCluster = {
  name: string
  status: string
  version: string
  provider: string
  labels: Record<string, string>
}

export type ClusterDetail = {
  cluster: ManagedCluster
  addons: Array<{ name: string; status: string }>
}

export type Policy = {
  name: string
  namespace: string
  compliant: string
  severity: string
}

export type Violation = {
  policy: string
  cluster: string
  message: string
  severity: string
}

export type AcmApplication = {
  name: string
  namespace: string
  clusters: string[]
  syncStatus: string
}

type ManagedClusterCondition = {
  type: string
  status: string
}

type ManagedClusterResource = {
  metadata: {
    name: string
    labels?: Record<string, string>
  }
  status?: {
    conditions?: ManagedClusterCondition[]
    version?: { kubernetes?: string }
  }
}

type AddonResource = {
  metadata: { name: string }
  status?: {
    conditions?: Array<{ type: string; status: string }>
  }
}

type PolicyResource = {
  metadata: {
    name: string
    namespace: string
  }
  spec?: {
    severity?: string
  }
  status?: {
    compliant?: string
    status?: Array<{
      clustername: string
      compliant: string
    }>
    details?: Array<{
      templateMeta?: { name: string }
      history?: Array<{ message: string }>
    }>
  }
}

type AppResource = {
  metadata: {
    name: string
    namespace: string
  }
  status?: {
    sync?: { status?: string }
    operationState?: {
      syncResult?: {
        resources?: Array<{ namespace?: string }>
      }
    }
  }
  spec?: {
    destination?: { name?: string; namespace?: string }
  }
}

export type AcmClient = {
  listClusters(status?: string): Promise<ManagedCluster[]>
  getClusterDetail(name: string): Promise<ClusterDetail>
  listPolicies(namespace?: string): Promise<Policy[]>
  listViolations(cluster?: string): Promise<Violation[]>
  listApplications(cluster?: string): Promise<AcmApplication[]>
}

function parseClusterStatus(conditions?: ManagedClusterCondition[]): string {
  if (!conditions) return "Unknown"
  const available = conditions.find(
    (c) => c.type === "ManagedClusterConditionAvailable",
  )
  if (!available) return "Unknown"
  return available.status === "True" ? "Ready" : "NotReady"
}

function parseManagedCluster(resource: ManagedClusterResource): ManagedCluster {
  return {
    name: resource.metadata.name,
    status: parseClusterStatus(resource.status?.conditions),
    version: resource.status?.version?.kubernetes ?? "unknown",
    provider: resource.metadata.labels?.["cloud"] ?? "unknown",
    labels: resource.metadata.labels ?? {},
  }
}

export function createAcmClient(oc: OcClient): AcmClient {
  return {
    async listClusters(status?: string): Promise<ManagedCluster[]> {
      const result = await oc.get<{ items: ManagedClusterResource[] }>(
        "managedclusters",
      )
      let clusters = result.items.map(parseManagedCluster)
      if (status) {
        clusters = clusters.filter((c) => c.status === status)
      }
      return clusters
    },

    async getClusterDetail(name: string): Promise<ClusterDetail> {
      const clusterResource = await oc.get<ManagedClusterResource>(
        `managedcluster/${name}`,
      )
      const cluster = parseManagedCluster(clusterResource)

      const addonsResult = await oc.get<{ items: AddonResource[] }>(
        "managedclusteraddons",
        { namespace: name },
      )
      const addons = addonsResult.items.map((addon) => {
        const available = addon.status?.conditions?.find(
          (c) => c.type === "Available",
        )
        return {
          name: addon.metadata.name,
          status: available?.status === "True" ? "Available" : "Unavailable",
        }
      })

      return { cluster, addons }
    },

    async listPolicies(namespace?: string): Promise<Policy[]> {
      const opts = namespace ? { namespace } : undefined
      const result = await oc.get<{ items: PolicyResource[] }>(
        "policies.policy.open-cluster-management.io",
        opts ? { namespace: opts.namespace } : undefined,
      )
      return result.items.map((p) => ({
        name: p.metadata.name,
        namespace: p.metadata.namespace,
        compliant: p.status?.compliant ?? "Unknown",
        severity: p.spec?.severity ?? "low",
      }))
    },

    async listViolations(cluster?: string): Promise<Violation[]> {
      const result = await oc.get<{ items: PolicyResource[] }>(
        "policies.policy.open-cluster-management.io",
      )
      const violations: Violation[] = []
      for (const policy of result.items) {
        if (policy.status?.compliant !== "NonCompliant") continue
        const clusterStatuses = policy.status?.status ?? []
        for (const cs of clusterStatuses) {
          if (cs.compliant !== "NonCompliant") continue
          if (cluster && cs.clustername !== cluster) continue
          const message =
            policy.status?.details?.[0]?.history?.[0]?.message ??
            "Policy violation detected"
          violations.push({
            policy: policy.metadata.name,
            cluster: cs.clustername,
            message,
            severity: policy.spec?.severity ?? "low",
          })
        }
      }
      return violations
    },

    async listApplications(cluster?: string): Promise<AcmApplication[]> {
      const result = await oc.get<{ items: AppResource[] }>(
        "applications.argoproj.io",
      )
      let apps = result.items.map((app) => ({
        name: app.metadata.name,
        namespace: app.metadata.namespace,
        clusters: app.spec?.destination?.name
          ? [app.spec.destination.name]
          : [],
        syncStatus: app.status?.sync?.status ?? "Unknown",
      }))
      if (cluster) {
        apps = apps.filter((a) => a.clusters.includes(cluster))
      }
      return apps
    },
  }
}
