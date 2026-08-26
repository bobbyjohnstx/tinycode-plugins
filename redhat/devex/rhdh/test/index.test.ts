import { describe, it, expect, afterEach } from "bun:test"
import { createMockInput, createMockFetch } from "tinycode-plugin-redhat-shared/test-utils"
import type { MockRoute } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const baseUrl = "https://rhdh.example.com"
const apiToken = "test-token"
const configuredOptions = { baseUrl, apiToken }

function setupFetch(routes: MockRoute[]) {
  globalThis.fetch = createMockFetch(routes)
}

async function getTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

describe("tinycode-plugin-rhdh", () => {
  describe("plugin loading", () => {
    it("loads without options and returns tools", async () => {
      const tools = await getTools(undefined)
      expect(tools).toBeDefined()
      expect(tools.rhdh_catalog_search).toBeDefined()
      expect(tools.rhdh_catalog_entity).toBeDefined()
      expect(tools.rhdh_api_spec).toBeDefined()
      expect(tools.rhdh_techdocs).toBeDefined()
      expect(tools.rhdh_dependencies).toBeDefined()
    })

    it("returns config-needed message when no options provided", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhdh_catalog_search.execute({}, {} as never)
      expect(result).toContain("not configured")
      expect(result).toContain("baseUrl")
    })

    it("loads with valid options and returns configured tools", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities",
          body: [],
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_catalog_search.execute({}, {} as never)
      expect(result).not.toContain("not configured")
    })
  })

  describe("rhdh_catalog_search", () => {
    it("returns formatted entity list on success", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities",
          body: [
            {
              kind: "Component",
              metadata: {
                name: "my-service",
                namespace: "default",
                description: "A microservice",
              },
              spec: { lifecycle: "production", type: "service" },
            },
            {
              kind: "API",
              metadata: {
                name: "my-api",
                namespace: "default",
                description: "REST API",
              },
              spec: { lifecycle: "experimental" },
            },
          ],
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_catalog_search.execute({ kind: "Component" }, {} as never)
      expect(result).toContain("Entities found: 2")
      expect(result).toContain("Component:default/my-service")
      expect(result).toContain("[production]")
      expect(result).toContain("A microservice")
      expect(result).toContain("API:default/my-api")
    })

    it("returns no-results message when no entities match", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities",
          body: [],
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_catalog_search.execute(
        { query: "nonexistent" },
        {} as never,
      )
      expect(result).toContain("No entities found")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities",
          status: 500,
          body: { error: "Internal error" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_catalog_search.execute({ kind: "Component" }, {} as never)
      expect(result).toContain("Failed to search catalog")
      expect(result).toContain("500")
    })
  })

  describe("rhdh_catalog_entity", () => {
    it("returns formatted entity details on success", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities/by-name/Component/default/my-service",
          body: {
            kind: "Component",
            metadata: {
              name: "my-service",
              namespace: "default",
              description: "A backend service",
              title: "My Service",
              tags: ["java", "spring"],
              links: [
                { url: "https://github.com/org/my-service", title: "GitHub" },
                { url: "https://grafana.example.com/d/abc", title: "Dashboard" },
              ],
            },
            spec: {
              type: "service",
              lifecycle: "production",
              owner: "team-backend",
              system: "platform",
            },
            relations: [
              { type: "providesApi", targetRef: "api:default/my-api" },
              { type: "ownedBy", targetRef: "group:default/team-backend" },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_catalog_entity.execute(
        { kind: "Component", name: "my-service" },
        {} as never,
      )
      expect(result).toContain("Component: my-service")
      expect(result).toContain("Namespace: default")
      expect(result).toContain("Title: My Service")
      expect(result).toContain("Description: A backend service")
      expect(result).toContain("Type: service")
      expect(result).toContain("Lifecycle: production")
      expect(result).toContain("Owner: team-backend")
      expect(result).toContain("System: platform")
      expect(result).toContain("Tags: java, spring")
      expect(result).toContain("GitHub")
      expect(result).toContain("https://github.com/org/my-service")
      expect(result).toContain("providesApi -> api:default/my-api")
      expect(result).toContain("ownedBy -> group:default/team-backend")
    })

    it("uses default namespace when not provided", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities/by-name/Component/default/svc",
          body: {
            kind: "Component",
            metadata: { name: "svc", namespace: "default" },
            spec: {},
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_catalog_entity.execute(
        { kind: "Component", name: "svc" },
        {} as never,
      )
      expect(result).toContain("Component: svc")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities/by-name/Component/default/missing",
          status: 404,
          body: { error: "not found" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_catalog_entity.execute(
        { kind: "Component", name: "missing" },
        {} as never,
      )
      expect(result).toContain("Failed to get entity")
      expect(result).toContain("404")
    })
  })

  describe("rhdh_api_spec", () => {
    it("returns API definition on success", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities/by-name/API/default/petstore",
          body: {
            kind: "API",
            metadata: { name: "petstore", namespace: "default" },
            spec: {
              type: "openapi",
              definition: '{"openapi":"3.0.0","info":{"title":"Petstore"}}',
            },
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_api_spec.execute({ name: "petstore" }, {} as never)
      expect(result).toContain("API Spec for petstore")
      expect(result).toContain("Type: openapi")
      expect(result).toContain('"openapi":"3.0.0"')
      expect(result).toContain("Petstore")
    })

    it("returns no-spec message when definition is missing", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities/by-name/API/default/empty-api",
          body: {
            kind: "API",
            metadata: { name: "empty-api", namespace: "default" },
            spec: { type: "openapi" },
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_api_spec.execute({ name: "empty-api" }, {} as never)
      expect(result).toContain("No API specification found")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities/by-name/API/default/broken",
          status: 500,
          body: { error: "server error" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_api_spec.execute({ name: "broken" }, {} as never)
      expect(result).toContain("Failed to get API spec")
      expect(result).toContain("500")
    })
  })

  describe("rhdh_techdocs", () => {
    it("returns TechDocs content on success", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/techdocs/static/docs/default/Component/my-service/index.html",
          body: "<html><body><h1>My Service Docs</h1></body></html>",
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_techdocs.execute(
        { kind: "Component", name: "my-service" },
        {} as never,
      )
      expect(result).toContain("TechDocs for Component:default/my-service")
      expect(result).toContain("My Service Docs")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/techdocs/static/docs/default/Component/no-docs/index.html",
          status: 404,
          body: { error: "not found" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_techdocs.execute(
        { kind: "Component", name: "no-docs" },
        {} as never,
      )
      expect(result).toContain("Failed to get TechDocs")
      expect(result).toContain("404")
    })
  })

  describe("rhdh_dependencies", () => {
    it("returns grouped dependency relations on success", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities/by-name/Component/default/frontend",
          body: {
            kind: "Component",
            metadata: { name: "frontend", namespace: "default" },
            spec: {},
            relations: [
              { type: "consumesApi", targetRef: "api:default/rest-api" },
              { type: "consumesApi", targetRef: "api:default/graphql-api" },
              { type: "dependsOn", targetRef: "component:default/auth-service" },
              { type: "ownedBy", targetRef: "group:default/team-frontend" },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_dependencies.execute(
        { kind: "Component", name: "frontend" },
        {} as never,
      )
      expect(result).toContain("Dependencies for Component:frontend")
      expect(result).toContain("consumesApi:")
      expect(result).toContain("api:default/rest-api")
      expect(result).toContain("api:default/graphql-api")
      expect(result).toContain("dependsOn:")
      expect(result).toContain("component:default/auth-service")
      expect(result).toContain("ownedBy:")
    })

    it("returns no-dependencies message when entity has no relations", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities/by-name/Component/default/isolated",
          body: {
            kind: "Component",
            metadata: { name: "isolated", namespace: "default" },
            spec: {},
            relations: [],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_dependencies.execute(
        { kind: "Component", name: "isolated" },
        {} as never,
      )
      expect(result).toContain("No dependencies found")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/catalog/entities/by-name/Component/default/fail",
          status: 403,
          body: { error: "Forbidden" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.rhdh_dependencies.execute(
        { kind: "Component", name: "fail" },
        {} as never,
      )
      expect(result).toContain("Failed to get dependencies")
      expect(result).toContain("403")
    })
  })

  describe("unconfigured tools return config message for all tools", () => {
    it("rhdh_catalog_entity returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhdh_catalog_entity.execute(
        { kind: "Component", name: "svc" },
        {} as never,
      )
      expect(result).toContain("not configured")
    })

    it("rhdh_api_spec returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhdh_api_spec.execute({ name: "api" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("rhdh_techdocs returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhdh_techdocs.execute(
        { kind: "Component", name: "svc" },
        {} as never,
      )
      expect(result).toContain("not configured")
    })

    it("rhdh_dependencies returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.rhdh_dependencies.execute(
        { kind: "Component", name: "svc" },
        {} as never,
      )
      expect(result).toContain("not configured")
    })
  })
})
