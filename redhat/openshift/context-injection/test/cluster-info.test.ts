import { describe, it, expect } from "bun:test"
import { createMockShell } from "tinycode-plugin-redhat-shared/test-utils"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { queryClusterContext } from "../src/cluster-info"

const mockVersionData = {
  clientVersion: { major: "4", minor: "22" },
  serverVersion: { major: "1", minor: "31" },
  openshiftVersion: "4.22.3",
}

function makeNode(role: "control-plane" | "worker" | "master") {
  const labels: Record<string, string> = {}
  if (role === "control-plane" || role === "master") {
    labels[`node-role.kubernetes.io/${role}`] = ""
  }
  if (role === "worker") {
    labels["node-role.kubernetes.io/worker"] = ""
  }
  return { metadata: { labels } }
}

const mockNodesData = {
  apiVersion: "v1",
  kind: "NodeList",
  items: [
    makeNode("control-plane"),
    makeNode("control-plane"),
    makeNode("control-plane"),
    makeNode("worker"),
    makeNode("worker"),
    makeNode("worker"),
  ],
}

const mockCsvData = {
  apiVersion: "operators.coreos.com/v1alpha1",
  kind: "ClusterServiceVersionList",
  items: [
    { metadata: { name: "openshift-virtualization.v4.15.0" }, spec: { displayName: "OpenShift Virtualization" } },
    { metadata: { name: "openshift-pipelines-operator-rh.v1.14.0" }, spec: { displayName: "Red Hat OpenShift Pipelines" } },
  ],
}

function createConnectedShell() {
  return createMockShell([
    { match: "which oc", output: "/usr/local/bin/oc" },
    { match: "oc whoami", output: "admin" },
    { match: "oc version -o json", json: mockVersionData, output: JSON.stringify(mockVersionData) },
    { match: "oc get nodes -o json", json: mockNodesData, output: JSON.stringify(mockNodesData) },
    { match: "oc config current-context", output: "default/api-mycluster-example-com:6443/admin" },
    { match: "oc get csv -A -o json", output: JSON.stringify(mockCsvData) },
  ])
}

describe("queryClusterContext", () => {
  it("returns a populated ClusterContext when all queries succeed", async () => {
    const shell = createConnectedShell()
    const oc = createOcClient(shell)
    const result = await queryClusterContext(oc)

    expect(result).not.toBeNull()
    expect(result!.cluster).toBe("api-mycluster-example-com:6443")
    expect(result!.version).toBe("4.22.3")
    expect(result!.nodes).toBe("6 (3 control-plane, 3 worker)")
    expect(result!.namespace).toBe("default")
    expect(result!.operators).toEqual(["OpenShift Virtualization", "Red Hat OpenShift Pipelines"])
  })

  it("returns null when oc is not available", async () => {
    const shell = createMockShell([
      { match: "which oc", exitCode: 1 },
    ])
    const oc = createOcClient(shell)
    const result = await queryClusterContext(oc)

    expect(result).toBeNull()
  })

  it("returns null when oc is not logged in", async () => {
    const shell = createMockShell([
      { match: "which oc", output: "/usr/local/bin/oc" },
      { match: "oc whoami", exitCode: 1 },
    ])
    const oc = createOcClient(shell)
    const result = await queryClusterContext(oc)

    expect(result).toBeNull()
  })

  it("uses fallback values when individual queries fail", async () => {
    const shell = createMockShell([
      { match: "which oc", output: "/usr/local/bin/oc" },
      { match: "oc whoami", output: "admin" },
      { match: "oc version -o json", json: mockVersionData, output: JSON.stringify(mockVersionData) },
      { match: "oc get nodes -o json", exitCode: 1 },
      { match: "oc config current-context", output: "default/api-mycluster-example-com:6443/admin" },
      { match: "oc get csv -A -o json", exitCode: 1 },
    ])
    const oc = createOcClient(shell)
    const result = await queryClusterContext(oc)

    expect(result).not.toBeNull()
    expect(result!.version).toBe("4.22.3")
    expect(result!.nodes).toBe("unknown")
    expect(result!.operators).toEqual([])
    expect(result!.cluster).toBe("api-mycluster-example-com:6443")
  })

  it("parses control-plane and worker roles from node labels", async () => {
    const mixedNodes = {
      items: [
        makeNode("master"),
        makeNode("control-plane"),
        makeNode("worker"),
        makeNode("worker"),
      ],
    }
    const shell = createMockShell([
      { match: "which oc", output: "/usr/local/bin/oc" },
      { match: "oc whoami", output: "admin" },
      { match: "oc version -o json", json: mockVersionData, output: JSON.stringify(mockVersionData) },
      { match: "oc get nodes -o json", json: mixedNodes, output: JSON.stringify(mixedNodes) },
      { match: "oc config current-context", output: "test-ns/api-cluster:6443/user" },
      { match: "oc get csv -A -o json", output: JSON.stringify({ items: [] }) },
    ])
    const oc = createOcClient(shell)
    const result = await queryClusterContext(oc)

    expect(result).not.toBeNull()
    expect(result!.nodes).toBe("4 (2 control-plane, 2 worker)")
  })

  it("falls back to serverVersion when openshiftVersion is missing", async () => {
    const versionNoOcp = {
      clientVersion: { major: "4", minor: "22" },
      serverVersion: { major: "1", minor: "31" },
    }
    const shell = createMockShell([
      { match: "which oc", output: "/usr/local/bin/oc" },
      { match: "oc whoami", output: "admin" },
      { match: "oc version -o json", json: versionNoOcp, output: JSON.stringify(versionNoOcp) },
      { match: "oc get nodes -o json", json: { items: [] }, output: JSON.stringify({ items: [] }) },
      { match: "oc config current-context", output: "ns/cluster:6443/user" },
      { match: "oc get csv -A -o json", output: JSON.stringify({ items: [] }) },
    ])
    const oc = createOcClient(shell)
    const result = await queryClusterContext(oc)

    expect(result).not.toBeNull()
    expect(result!.version).toBe("1.31")
  })
})
