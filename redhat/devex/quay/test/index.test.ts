import { describe, it, expect, afterEach } from "bun:test"
import { createMockInput, createMockFetch } from "tinycode-plugin-redhat-shared/test-utils"
import type { MockRoute } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const registryUrl = "https://quay.example.com"
const apiToken = "test-token"
const configuredOptions = { registryUrl, apiToken }

function setupFetch(routes: MockRoute[]) {
  globalThis.fetch = createMockFetch(routes)
}

async function getTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

describe("tinycode-plugin-quay", () => {
  describe("plugin loading", () => {
    it("loads without options and returns tools", async () => {
      const tools = await getTools(undefined)
      expect(tools).toBeDefined()
      expect(tools.quay_search).toBeDefined()
      expect(tools.quay_tags).toBeDefined()
      expect(tools.quay_manifest).toBeDefined()
      expect(tools.quay_vulnerabilities).toBeDefined()
      expect(tools.quay_labels).toBeDefined()
    })

    it("returns config-needed message when no options provided", async () => {
      const tools = await getTools(undefined)
      const result = await tools.quay_search.execute({ query: "nginx" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("loads with valid options and returns configured tools", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/find/repositories",
          body: { results: [] },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_search.execute({ query: "nginx" }, {} as never)
      expect(result).not.toContain("not configured")
    })
  })

  describe("quay_search", () => {
    it("returns formatted repository list on success", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/find/repositories",
          body: {
            results: [
              {
                namespace: "redhat",
                name: "ubi9",
                description: "Universal Base Image 9",
                star_count: 42,
                last_modified: 1700000000,
                is_public: true,
              },
              {
                namespace: "redhat",
                name: "ubi8",
                description: "Universal Base Image 8",
                star_count: 100,
                is_public: true,
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_search.execute({ query: "ubi" }, {} as never)
      expect(result).toContain('Repositories matching "ubi": 2')
      expect(result).toContain("redhat/ubi9")
      expect(result).toContain("42 stars")
      expect(result).toContain("Universal Base Image 9")
      expect(result).toContain("redhat/ubi8")
    })

    it("returns no-results message when no repositories match", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/find/repositories",
          body: { results: [] },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_search.execute({ query: "nonexistent" }, {} as never)
      expect(result).toContain('No repositories found matching "nonexistent"')
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/find/repositories",
          status: 500,
          body: { error: "Internal error" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_search.execute({ query: "test" }, {} as never)
      expect(result).toContain("Failed to search repositories")
      expect(result).toContain("500")
    })
  })

  describe("quay_tags", () => {
    it("returns formatted tag list on success", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/repository/redhat/ubi9/tag/",
          body: {
            tags: [
              {
                name: "latest",
                manifest_digest: "sha256:abc123def456789",
                size: 83886080,
                last_modified: "Mon, 01 Jan 2024 00:00:00 -0000",
              },
              {
                name: "9.3",
                manifest_digest: "sha256:def456abc789012",
                size: 78643200,
                last_modified: "Sun, 31 Dec 2023 00:00:00 -0000",
              },
            ],
            has_additional: false,
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_tags.execute({ repository: "redhat/ubi9" }, {} as never)
      expect(result).toContain("Tags for redhat/ubi9: 2")
      expect(result).toContain("latest")
      expect(result).toContain("sha256:abc123def456")
      expect(result).toContain("80MB")
      expect(result).toContain("9.3")
    })

    it("returns no-tags message when repository has no tags", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/repository/redhat/empty/tag/",
          body: { tags: [] },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_tags.execute({ repository: "redhat/empty" }, {} as never)
      expect(result).toContain("No tags found for redhat/empty")
    })

    it("returns error for invalid repository format", async () => {
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_tags.execute({ repository: "invalid-no-slash" }, {} as never)
      expect(result).toContain("Invalid repository format")
      expect(result).toContain("namespace/name")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/repository/redhat/ubi9/tag/",
          status: 404,
          body: { error: "not found" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_tags.execute({ repository: "redhat/ubi9" }, {} as never)
      expect(result).toContain("Failed to list tags")
    })
  })

  describe("quay_manifest", () => {
    it("returns formatted manifest details", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/repository/redhat/ubi9/manifest/sha256%3Aabc123",
          body: {
            digest: "sha256:abc123",
            is_manifest_list: false,
            config_media_type: "application/vnd.oci.image.config.v1+json",
            layers_compressed_size: 52428800,
            manifest_data: '{"schemaVersion":2}',
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_manifest.execute(
        { repository: "redhat/ubi9", digest: "sha256:abc123" },
        {} as never,
      )
      expect(result).toContain("sha256:abc123")
      expect(result).toContain("Manifest list: no")
      expect(result).toContain("application/vnd.oci.image.config.v1+json")
      expect(result).toContain("50MB")
      expect(result).toContain("schemaVersion")
    })

    it("returns error for invalid repository format", async () => {
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_manifest.execute(
        { repository: "noslash", digest: "sha256:abc" },
        {} as never,
      )
      expect(result).toContain("Invalid repository format")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/repository/redhat/ubi9/manifest/sha256%3Abad",
          status: 404,
          body: { error: "not found" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_manifest.execute(
        { repository: "redhat/ubi9", digest: "sha256:bad" },
        {} as never,
      )
      expect(result).toContain("Failed to get manifest")
    })
  })

  describe("quay_vulnerabilities", () => {
    it("returns formatted vulnerability list sorted by severity", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/repository/redhat/ubi9/manifest/sha256%3Aabc123/security",
          body: {
            status: "scanned",
            data: {
              Layer: {
                Features: [
                  {
                    Name: "openssl",
                    Version: "1.1.1",
                    Vulnerabilities: [
                      {
                        Name: "CVE-2023-0001",
                        Severity: "Low",
                        FixedBy: "1.1.2",
                      },
                    ],
                  },
                  {
                    Name: "curl",
                    Version: "7.88.0",
                    Vulnerabilities: [
                      {
                        Name: "CVE-2023-0002",
                        Severity: "Critical",
                        FixedBy: "7.88.1",
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_vulnerabilities.execute(
        { repository: "redhat/ubi9", digest: "sha256:abc123" },
        {} as never,
      )
      expect(result).toContain("Scan status: scanned")
      expect(result).toContain("Vulnerabilities found: 2")
      expect(result).toContain("CVE-2023-0002")
      expect(result).toContain("[Critical]")
      expect(result).toContain("curl@7.88.0")
      expect(result).toContain("CVE-2023-0001")
      expect(result).toContain("[Low]")
      // Critical should appear before Low
      const critIdx = result.indexOf("CVE-2023-0002")
      const lowIdx = result.indexOf("CVE-2023-0001")
      expect(critIdx).toBeLessThan(lowIdx)
    })

    it("returns no-vulnerabilities message when scan is clean", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/repository/redhat/ubi9/manifest/sha256%3Aclean/security",
          body: {
            status: "scanned",
            data: { Layer: { Features: [] } },
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_vulnerabilities.execute(
        { repository: "redhat/ubi9", digest: "sha256:clean" },
        {} as never,
      )
      expect(result).toContain("No vulnerabilities found")
    })

    it("returns error for invalid repository format", async () => {
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_vulnerabilities.execute(
        { repository: "bad", digest: "sha256:abc" },
        {} as never,
      )
      expect(result).toContain("Invalid repository format")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/repository/redhat/ubi9/manifest/sha256%3Aabc123/security",
          status: 403,
          body: { error: "Forbidden" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_vulnerabilities.execute(
        { repository: "redhat/ubi9", digest: "sha256:abc123" },
        {} as never,
      )
      expect(result).toContain("Failed to get vulnerabilities")
    })
  })

  describe("quay_labels", () => {
    it("returns formatted label list", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/repository/redhat/ubi9/manifest/sha256%3Aabc123/labels",
          body: {
            labels: [
              {
                id: "label-1",
                key: "maintainer",
                value: "Red Hat",
                source_type: "manifest",
                media_type: "text/plain",
              },
              {
                id: "label-2",
                key: "version",
                value: "9.3",
                source_type: "manifest",
                media_type: "text/plain",
              },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_labels.execute(
        { repository: "redhat/ubi9", digest: "sha256:abc123" },
        {} as never,
      )
      expect(result).toContain("Labels for redhat/ubi9@sha256:abc123: 2")
      expect(result).toContain("maintainer: Red Hat")
      expect(result).toContain("version: 9.3")
      expect(result).toContain("manifest")
    })

    it("returns no-labels message when manifest has no labels", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/repository/redhat/ubi9/manifest/sha256%3Anolabels/labels",
          body: { labels: [] },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_labels.execute(
        { repository: "redhat/ubi9", digest: "sha256:nolabels" },
        {} as never,
      )
      expect(result).toContain("No labels found")
    })

    it("returns error for invalid repository format", async () => {
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_labels.execute(
        { repository: "noslash", digest: "sha256:abc" },
        {} as never,
      )
      expect(result).toContain("Invalid repository format")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/repository/redhat/ubi9/manifest/sha256%3Aabc123/labels",
          status: 500,
          body: { error: "server error" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_labels.execute(
        { repository: "redhat/ubi9", digest: "sha256:abc123" },
        {} as never,
      )
      expect(result).toContain("Failed to get labels")
    })
  })

  describe("unconfigured tools return config message for all tools", () => {
    it("quay_tags returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.quay_tags.execute({ repository: "redhat/ubi9" }, {} as never)
      expect(result).toContain("not configured")
    })

    it("quay_manifest returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.quay_manifest.execute(
        { repository: "redhat/ubi9", digest: "sha256:abc" },
        {} as never,
      )
      expect(result).toContain("not configured")
    })

    it("quay_vulnerabilities returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.quay_vulnerabilities.execute(
        { repository: "redhat/ubi9", digest: "sha256:abc" },
        {} as never,
      )
      expect(result).toContain("not configured")
    })

    it("quay_labels returns config-needed", async () => {
      const tools = await getTools(undefined)
      const result = await tools.quay_labels.execute(
        { repository: "redhat/ubi9", digest: "sha256:abc" },
        {} as never,
      )
      expect(result).toContain("not configured")
    })
  })

  describe("repository name parsing", () => {
    it("rejects empty string", async () => {
      setupFetch([])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_tags.execute({ repository: "" }, {} as never)
      expect(result).toContain("Invalid repository format")
    })

    it("rejects single segment without slash", async () => {
      setupFetch([])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_tags.execute({ repository: "ubi9" }, {} as never)
      expect(result).toContain("Invalid repository format")
    })

    it("rejects triple-segment path", async () => {
      setupFetch([])
      const tools = await getTools(configuredOptions)
      const result = await tools.quay_tags.execute({ repository: "a/b/c" }, {} as never)
      expect(result).toContain("Invalid repository format")
    })
  })
})
