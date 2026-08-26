import { describe, it, expect, afterEach } from "bun:test"
import { createMockInput, createMockFetch } from "tinycode-plugin-redhat-shared/test-utils"
import type { MockRoute } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function setupFetch(routes: MockRoute[]) {
  globalThis.fetch = createMockFetch(routes)
}

async function getTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

const configuredOptions = { serviceAccountToken: "test-token" }

describe("tinycode-plugin-lightwell", () => {
  describe("plugin loading", () => {
    it("loads without options and returns all tools", async () => {
      const tools = await getTools(undefined)
      expect(tools).toBeDefined()
      expect(tools.lightwell_check_package).toBeDefined()
      expect(tools.lightwell_check_deps).toBeDefined()
      expect(tools.lightwell_osv).toBeDefined()
      expect(tools.lightwell_provenance).toBeDefined()
      expect(tools.lightwell_config_check).toBeDefined()
    })

    it("loads with serviceAccountToken and returns tools", async () => {
      setupFetch([
        { method: "GET", path: "/api/v1/packages/java/org.apache:commons/1.0", body: { found: true } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_check_package.execute(
        { ecosystem: "java", name: "org.apache:commons", version: "1.0" },
        {} as never,
      )
      expect(result).toContain("Found in Lightwell: Yes")
    })
  })

  describe("lightwell_check_package", () => {
    it("returns package info with patch available", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/packages/java/org.springframework:spring-core/5.3.20",
          body: {
            found: true,
            ecosystem: "java",
            name: "org.springframework:spring-core",
            version: "5.3.20",
            lightwellVersion: "5.3.20-redhat-00001",
            patchAvailable: true,
            cveCount: 3,
            cves: [
              { id: "CVE-2023-1234", severity: "HIGH", fixedIn: "5.3.21-redhat-00001" },
              { id: "CVE-2023-5678", severity: "MEDIUM", fixedIn: "5.3.20-redhat-00002" },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_check_package.execute(
        { ecosystem: "java", name: "org.springframework:spring-core", version: "5.3.20" },
        {} as never,
      )
      expect(result).toContain("Found in Lightwell: Yes")
      expect(result).toContain("5.3.20-redhat-00001")
      expect(result).toContain("Patch Available: Yes")
      expect(result).toContain("CVE Count: 3")
      expect(result).toContain("CVE-2023-1234")
      expect(result).toContain("HIGH")
    })

    it("returns not found for unknown package", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/packages/python/unknown-pkg/0.0.1",
          body: { found: false, ecosystem: "python", name: "unknown-pkg", version: "0.0.1" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_check_package.execute(
        { ecosystem: "python", name: "unknown-pkg", version: "0.0.1" },
        {} as never,
      )
      expect(result).toContain("Found in Lightwell: No")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/api/v1/packages/java/bad/1.0", status: 500, body: { error: "Internal error" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_check_package.execute(
        { ecosystem: "java", name: "bad", version: "1.0" },
        {} as never,
      )
      expect(result).toContain("Failed to check package")
      expect(result).toContain("500")
    })
  })

  describe("lightwell_check_deps", () => {
    it("parses pom.xml and checks each dependency", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/packages/java/org.apache:commons-lang3/3.12.0",
          body: { found: true, patchAvailable: true, cveCount: 1 },
        },
        {
          method: "GET",
          path: "/api/v1/packages/java/com.google:guava/31.1",
          body: { found: true, patchAvailable: false, cveCount: 0 },
        },
      ])
      const pomContent = `<dependencies>
  <dependency>
    <groupId>org.apache</groupId>
    <artifactId>commons-lang3</artifactId>
    <version>3.12.0</version>
  </dependency>
  <dependency>
    <groupId>com.google</groupId>
    <artifactId>guava</artifactId>
    <version>31.1</version>
  </dependency>
</dependencies>`
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_check_deps.execute(
        { content: pomContent, fileType: "pom.xml" },
        {} as never,
      )
      expect(result).toContain("Dependencies checked: 2")
      expect(result).toContain("Ecosystem: java")
      expect(result).toContain("org.apache:commons-lang3@3.12.0")
      expect(result).toContain("PATCH")
      expect(result).toContain("com.google:guava@31.1")
      expect(result).toContain("OK")
      expect(result).toContain("1 patches available")
    })

    it("parses requirements.txt and checks each dependency", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/packages/python/requests/2.28.0",
          body: { found: true, patchAvailable: false, cveCount: 0 },
        },
        {
          method: "GET",
          path: "/api/v1/packages/python/flask/2.3.0",
          body: { found: true, patchAvailable: true, cveCount: 2 },
        },
      ])
      const reqContent = `# requirements
requests==2.28.0
flask>=2.3.0
# comment line
-r other-requirements.txt`
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_check_deps.execute(
        { content: reqContent, fileType: "requirements.txt" },
        {} as never,
      )
      expect(result).toContain("Dependencies checked: 2")
      expect(result).toContain("Ecosystem: python")
      expect(result).toContain("requests@2.28.0")
      expect(result).toContain("flask@2.3.0")
      expect(result).toContain("1 patches available")
      expect(result).toContain("2 total CVEs")
    })

    it("returns unsupported message for Pipfile.lock", async () => {
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_check_deps.execute(
        { content: "{}", fileType: "Pipfile.lock" },
        {} as never,
      )
      expect(result).toContain("Unsupported file type")
      expect(result).toContain("Pipfile.lock")
    })

    it("returns unsupported message for build.gradle", async () => {
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_check_deps.execute(
        { content: "dependencies {}", fileType: "build.gradle" },
        {} as never,
      )
      expect(result).toContain("Unsupported file type")
      expect(result).toContain("build.gradle")
    })

    it("returns no-deps message for empty pom.xml", async () => {
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_check_deps.execute(
        { content: "<project></project>", fileType: "pom.xml" },
        {} as never,
      )
      expect(result).toContain("No dependencies found")
    })

    it("handles API errors for individual deps gracefully", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/packages/python/broken-pkg/1.0.0",
          status: 500,
          body: { error: "fail" },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_check_deps.execute(
        { content: "broken-pkg==1.0.0", fileType: "requirements.txt" },
        {} as never,
      )
      expect(result).toContain("broken-pkg@1.0.0")
      expect(result).toContain("ERROR")
    })
  })

  describe("lightwell_osv", () => {
    it("returns vulnerability list", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/osv/java/log4j",
          body: {
            vulnerabilities: [
              { id: "CVE-2021-44228", severity: "CRITICAL", summary: "Log4Shell RCE" },
              { id: "CVE-2021-45046", severity: "HIGH", summary: "DoS in Log4j" },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_osv.execute(
        { ecosystem: "java", name: "log4j" },
        {} as never,
      )
      expect(result).toContain("2 found")
      expect(result).toContain("CVE-2021-44228")
      expect(result).toContain("CRITICAL")
      expect(result).toContain("Log4Shell RCE")
      expect(result).toContain("CVE-2021-45046")
    })

    it("returns no vulnerabilities message when clean", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/osv/python/safe-pkg",
          body: { vulnerabilities: [] },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_osv.execute(
        { ecosystem: "python", name: "safe-pkg" },
        {} as never,
      )
      expect(result).toContain("No known vulnerabilities found")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/api/v1/osv/java/bad", status: 503, body: { error: "unavailable" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_osv.execute(
        { ecosystem: "java", name: "bad" },
        {} as never,
      )
      expect(result).toContain("Failed to query OSV")
    })
  })

  describe("lightwell_provenance", () => {
    it("returns verified provenance with attestations", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/provenance/java/org.apache:commons/3.12.0",
          body: {
            verified: true,
            buildType: "maven",
            builder: "Red Hat Trusted Build",
            sourceUri: "https://github.com/apache/commons-lang",
            digest: "sha256:abc123",
            slsaLevel: "SLSA Build L3",
            attestations: [
              { type: "SLSA Provenance", verified: true, issuer: "Red Hat Sigstore" },
            ],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_provenance.execute(
        { ecosystem: "java", name: "org.apache:commons", version: "3.12.0" },
        {} as never,
      )
      expect(result).toContain("Provenance Verified: Yes")
      expect(result).toContain("SLSA Build L3")
      expect(result).toContain("Red Hat Trusted Build")
      expect(result).toContain("SLSA Provenance")
      expect(result).toContain("verified")
      expect(result).toContain("Red Hat Sigstore")
    })

    it("returns unverified provenance", async () => {
      setupFetch([
        {
          method: "GET",
          path: "/api/v1/provenance/python/requests/2.28.0",
          body: {
            verified: false,
            slsaLevel: "unknown",
            attestations: [],
          },
        },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_provenance.execute(
        { ecosystem: "python", name: "requests", version: "2.28.0" },
        {} as never,
      )
      expect(result).toContain("Provenance Verified: No")
    })

    it("returns error message on API failure", async () => {
      setupFetch([
        { method: "GET", path: "/api/v1/provenance/java/bad/1.0", status: 404, body: { error: "not found" } },
      ])
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_provenance.execute(
        { ecosystem: "java", name: "bad", version: "1.0" },
        {} as never,
      )
      expect(result).toContain("Failed to verify provenance")
    })
  })

  describe("lightwell_config_check", () => {
    it("detects configured settings.xml", async () => {
      const settingsXml = `<settings>
  <mirrors>
    <mirror>
      <url>https://packages.redhat.com/lightwell/maven</url>
    </mirror>
  </mirrors>
</settings>`
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_config_check.execute(
        { content: settingsXml, fileType: "settings.xml" },
        {} as never,
      )
      expect(result).toContain("Lightwell repos configured: Yes")
      expect(result).toContain("Lightwell repository URL detected")
    })

    it("detects unconfigured settings.xml and suggests fix", async () => {
      const settingsXml = `<settings>
  <mirrors>
    <mirror>
      <url>https://repo1.maven.org/maven2</url>
    </mirror>
  </mirrors>
</settings>`
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_config_check.execute(
        { content: settingsXml, fileType: "settings.xml" },
        {} as never,
      )
      expect(result).toContain("Lightwell repos configured: No")
      expect(result).toContain("Suggestions")
      expect(result).toContain("<repository>")
    })

    it("detects unconfigured pip.conf and suggests fix", async () => {
      const pipConf = `[global]
index-url = https://pypi.org/simple/`
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_config_check.execute(
        { content: pipConf, fileType: "pip.conf" },
        {} as never,
      )
      expect(result).toContain("Lightwell repos configured: No")
      expect(result).toContain("index-url")
    })

    it("detects unconfigured build.gradle and suggests fix", async () => {
      const gradle = `repositories {
    mavenCentral()
}`
      const tools = await getTools(configuredOptions)
      const result = await tools.lightwell_config_check.execute(
        { content: gradle, fileType: "build.gradle" },
        {} as never,
      )
      expect(result).toContain("Lightwell repos configured: No")
      expect(result).toContain("maven { url")
    })
  })
})
