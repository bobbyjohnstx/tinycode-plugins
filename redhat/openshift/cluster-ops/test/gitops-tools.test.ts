import { describe, it, expect } from "bun:test"
import {
  createMockShell,
  createMockInput,
} from "tinycode-plugin-redhat-shared/test-utils"
import type { ToolContext } from "tinycode-plugin"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { createGitOpsTools } from "../src/gitops-tools"
import plugin from "../src/index"

function setupTools(commands: Parameters<typeof createMockShell>[0]) {
  const shell = createMockShell(commands)
  const oc = createOcClient(shell)
  return createGitOpsTools(oc)
}

describe("gitops-tools", () => {
  describe("ocp_gitops_apps", () => {
    it("lists ArgoCD applications with parsed fields", async () => {
      const appsData = {
        items: [
          {
            metadata: { name: "my-app" },
            spec: {
              project: "default",
              source: { repoURL: "https://github.com/org/repo" },
            },
            status: {
              sync: { status: "Synced" },
              health: { status: "Healthy" },
            },
          },
          {
            metadata: { name: "other-app" },
            spec: {
              project: "team-b",
              source: { repoURL: "https://github.com/org/other" },
            },
            status: {
              sync: { status: "OutOfSync" },
              health: { status: "Degraded" },
            },
          },
        ],
      }
      const tools = setupTools([
        {
          match: /oc.*get.*applications\.argoproj\.io/,
          output: JSON.stringify(appsData),
          json: appsData,
        },
      ])
      const result = await tools.ocp_gitops_apps.execute(
        {},
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("my-app")
      expect(result).toContain("Synced")
      expect(result).toContain("Healthy")
      expect(result).toContain("default")
      expect(result).toContain("https://github.com/org/repo")
      expect(result).toContain("other-app")
      expect(result).toContain("OutOfSync")
      expect(result).toContain("Degraded")
    })

    it("uses custom namespace when provided", async () => {
      const appsData = {
        items: [
          {
            metadata: { name: "app-1" },
            spec: {
              project: "default",
              source: { repoURL: "https://github.com/org/repo" },
            },
            status: {
              sync: { status: "Synced" },
              health: { status: "Healthy" },
            },
          },
        ],
      }
      const tools = setupTools([
        {
          match: /oc.*get.*applications\.argoproj\.io.*--namespace.*argocd/,
          output: JSON.stringify(appsData),
          json: appsData,
        },
      ])
      const result = await tools.ocp_gitops_apps.execute(
        { namespace: "argocd" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("argocd")
      expect(result).toContain("app-1")
    })

    it("returns message for empty application list", async () => {
      const emptyData = { items: [] }
      const tools = setupTools([
        {
          match: /oc.*get.*applications\.argoproj\.io/,
          output: JSON.stringify(emptyData),
          json: emptyData,
        },
      ])
      const result = await tools.ocp_gitops_apps.execute(
        {},
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("No ArgoCD applications found")
    })

    it("returns error on failure", async () => {
      const tools = setupTools([])
      const result = await tools.ocp_gitops_apps.execute(
        {},
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("Error listing GitOps applications")
    })
  })

  describe("ocp_gitops_sync", () => {
    it("triggers sync after permission check", async () => {
      const tools = setupTools([
        {
          match: /oc.*patch.*application/,
          output: "application.argoproj.io/my-app patched",
        },
      ])
      const mockCtx = { ask: async () => {} } as unknown as ToolContext
      const result = await tools.ocp_gitops_sync.execute(
        { name: "my-app" },
        mockCtx,
      )
      expect(result).toContain("patched")
    })

    it("passes custom revision in sync operation", async () => {
      const tools = setupTools([
        {
          match: /oc.*patch.*application.*my-app/,
          output: "application.argoproj.io/my-app patched",
        },
      ])
      const mockCtx = { ask: async () => {} } as unknown as ToolContext
      const result = await tools.ocp_gitops_sync.execute(
        { name: "my-app", revision: "abc1234" },
        mockCtx,
      )
      expect(result).toContain("patched")
    })

    it("returns error when permission denied", async () => {
      const tools = setupTools([
        {
          match: /oc.*patch.*application/,
          output: "application.argoproj.io/my-app patched",
        },
      ])
      const denyCtx = {
        ask: async () => {
          throw new Error("Permission denied")
        },
      } as unknown as ToolContext
      const result = await tools.ocp_gitops_sync.execute(
        { name: "my-app" },
        denyCtx,
      )
      expect(result).toContain("Error syncing application")
      expect(result).toContain("Permission denied")
    })

    it("returns error on oc command failure", async () => {
      const tools = setupTools([])
      const mockCtx = { ask: async () => {} } as unknown as ToolContext
      const result = await tools.ocp_gitops_sync.execute(
        { name: "my-app" },
        mockCtx,
      )
      expect(result).toContain("Error syncing application")
    })
  })

  describe("ocp_gitops_diff", () => {
    it("shows out-of-sync resources", async () => {
      const appData = {
        metadata: { name: "my-app" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/org/repo" },
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Healthy" },
          resources: [
            {
              kind: "Deployment",
              namespace: "prod",
              name: "web",
              status: "Synced",
              health: { status: "Healthy" },
            },
            {
              kind: "ConfigMap",
              namespace: "prod",
              name: "config",
              status: "OutOfSync",
            },
            {
              kind: "Service",
              namespace: "prod",
              name: "web-svc",
              status: "OutOfSync",
              health: { status: "Healthy" },
            },
          ],
        },
      }
      const tools = setupTools([
        {
          match: /oc.*get.*applications\.argoproj\.io\/my-app/,
          output: JSON.stringify(appData),
          json: appData,
        },
      ])
      const result = await tools.ocp_gitops_diff.execute(
        { name: "my-app" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("Out-of-Sync")
      expect(result).toContain("ConfigMap/config")
      expect(result).toContain("Service/web-svc")
      expect(result).not.toContain("Deployment/web")
    })

    it("uses custom namespace when provided", async () => {
      const appData = {
        metadata: { name: "my-app" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/org/repo" },
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Healthy" },
          resources: [
            {
              kind: "ConfigMap",
              namespace: "staging",
              name: "config",
              status: "OutOfSync",
            },
          ],
        },
      }
      const tools = setupTools([
        {
          match:
            /oc.*get.*applications\.argoproj\.io\/my-app.*--namespace.*custom-ns/,
          output: JSON.stringify(appData),
          json: appData,
        },
      ])
      const result = await tools.ocp_gitops_diff.execute(
        { name: "my-app", namespace: "custom-ns" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("ConfigMap/config")
    })

    it("reports all resources synced when none are out-of-sync", async () => {
      const appData = {
        metadata: { name: "my-app" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/org/repo" },
        },
        status: {
          sync: { status: "Synced" },
          health: { status: "Healthy" },
          resources: [
            {
              kind: "Deployment",
              namespace: "prod",
              name: "web",
              status: "Synced",
              health: { status: "Healthy" },
            },
          ],
        },
      }
      const tools = setupTools([
        {
          match: /oc.*get.*applications\.argoproj\.io\/my-app/,
          output: JSON.stringify(appData),
          json: appData,
        },
      ])
      const result = await tools.ocp_gitops_diff.execute(
        { name: "my-app" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("synced")
    })

    it("returns error on failure", async () => {
      const tools = setupTools([])
      const result = await tools.ocp_gitops_diff.execute(
        { name: "my-app" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("Error getting application diff")
    })
  })

  describe("ocp_gitops_history", () => {
    it("shows deployment history entries", async () => {
      const appData = {
        metadata: { name: "my-app" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/org/repo" },
        },
        status: {
          sync: { status: "Synced" },
          health: { status: "Healthy" },
          history: [
            {
              id: 1,
              revision: "abc1234567890",
              deployedAt: "2024-01-15T10:30:00Z",
              source: { repoURL: "https://github.com/org/repo" },
            },
            {
              id: 2,
              revision: "def4567890123",
              deployedAt: "2024-01-16T14:00:00Z",
              source: { repoURL: "https://github.com/org/repo" },
            },
          ],
        },
      }
      const tools = setupTools([
        {
          match: /oc.*get.*applications\.argoproj\.io\/my-app/,
          output: JSON.stringify(appData),
          json: appData,
        },
      ])
      const result = await tools.ocp_gitops_history.execute(
        { name: "my-app" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("Deployment History")
      expect(result).toContain("#1")
      expect(result).toContain("abc1234")
      expect(result).toContain("2024-01-15T10:30:00Z")
      expect(result).toContain("#2")
      expect(result).toContain("def4567")
    })

    it("reports no history when empty", async () => {
      const appData = {
        metadata: { name: "my-app" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/org/repo" },
        },
        status: {
          sync: { status: "Synced" },
          health: { status: "Healthy" },
          history: [],
        },
      }
      const tools = setupTools([
        {
          match: /oc.*get.*applications\.argoproj\.io\/my-app/,
          output: JSON.stringify(appData),
          json: appData,
        },
      ])
      const result = await tools.ocp_gitops_history.execute(
        { name: "my-app" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("No deployment history")
    })

    it("returns error on failure", async () => {
      const tools = setupTools([])
      const result = await tools.ocp_gitops_history.execute(
        { name: "my-app" },
        undefined as unknown as ToolContext,
      )
      expect(result).toContain("Error getting deployment history")
    })
  })

  describe("integration", () => {
    it("gitops tools are registered when plugin loads", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      const toolNames = Object.keys(hooks.tool!)
      expect(toolNames).toContain("ocp_gitops_apps")
      expect(toolNames).toContain("ocp_gitops_sync")
      expect(toolNames).toContain("ocp_gitops_diff")
      expect(toolNames).toContain("ocp_gitops_history")
    })
  })
})
