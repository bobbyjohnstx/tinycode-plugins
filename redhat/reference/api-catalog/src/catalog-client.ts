export type ApiEntry = {
  name: string
  description: string
  version: string
  basePath: string
}

export type ApiEndpoint = {
  method: string
  path: string
  description: string
  params: string[]
}

export const API_CATALOG: ApiEntry[] = [
  { name: "cost-management", description: "Cost Management API for OpenShift and cloud resources", version: "v1", basePath: "/api/cost-management/v1" },
  { name: "insights", description: "Red Hat Insights advisor API", version: "v1", basePath: "/api/insights/v1" },
  { name: "vulnerability", description: "Vulnerability assessment and CVE management", version: "v1", basePath: "/api/vulnerability/v1" },
  { name: "patch", description: "Content and patch management for RHEL systems", version: "v3", basePath: "/api/patch/v3" },
  { name: "inventory", description: "Host-based Inventory for managed systems", version: "v1", basePath: "/api/inventory/v1" },
  { name: "notifications", description: "Notifications service for event delivery", version: "v1", basePath: "/api/notifications/v1" },
  { name: "integrations", description: "Third-party integrations for notifications", version: "v1", basePath: "/api/integrations/v1" },
  { name: "rbac", description: "Role-based access control", version: "v1", basePath: "/api/rbac/v1" },
  { name: "sources", description: "Cloud source management", version: "v3", basePath: "/api/sources/v3.1" },
  { name: "image-builder", description: "RHEL image composition service", version: "v1", basePath: "/api/image-builder/v1" },
  { name: "edge", description: "Fleet Management for Edge Devices", version: "v1", basePath: "/api/edge/v1" },
  { name: "subscriptions", description: "Subscription management and watch", version: "v1", basePath: "/api/rhsm-subscriptions/v1" },
  { name: "compliance", description: "OpenSCAP compliance and policy management", version: "v2", basePath: "/api/compliance/v2" },
  { name: "ros", description: "Resource Optimization for cloud instances", version: "v1", basePath: "/api/ros/v1" },
  { name: "malware-detection", description: "Malware detection for RHEL systems", version: "v1", basePath: "/api/malware-detection/v1" },
  { name: "tasks", description: "Tasks service for async job management", version: "v1", basePath: "/api/tasks/v1" },
  { name: "config-manager", description: "Cloud connector configuration", version: "v2", basePath: "/api/config-manager/v2" },
  { name: "playbook-dispatcher", description: "Playbook execution dispatcher for Remediations", version: "v1", basePath: "/api/playbook-dispatcher/v1" },
  { name: "remediations", description: "Remediation playbook generation", version: "v1", basePath: "/api/remediations/v1" },
  { name: "drift", description: "System comparison and baseline drift", version: "v1", basePath: "/api/drift/v1" },
  { name: "policies", description: "Custom alert policies for system events", version: "v1", basePath: "/api/policies/v1" },
  { name: "gathering", description: "Insights Operator gathering conditions", version: "v1", basePath: "/api/gathering/v1" },
  { name: "ocp-vulnerability", description: "Container vulnerability analysis for OCP", version: "v1", basePath: "/api/ocp-vulnerability/v1" },
  { name: "content-sources", description: "Custom RPM repository management", version: "v1", basePath: "/api/content-sources/v1" },
  { name: "provisioning", description: "Cloud resource provisioning", version: "v1", basePath: "/api/provisioning/v1" },
]

export function searchCatalog(query: string): ApiEntry[] {
  const lower = query.toLowerCase()
  return API_CATALOG.filter(
    (entry) =>
      entry.name.toLowerCase().includes(lower) ||
      entry.description.toLowerCase().includes(lower),
  )
}

export function parseOpenApiEndpoints(
  spec: Record<string, unknown>,
): ApiEndpoint[] {
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined
  if (!paths) return []

  const endpoints: ApiEndpoint[] = []

  for (const [path, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue

    for (const [method, detail] of Object.entries(methods)) {
      if (["get", "post", "put", "patch", "delete"].includes(method)) {
        const op = detail as Record<string, unknown> | undefined
        const description = (op?.summary ?? op?.description ?? "") as string
        const parameters = (op?.parameters ?? []) as Array<Record<string, unknown>>
        const params = parameters
          .filter((p) => typeof p.name === "string")
          .map((p) => p.name as string)

        endpoints.push({
          method: method.toUpperCase(),
          path,
          description,
          params,
        })
      }
    }
  }

  return endpoints
}
