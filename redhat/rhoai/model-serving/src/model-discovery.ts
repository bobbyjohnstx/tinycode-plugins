import type { OcClient } from "tinycode-plugin-redhat-shared/oc"

type Condition = {
  type?: string
  status?: string
  reason?: string
  message?: string
}

type InferenceServiceItem = {
  metadata?: {
    name?: string
    namespace?: string
  }
  spec?: {
    predictor?: {
      model?: {
        modelFormat?: { name?: string }
        runtime?: string
        storageUri?: string
      }
    }
  }
  status?: {
    url?: string
    conditions?: Condition[]
  }
}

type InferenceServiceList = {
  items?: InferenceServiceItem[]
}

type ServingRuntimeItem = {
  metadata?: {
    name?: string
    namespace?: string
  }
  spec?: {
    supportedModelFormats?: Array<{ name?: string; autoSelect?: boolean }>
    containers?: Array<{ name?: string; image?: string }>
  }
}

type ServingRuntimeList = {
  items?: ServingRuntimeItem[]
}

type PodItem = {
  metadata?: {
    name?: string
  }
  spec?: {
    containers?: Array<{
      name?: string
      resources?: {
        limits?: Record<string, string>
        requests?: Record<string, string>
      }
    }>
  }
  status?: {
    phase?: string
  }
}

type PodList = {
  items?: PodItem[]
}

function isReady(conditions: Condition[] | undefined): boolean {
  if (!conditions) return false
  return conditions.some(
    (c) => c.type === "Ready" && c.status === "True",
  )
}

export function formatModelList(data: InferenceServiceList): string {
  const items = data.items ?? []
  if (items.length === 0) {
    return "No InferenceService resources found."
  }

  const lines = [`Models found: ${items.length}`, ""]
  for (const item of items) {
    const name = item.metadata?.name ?? "unknown"
    const ns = item.metadata?.namespace ?? "unknown"
    const format = item.spec?.predictor?.model?.modelFormat?.name ?? "unknown"
    const runtime = item.spec?.predictor?.model?.runtime ?? "unknown"
    const ready = isReady(item.status?.conditions) ? "Ready" : "Not Ready"
    const url = item.status?.url ?? "N/A"
    lines.push(`- ${name} (namespace: ${ns})`)
    lines.push(`  Format: ${format} | Runtime: ${runtime} | Status: ${ready}`)
    lines.push(`  URL: ${url}`)
  }

  return lines.join("\n")
}

export function formatModelStatus(
  item: InferenceServiceItem,
  pods: PodList,
): string {
  const name = item.metadata?.name ?? "unknown"
  const ns = item.metadata?.namespace ?? "unknown"
  const format = item.spec?.predictor?.model?.modelFormat?.name ?? "unknown"
  const runtime = item.spec?.predictor?.model?.runtime ?? "unknown"
  const ready = isReady(item.status?.conditions) ? "Ready" : "Not Ready"
  const url = item.status?.url ?? "N/A"
  const storageUri = item.spec?.predictor?.model?.storageUri ?? "N/A"

  const lines = [
    `Model: ${name}`,
    `Namespace: ${ns}`,
    `Format: ${format}`,
    `Runtime: ${runtime}`,
    `Status: ${ready}`,
    `URL: ${url}`,
    `Storage: ${storageUri}`,
  ]

  const conditions = item.status?.conditions ?? []
  if (conditions.length > 0) {
    lines.push("", "Conditions:")
    for (const c of conditions) {
      const cType = c.type ?? "unknown"
      const cStatus = c.status ?? "unknown"
      const cReason = c.reason ? ` (${c.reason})` : ""
      lines.push(`  - ${cType}: ${cStatus}${cReason}`)
    }
  }

  const podItems = pods.items ?? []
  if (podItems.length > 0) {
    lines.push("", `Pods: ${podItems.length}`)
    for (const pod of podItems) {
      const podName = pod.metadata?.name ?? "unknown"
      const phase = pod.status?.phase ?? "unknown"
      const gpuLimits = pod.spec?.containers
        ?.map((c) => c.resources?.limits?.["nvidia.com/gpu"])
        .filter(Boolean)
      const gpu = gpuLimits && gpuLimits.length > 0 ? gpuLimits.join(", ") : "none"
      lines.push(`  - ${podName} | Phase: ${phase} | GPU: ${gpu}`)
    }
  } else {
    lines.push("", "Pods: none found")
  }

  return lines.join("\n")
}

export function formatRuntimeList(data: ServingRuntimeList): string {
  const items = data.items ?? []
  if (items.length === 0) {
    return "No ServingRuntime resources found."
  }

  const lines = [`ServingRuntimes found: ${items.length}`, ""]
  for (const item of items) {
    const name = item.metadata?.name ?? "unknown"
    const formats = (item.spec?.supportedModelFormats ?? [])
      .map((f) => f.name ?? "unknown")
      .join(", ")
    const containers = item.spec?.containers ?? []
    const image = containers[0]?.image ?? "unknown"
    lines.push(`- ${name}`)
    lines.push(`  Supported formats: ${formats || "none"}`)
    lines.push(`  Image: ${image}`)
  }

  return lines.join("\n")
}

export async function listModels(
  oc: OcClient,
  namespace?: string,
): Promise<string> {
  const data = await oc.get<InferenceServiceList>("inferenceservices", {
    namespace,
  })
  return formatModelList(data)
}

export async function getModelStatus(
  oc: OcClient,
  modelName: string,
  namespace?: string,
): Promise<string> {
  const data = await oc.get<InferenceServiceList>(
    `inferenceservices/${modelName}`,
    { namespace },
  )
  const item: InferenceServiceItem = data as unknown as InferenceServiceItem
  const pods = await oc
    .get<PodList>("pods", {
      namespace,
      selector: `serving.kserve.io/inferenceservice=${modelName}`,
    })
    .catch(() => ({ items: [] }) as PodList)
  return formatModelStatus(item, pods)
}

export async function listRuntimes(
  oc: OcClient,
  namespace?: string,
): Promise<string> {
  const data = await oc.get<ServingRuntimeList>("servingruntimes", {
    namespace,
  })
  return formatRuntimeList(data)
}
