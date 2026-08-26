import type { OcClient } from "tinycode-plugin-redhat-shared/oc"

export type AlertSummary = {
  critical: Array<{ name: string; namespace: string }>
  warning: Array<{ name: string; namespace: string }>
  info: number
}

export type ClusterContext = {
  cluster: string
  version: string
  nodes: string
  namespace: string
  operators: string[]
  alerts?: AlertSummary
}

type NodeItem = {
  metadata: { labels?: Record<string, string> }
}

type CsvItem = {
  metadata?: { name?: string }
  spec?: { displayName?: string }
}

type AlertItem = {
  labels?: { alertname?: string; namespace?: string; severity?: string }
}

export async function queryFiringAlerts(oc: OcClient): Promise<AlertSummary | null> {
  try {
    const output = await oc.raw(
      "-n", "openshift-monitoring", "exec", "-c", "alertmanager", "alertmanager-main-0",
      "--", "curl", "-s", "http://localhost:9093/api/v2/alerts?active=true&silenced=false",
    )
    const alerts = JSON.parse(output) as AlertItem[]
    const critical: AlertSummary["critical"] = []
    const warning: AlertSummary["warning"] = []
    let info = 0
    for (const alert of alerts) {
      const severity = alert.labels?.severity ?? ""
      const name = alert.labels?.alertname ?? "Unknown"
      const ns = alert.labels?.namespace ?? ""
      if (severity === "critical") critical.push({ name, namespace: ns })
      else if (severity === "warning") warning.push({ name, namespace: ns })
      else if (severity === "info") info++
    }
    if (critical.length === 0 && warning.length === 0 && info === 0) return null
    return { critical, warning, info }
  } catch {
    return null
  }
}

export async function queryClusterContext(oc: OcClient): Promise<ClusterContext | null> {
  if (!(await oc.isAvailable())) return null
  if (!(await oc.isLoggedIn())) return null

  const [versionResult, nodesResult, contextResult, csvResult, alertResult] = await Promise.allSettled([
    oc.version(),
    oc.get<{ items: NodeItem[] }>("nodes"),
    oc.raw("config", "current-context"),
    oc.raw("get", "csv", "-A", "-o", "json"),
    queryFiringAlerts(oc),
  ])

  let version = "unknown"
  if (versionResult.status === "fulfilled") {
    const v = versionResult.value
    if (v.openshiftVersion) {
      version = v.openshiftVersion
    } else if (v.serverVersion) {
      version = `${v.serverVersion.major}.${v.serverVersion.minor}`
    }
  }

  let nodes = "unknown"
  if (nodesResult.status === "fulfilled") {
    const items = nodesResult.value.items ?? []
    const total = items.length
    let controlPlane = 0
    let worker = 0
    for (const node of items) {
      const labels = node.metadata?.labels ?? {}
      if ("node-role.kubernetes.io/control-plane" in labels || "node-role.kubernetes.io/master" in labels) {
        controlPlane++
      }
      if ("node-role.kubernetes.io/worker" in labels) {
        worker++
      }
    }
    nodes = `${total} (${controlPlane} control-plane, ${worker} worker)`
  }

  let cluster = "unknown"
  let namespace = "unknown"
  if (contextResult.status === "fulfilled") {
    const contextStr = contextResult.value.trim()
    const parts = contextStr.split("/")
    if (parts.length >= 2) {
      namespace = parts[0] ?? "unknown"
      cluster = parts[1] ?? "unknown"
    } else {
      cluster = contextStr || "unknown"
    }
  }

  let operators: string[] = []
  if (csvResult.status === "fulfilled") {
    try {
      const csvData = JSON.parse(csvResult.value) as { items?: CsvItem[] }
      operators = (csvData.items ?? [])
        .map((item) => {
          if (item.spec?.displayName) return item.spec.displayName
          const name = item.metadata?.name ?? ""
          return name.replace(/\.v\d+.*$/, "")
        })
        .filter(Boolean)
    } catch {
      operators = []
    }
  }

  const alerts = alertResult.status === "fulfilled" ? alertResult.value : null

  return { cluster, version, nodes, namespace, operators, ...(alerts ? { alerts } : {}) }
}
