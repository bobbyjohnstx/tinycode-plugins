import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { tokenManager, resolveToken, createTokenFn } from "../src/auth"
import { createMockShell } from "../src/test-utils"

const originalEnv = process.env.OPENSHIFT_TOKEN

beforeEach(() => {
  tokenManager.clear()
  delete process.env.OPENSHIFT_TOKEN
})

afterEach(() => {
  tokenManager.clear()
  if (originalEnv !== undefined) {
    process.env.OPENSHIFT_TOKEN = originalEnv
  } else {
    delete process.env.OPENSHIFT_TOKEN
  }
})

describe("tokenManager", () => {
  it("setToken() stores token, getToken() retrieves it", () => {
    const server = "https://api.cluster.example.com:6443"
    const result = { token: "sha256~abc", source: "oauth" as const, server }
    tokenManager.setToken(server, result)

    expect(tokenManager.getToken(server)).toEqual(result)
  })

  it("getToken() returns undefined for unknown cluster", () => {
    expect(tokenManager.getToken("https://unknown.example.com:6443")).toBeUndefined()
  })

  it("removeToken() removes a stored token", () => {
    const server = "https://api.cluster.example.com:6443"
    tokenManager.setToken(server, { token: "t", source: "oauth", server })
    tokenManager.removeToken(server)

    expect(tokenManager.getToken(server)).toBeUndefined()
  })

  it("clear() removes all tokens", () => {
    tokenManager.setToken("https://a.com", { token: "t1", source: "oauth", server: "https://a.com" })
    tokenManager.setToken("https://b.com", { token: "t2", source: "oauth", server: "https://b.com" })
    tokenManager.clear()

    expect(tokenManager.getToken("https://a.com")).toBeUndefined()
    expect(tokenManager.getToken("https://b.com")).toBeUndefined()
  })
})

describe("resolveToken", () => {
  it("returns cached token from tokenManager first (priority 1)", async () => {
    const server = "https://api.cluster.example.com:6443"
    tokenManager.setToken(server, { token: "cached-token", source: "oauth", server })

    const shell = createMockShell([
      { match: "oc whoami --show-server", output: server },
    ])

    const result = await resolveToken(shell)
    expect(result.token).toBe("cached-token")
    expect(result.source).toBe("oauth")
  })

  it("returns option token when no cache exists (priority 2)", async () => {
    const server = "https://api.cluster.example.com:6443"
    const shell = createMockShell([
      { match: "oc whoami --show-server", output: server },
    ])

    const result = await resolveToken(shell, { token: "option-token" })
    expect(result.token).toBe("option-token")
    expect(result.source).toBe("option")
    expect(result.server).toBe(server)
  })

  it("returns env var token when no option exists (priority 3)", async () => {
    const server = "https://api.cluster.example.com:6443"
    process.env.OPENSHIFT_TOKEN = "env-token"

    const shell = createMockShell([
      { match: "oc whoami --show-server", output: server },
    ])

    const result = await resolveToken(shell)
    expect(result.token).toBe("env-token")
    expect(result.source).toBe("env")
    expect(result.server).toBe(server)
  })

  it("falls back to oc whoami -t when no env var exists (priority 4)", async () => {
    const server = "https://api.cluster.example.com:6443"
    const shell = createMockShell([
      { match: "oc whoami --show-server", output: server },
      { match: "oc whoami -t", output: "sha256~kubeconfig-token" },
    ])

    const result = await resolveToken(shell)
    expect(result.token).toBe("sha256~kubeconfig-token")
    expect(result.source).toBe("kubeconfig")
    expect(result.server).toBe(server)
  })

  it("throws when no token source is available", async () => {
    const shell = createMockShell([
      { match: "oc whoami --show-server", exitCode: 1 },
      { match: "oc whoami -t", exitCode: 1 },
    ])

    expect(resolveToken(shell)).rejects.toThrow("No OpenShift token available from any source")
  })
})

describe("createTokenFn", () => {
  it("returns a function that returns just the token string", async () => {
    const server = "https://api.cluster.example.com:6443"
    const shell = createMockShell([
      { match: "oc whoami --show-server", output: server },
      { match: "oc whoami -t", output: "sha256~fn-token" },
    ])

    const fn = createTokenFn(shell)
    const token = await fn()
    expect(token).toBe("sha256~fn-token")
  })
})
