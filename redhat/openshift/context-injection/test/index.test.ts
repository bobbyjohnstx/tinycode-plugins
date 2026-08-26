import { describe, it, expect } from "bun:test"
import type { PluginInput, Hooks } from "tinycode-plugin"
import { createMockShell } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

function createMockInput(shell: PluginInput["$"]): PluginInput {
  return {
    client: {} as PluginInput["client"],
    project: {
      id: "test-project",
      worktree: "/tmp/test",
      time: { created: Date.now() },
    },
    directory: "/tmp/test",
    worktree: "/tmp/test",
    serverUrl: new URL("http://localhost:4096"),
    $: shell,
  }
}

const mockVersionData = {
  clientVersion: { major: "4", minor: "22" },
  serverVersion: { major: "1", minor: "31" },
  openshiftVersion: "4.22.3",
}

const mockNodesData = {
  items: [
    { metadata: { labels: { "node-role.kubernetes.io/control-plane": "" } } },
    { metadata: { labels: { "node-role.kubernetes.io/control-plane": "" } } },
    { metadata: { labels: { "node-role.kubernetes.io/worker": "" } } },
  ],
}

const mockCsvData = {
  items: [
    { spec: { displayName: "OpenShift Virtualization" } },
    { spec: { displayName: "Red Hat OpenShift Pipelines" } },
  ],
}

const mockAlertData = [
  { labels: { alertname: "KubePodCrashLooping", namespace: "payments-api", severity: "critical" } },
  { labels: { alertname: "NodeFilesystemAlmostOutOfSpace", namespace: "worker-3", severity: "critical" } },
  { labels: { alertname: "TargetDown", namespace: "user-workload-monitoring", severity: "warning" } },
  { labels: { alertname: "InfoAlert", namespace: "kube-system", severity: "info" } },
]

const baseConnectedCommands = [
  { match: "which oc", output: "/usr/local/bin/oc" },
  { match: "oc whoami", output: "admin" },
  { match: "oc version -o json", json: mockVersionData, output: JSON.stringify(mockVersionData) },
  { match: "oc get nodes -o json", json: mockNodesData, output: JSON.stringify(mockNodesData) },
  { match: "oc config current-context", output: "my-namespace/api-cluster-example-com:6443/admin" },
  { match: "oc get csv -A -o json", output: JSON.stringify(mockCsvData) },
] as const

function createConnectedShell() {
  return createMockShell([
    ...baseConnectedCommands,
    { match: "alertmanager-main-0", exitCode: 1 },
  ])
}

function createConnectedShellWithAlerts() {
  return createMockShell([
    ...baseConnectedCommands,
    { match: "alertmanager-main-0", output: JSON.stringify(mockAlertData) },
  ])
}

function createConnectedShellWithNoAlerts() {
  return createMockShell([
    ...baseConnectedCommands,
    { match: "alertmanager-main-0", output: JSON.stringify([]) },
  ])
}

function createDisconnectedShell() {
  return createMockShell([
    { match: "which oc", exitCode: 1 },
  ])
}

async function loadPlugin(shell: PluginInput["$"]): Promise<Hooks> {
  const input = createMockInput(shell)
  return plugin.server(input, undefined)
}

describe("tinycode-plugin-ocp-context", () => {
  it("loads without error", async () => {
    const shell = createMockShell([])
    const hooks = await loadPlugin(shell)
    expect(hooks).toBeDefined()
  })

  it("session.start populates cache and system.transform returns context block", async () => {
    const shell = createConnectedShell()
    const hooks = await loadPlugin(shell)

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output)

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toContain("<cluster-context>")
    expect(output.system[0]).toContain("cluster: api-cluster-example-com:6443")
    expect(output.system[0]).toContain("version: 4.22.3")
    expect(output.system[0]).toContain("nodes: 3 (2 control-plane, 1 worker)")
    expect(output.system[0]).toContain("namespace: my-namespace")
    expect(output.system[0]).toContain("operators: [OpenShift Virtualization, Red Hat OpenShift Pipelines]")
    expect(output.system[0]).toContain("</cluster-context>")
  })

  it("injects not-connected block when oc is unavailable", async () => {
    const shell = createDisconnectedShell()
    const hooks = await loadPlugin(shell)

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output)

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toBe("<cluster-context>not connected</cluster-context>")
  })

  it("injects not-connected block when oc is not logged in", async () => {
    const shell = createMockShell([
      { match: "which oc", output: "/usr/local/bin/oc" },
      { match: "oc whoami", exitCode: 1 },
    ])
    const hooks = await loadPlugin(shell)

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output)

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toBe("<cluster-context>not connected</cluster-context>")
  })

  it("dispose clears cached context", async () => {
    const shell = createConnectedShell()
    const hooks = await loadPlugin(shell)

    await hooks["session.start"]!({ sessionID: "test" }, {})
    await hooks.dispose!()

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output)

    expect(output.system[0]).toBe("<cluster-context>not connected</cluster-context>")
  })

  it("caches context across multiple system.transform calls", async () => {
    const shell = createConnectedShell()
    const hooks = await loadPlugin(shell)

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output1 = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output1)

    const output2 = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output2)

    expect(output1.system[0]).toContain("<cluster-context>")
    expect(output2.system[0]).toContain("<cluster-context>")
    expect(output1.system[0]).toBe(output2.system[0])
  })

  it("includes firing alert summary when AlertManager returns alerts", async () => {
    const shell = createConnectedShellWithAlerts()
    const hooks = await loadPlugin(shell)

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output)

    expect(output.system[0]).toContain("firing-alerts-critical: 2 (KubePodCrashLooping: payments-api, NodeFilesystemAlmostOutOfSpace: worker-3)")
    expect(output.system[0]).toContain("firing-alerts-warning: 1 (TargetDown: user-workload-monitoring)")
    expect(output.system[0]).toContain("firing-alerts-info: 1")
  })

  it("omits alert lines when no alerts are firing", async () => {
    const shell = createConnectedShellWithNoAlerts()
    const hooks = await loadPlugin(shell)

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output)

    expect(output.system[0]).not.toContain("firing-alerts")
    expect(output.system[0]).toContain("<cluster-context>")
    expect(output.system[0]).toContain("cluster: api-cluster-example-com:6443")
  })

  it("alert query failure does not break context injection", async () => {
    const shell = createConnectedShell()
    const hooks = await loadPlugin(shell)

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output)

    expect(output.system[0]).toContain("<cluster-context>")
    expect(output.system[0]).toContain("cluster: api-cluster-example-com:6443")
    expect(output.system[0]).toContain("version: 4.22.3")
    expect(output.system[0]).not.toContain("firing-alerts")
  })

  it("formats critical and warning alerts with name:namespace, info shows count only", async () => {
    const shell = createConnectedShellWithAlerts()
    const hooks = await loadPlugin(shell)

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output)

    const block = output.system[0]!
    expect(block).toMatch(/firing-alerts-critical: 2 \(KubePodCrashLooping: payments-api, NodeFilesystemAlmostOutOfSpace: worker-3\)/)
    expect(block).toMatch(/firing-alerts-warning: 1 \(TargetDown: user-workload-monitoring\)/)
    expect(block).toMatch(/firing-alerts-info: 1/)
    expect(block).not.toMatch(/firing-alerts-info:.*InfoAlert/)
  })
})
