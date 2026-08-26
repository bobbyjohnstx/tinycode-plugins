import { describe, it, expect } from "bun:test"
import type { PluginInput, Hooks } from "tinycode-plugin"
import type { Model } from "@tinycode/sdk"
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

function createConnectedShell() {
  return createMockShell([
    { match: "which oc", output: "/usr/local/bin/oc" },
    { match: "oc whoami", output: "admin" },
    { match: "oc version -o json", json: mockVersionData, output: JSON.stringify(mockVersionData) },
    { match: "oc get nodes -o json", json: mockNodesData, output: JSON.stringify(mockNodesData) },
    { match: "oc config current-context", output: "my-namespace/api-cluster-example-com:6443/admin" },
    { match: "oc get csv -A -o json", output: JSON.stringify(mockCsvData) },
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
    await hooks["experimental.chat.system.transform"]!({ model: {} as Model }, output)

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
    await hooks["experimental.chat.system.transform"]!({ model: {} as Model }, output)

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
    await hooks["experimental.chat.system.transform"]!({ model: {} as Model }, output)

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toBe("<cluster-context>not connected</cluster-context>")
  })

  it("dispose clears cached context", async () => {
    const shell = createConnectedShell()
    const hooks = await loadPlugin(shell)

    await hooks["session.start"]!({ sessionID: "test" }, {})
    await hooks.dispose!()

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as Model }, output)

    expect(output.system[0]).toBe("<cluster-context>not connected</cluster-context>")
  })

  it("caches context across multiple system.transform calls", async () => {
    const shell = createConnectedShell()
    const hooks = await loadPlugin(shell)

    await hooks["session.start"]!({ sessionID: "test" }, {})

    const output1 = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as Model }, output1)

    const output2 = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ model: {} as Model }, output2)

    expect(output1.system[0]).toContain("<cluster-context>")
    expect(output2.system[0]).toContain("<cluster-context>")
    expect(output1.system[0]).toBe(output2.system[0])
  })
})
