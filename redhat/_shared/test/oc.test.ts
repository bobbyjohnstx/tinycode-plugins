import { describe, it, expect } from "bun:test"
import { createOcClient, OcError } from "../src/oc"
import { createMockShell } from "../src/test-utils"

describe("createOcClient", () => {
  it("returns an object with all expected methods", () => {
    const shell = createMockShell([])
    const oc = createOcClient(shell)

    expect(typeof oc.isAvailable).toBe("function")
    expect(typeof oc.isLoggedIn).toBe("function")
    expect(typeof oc.get).toBe("function")
    expect(typeof oc.apply).toBe("function")
    expect(typeof oc.logs).toBe("function")
    expect(typeof oc.describe).toBe("function")
    expect(typeof oc.whoami).toBe("function")
    expect(typeof oc.token).toBe("function")
    expect(typeof oc.version).toBe("function")
    expect(typeof oc.raw).toBe("function")
  })

  it("isAvailable() returns true when which oc exits 0", async () => {
    const shell = createMockShell([{ match: "which oc", output: "/usr/local/bin/oc" }])
    const oc = createOcClient(shell)

    expect(await oc.isAvailable()).toBe(true)
  })

  it("isAvailable() returns false when which oc exits 1", async () => {
    const shell = createMockShell([{ match: "which oc", exitCode: 1 }])
    const oc = createOcClient(shell)

    expect(await oc.isAvailable()).toBe(false)
  })

  it("isLoggedIn() returns true when oc whoami exits 0", async () => {
    const shell = createMockShell([{ match: "oc whoami", output: "admin" }])
    const oc = createOcClient(shell)

    expect(await oc.isLoggedIn()).toBe(true)
  })

  it("isLoggedIn() returns false when oc whoami exits 1", async () => {
    const shell = createMockShell([{ match: "oc whoami", exitCode: 1 }])
    const oc = createOcClient(shell)

    expect(await oc.isLoggedIn()).toBe(false)
  })

  it("get() parses JSON output from oc get pods -o json", async () => {
    const mockPods = {
      apiVersion: "v1",
      kind: "PodList",
      items: [{ metadata: { name: "pod-1" } }],
    }
    const shell = createMockShell([
      { match: "oc get pods -o json", output: JSON.stringify(mockPods), json: mockPods },
    ])
    const oc = createOcClient(shell)

    const result = await oc.get("pods")
    expect(result).toEqual(mockPods)
  })

  it("get() throws OcError when command fails", async () => {
    const shell = createMockShell([
      { match: "oc get pods", exitCode: 1 },
    ])
    const oc = createOcClient(shell)

    try {
      await oc.get("pods")
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeInstanceOf(OcError)
      const ocErr = error as OcError
      expect(ocErr.exitCode).toBe(1)
      expect(ocErr.name).toBe("OcError")
    }
  })

  it("whoami() returns trimmed username string", async () => {
    const shell = createMockShell([
      { match: "oc whoami", output: "admin" },
    ])
    const oc = createOcClient(shell)

    expect(await oc.whoami()).toBe("admin")
  })

  it("token() returns trimmed token string", async () => {
    const shell = createMockShell([
      { match: "oc whoami -t", output: "sha256~abc123" },
    ])
    const oc = createOcClient(shell)

    expect(await oc.token()).toBe("sha256~abc123")
  })

  it("version() parses JSON version output into typed object", async () => {
    const versionData = {
      clientVersion: { major: "4", minor: "22" },
      serverVersion: { major: "1", minor: "31" },
      openshiftVersion: "4.22.3",
    }
    const shell = createMockShell([
      { match: "oc version -o json", output: JSON.stringify(versionData), json: versionData },
    ])
    const oc = createOcClient(shell)

    const result = await oc.version()
    expect(result.clientVersion).toEqual({ major: "4", minor: "22" })
    expect(result.serverVersion).toEqual({ major: "1", minor: "31" })
    expect(result.openshiftVersion).toBe("4.22.3")
  })

  it("raw() passes arguments through and returns stdout", async () => {
    const shell = createMockShell([
      { match: "oc get nodes", output: "node1\nnode2\nnode3" },
    ])
    const oc = createOcClient(shell)

    const result = await oc.raw("get", "nodes")
    expect(result).toBe("node1\nnode2\nnode3")
  })
})
