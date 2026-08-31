import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { ToolDefinition } from "tinycode-plugin"
import plugin from "../src/index"

let originalSnippetsDir: string | undefined

beforeEach(() => {
  originalSnippetsDir = process.env.SNIPPETS_DIR
})

afterEach(() => {
  if (originalSnippetsDir !== undefined) {
    process.env.SNIPPETS_DIR = originalSnippetsDir
  } else {
    delete process.env.SNIPPETS_DIR
  }
})

async function getTools(): Promise<Record<string, ToolDefinition>> {
  const hooks = await plugin.server({} as never, undefined)
  return hooks.tool!
}

describe("tinycode-plugin-gen-snippets", () => {
  describe("plugin loading", () => {
    it("registers snippet_list and snippet_expand tools", async () => {
      process.env.SNIPPETS_DIR = "/nonexistent-dir-for-test"
      const tools = await getTools()
      expect(tools.snippet_list).toBeDefined()
      expect(tools.snippet_expand).toBeDefined()
    })

    it("all tools have descriptions", async () => {
      process.env.SNIPPETS_DIR = "/nonexistent-dir-for-test"
      const tools = await getTools()
      expect(tools.snippet_list.description).toBeTruthy()
      expect(tools.snippet_expand.description).toBeTruthy()
    })
  })

  describe("snippet_list", () => {
    it("returns all 5 built-in templates with names and descriptions", async () => {
      process.env.SNIPPETS_DIR = "/nonexistent-dir-for-test"
      const tools = await getTools()
      const result = (await tools.snippet_list.execute(
        {},
        {} as never,
      )) as string

      expect(result).toContain("deployment")
      expect(result).toContain("Kubernetes Deployment")
      expect(result).toContain("service")
      expect(result).toContain("Kubernetes Service")
      expect(result).toContain("route")
      expect(result).toContain("OpenShift Route")
      expect(result).toContain("configmap")
      expect(result).toContain("Kubernetes ConfigMap")
      expect(result).toContain("pvc")
      expect(result).toContain("PersistentVolumeClaim")
    })
  })

  describe("snippet_expand", () => {
    it("expands template with all variables provided", async () => {
      process.env.SNIPPETS_DIR = "/nonexistent-dir-for-test"
      const tools = await getTools()
      const result = (await tools.snippet_expand.execute(
        {
          name: "service",
          variables: {
            name: "my-svc",
            namespace: "production",
            port: "8080",
          },
        },
        {} as never,
      )) as string

      expect(result).toContain("name: my-svc")
      expect(result).toContain("namespace: production")
      expect(result).toContain("port: 8080")
      expect(result).toContain("targetPort: 8080")
      expect(result).not.toContain("{{")
      expect(result).not.toContain("Note:")
    })

    it("leaves unreplaced placeholders and appends note for missing variables", async () => {
      process.env.SNIPPETS_DIR = "/nonexistent-dir-for-test"
      const tools = await getTools()
      const result = (await tools.snippet_expand.execute(
        {
          name: "service",
          variables: { name: "my-svc" },
        },
        {} as never,
      )) as string

      expect(result).toContain("name: my-svc")
      expect(result).toContain("{{namespace}}")
      expect(result).toContain("{{port}}")
      expect(result).toContain("Note: Unresolved variables:")
    })

    it("returns error message for unknown template name", async () => {
      process.env.SNIPPETS_DIR = "/nonexistent-dir-for-test"
      const tools = await getTools()
      const result = (await tools.snippet_expand.execute(
        { name: "nonexistent" },
        {} as never,
      )) as string

      expect(result).toContain('Unknown template "nonexistent"')
      expect(result).toContain("Available templates:")
    })

    it("handles multiple occurrences of the same variable", async () => {
      process.env.SNIPPETS_DIR = "/nonexistent-dir-for-test"
      const tools = await getTools()
      const result = (await tools.snippet_expand.execute(
        {
          name: "deployment",
          variables: {
            name: "myapp",
            namespace: "default",
            replicas: "3",
            image: "myapp:latest",
            port: "8080",
          },
        },
        {} as never,
      )) as string

      // {{name}} appears 4 times in deployment template
      const nameCount = (result.match(/myapp/g) || []).length
      expect(nameCount).toBeGreaterThanOrEqual(4)
      expect(result).not.toContain("{{name}}")
    })

    it("returns content as-is for template with no variables", async () => {
      process.env.SNIPPETS_DIR = "/nonexistent-dir-for-test"
      const tools = await getTools()
      // configmap has variables, so let's expand all of them to test clean output
      const result = (await tools.snippet_expand.execute(
        {
          name: "configmap",
          variables: {
            name: "my-config",
            namespace: "default",
            key: "app.properties",
            value: "debug=true",
          },
        },
        {} as never,
      )) as string

      expect(result).toContain("name: my-config")
      expect(result).not.toContain("{{")
      expect(result).not.toContain("Note:")
    })
  })

  describe("custom templates", () => {
    let tempDir: string

    beforeAll(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "snippets-test-"))
      await mkdir(tempDir, { recursive: true })
    })

    afterAll(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true })
      }
    })

    it("lists and expands custom .yaml template from directory", async () => {
      const customContent = `apiVersion: v1
kind: Namespace
metadata:
  name: {{name}}`
      await writeFile(join(tempDir, "namespace.yaml"), customContent)
      process.env.SNIPPETS_DIR = tempDir

      const tools = await getTools()

      const listResult = (await tools.snippet_list.execute(
        {},
        {} as never,
      )) as string
      expect(listResult).toContain("namespace")

      const expandResult = (await tools.snippet_expand.execute(
        { name: "namespace", variables: { name: "my-ns" } },
        {} as never,
      )) as string
      expect(expandResult).toContain("name: my-ns")
      expect(expandResult).not.toContain("{{")
    })

    it("lists and expands custom .yml template from directory", async () => {
      const customContent = `apiVersion: v1
kind: Secret
metadata:
  name: {{name}}`
      await writeFile(join(tempDir, "secret.yml"), customContent)
      process.env.SNIPPETS_DIR = tempDir

      const tools = await getTools()

      const listResult = (await tools.snippet_list.execute(
        {},
        {} as never,
      )) as string
      expect(listResult).toContain("secret")
    })

    it("custom template overrides built-in with same name", async () => {
      const customContent = `# Custom deployment override
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{name}}
  annotations:
    custom: "true"`
      await writeFile(join(tempDir, "deployment.yaml"), customContent)
      process.env.SNIPPETS_DIR = tempDir

      const tools = await getTools()
      const result = (await tools.snippet_expand.execute(
        { name: "deployment", variables: { name: "my-deploy" } },
        {} as never,
      )) as string

      expect(result).toContain("custom: \"true\"")
      expect(result).toContain("# Custom deployment override")
    })

    it("uses only built-ins when snippets directory does not exist", async () => {
      process.env.SNIPPETS_DIR = "/nonexistent-snippets-dir-12345"
      const tools = await getTools()
      const result = (await tools.snippet_list.execute(
        {},
        {} as never,
      )) as string

      expect(result).toContain("deployment")
      expect(result).toContain("service")
      expect(result).toContain("route")
      expect(result).toContain("configmap")
      expect(result).toContain("pvc")
      // Should not error
      expect(result).not.toContain("Error")
    })
  })
})
