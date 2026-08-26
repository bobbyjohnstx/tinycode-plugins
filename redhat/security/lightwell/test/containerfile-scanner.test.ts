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

describe("lightwell_scan_containerfile", () => {
  it("is registered when plugin loads", async () => {
    const tools = await getTools(undefined)
    expect(tools.lightwell_scan_containerfile).toBeDefined()
    expect(tools.lightwell_scan_containerfile.description).toContain("Containerfile")
  })

  it("scans Containerfile with pip dependencies", async () => {
    setupFetch([
      {
        method: "GET",
        path: "/api/v1/packages/python/flask/2.3.0",
        body: { found: true, patchAvailable: true, cveCount: 2 },
      },
      {
        method: "GET",
        path: "/api/v1/packages/python/requests/2.31.0",
        body: { found: true, patchAvailable: false, cveCount: 0 },
      },
    ])

    const tools = await getTools(configuredOptions)
    const result = await tools.lightwell_scan_containerfile.execute(
      {
        content: [
          "FROM registry.access.redhat.com/ubi9/python-311:latest",
          "RUN pip install flask==2.3.0 requests==2.31.0",
          "COPY . /app",
          'CMD ["python", "app.py"]',
        ].join("\n"),
      },
      {} as never,
    )

    expect(result).toContain("2 checkable")
    expect(result).toContain("flask@2.3.0 (pip)")
    expect(result).toContain("PATCH")
    expect(result).toContain("requests@2.31.0 (pip)")
    expect(result).toContain("OK")
    expect(result).toContain("1 patches available")
    expect(result).toContain("2 total CVEs")
  })

  it("scans Containerfile with npm dependencies", async () => {
    setupFetch([
      {
        method: "GET",
        path: "/api/v1/packages/npm/express/4.18.0",
        body: { found: true, patchAvailable: false, cveCount: 1 },
      },
    ])

    const tools = await getTools(configuredOptions)
    const result = await tools.lightwell_scan_containerfile.execute(
      {
        content: [
          "FROM node:18",
          "WORKDIR /app",
          "RUN npm install express@4.18.0",
        ].join("\n"),
      },
      {} as never,
    )

    expect(result).toContain("1 checkable")
    expect(result).toContain("express@4.18.0 (npm)")
    expect(result).toContain("OK")
    expect(result).toContain("1 total CVEs")
  })

  it("scans Containerfile with maven dependencies", async () => {
    setupFetch([
      {
        method: "GET",
        path: "/api/v1/packages/java/maven-dependencies/latest",
        body: { found: true, patchAvailable: true, cveCount: 3 },
      },
    ])

    const tools = await getTools(configuredOptions)
    const result = await tools.lightwell_scan_containerfile.execute(
      {
        content: [
          "FROM maven:3.9 AS build",
          "COPY pom.xml .",
          "RUN mvn clean dependency:resolve",
          "FROM registry.access.redhat.com/ubi9/openjdk-17:latest",
          "COPY --from=build /app/target/*.jar /app/",
        ].join("\n"),
      },
      {} as never,
    )

    expect(result).toContain("1 checkable")
    expect(result).toContain("maven-dependencies@latest (maven)")
    expect(result).toContain("PATCH")
  })

  it("returns no-checkable message for Containerfile with only dnf deps", async () => {
    const tools = await getTools(configuredOptions)
    const result = await tools.lightwell_scan_containerfile.execute(
      {
        content: [
          "FROM registry.access.redhat.com/ubi9:latest",
          "RUN dnf install -y httpd mod_ssl",
        ].join("\n"),
      },
      {} as never,
    )

    expect(result).toContain("No Lightwell-checkable dependencies found")
    expect(result).toContain("Only pip, npm, and maven")
  })

  it("shows skipped deps alongside checked deps for mixed Containerfile", async () => {
    setupFetch([
      {
        method: "GET",
        path: "/api/v1/packages/python/flask/2.3.0",
        body: { found: true, patchAvailable: false, cveCount: 0 },
      },
    ])

    const tools = await getTools(configuredOptions)
    const result = await tools.lightwell_scan_containerfile.execute(
      {
        content: [
          "FROM registry.access.redhat.com/ubi9/python-311:latest",
          "RUN dnf install -y httpd",
          "RUN pip install flask==2.3.0",
        ].join("\n"),
      },
      {} as never,
    )

    expect(result).toContain("2 total, 1 checkable")
    expect(result).toContain("flask@2.3.0 (pip)")
    expect(result).toContain("Skipped (not Lightwell-relevant)")
    expect(result).toContain("httpd (dnf)")
  })

  it("returns graceful error for malformed Containerfile content", async () => {
    const tools = await getTools(configuredOptions)
    const result = await tools.lightwell_scan_containerfile.execute(
      { content: "this is not a valid containerfile at all" },
      {} as never,
    )

    expect(result).toContain("No Lightwell-checkable dependencies found")
  })

  it("uses 'latest' for dependencies without versions", async () => {
    setupFetch([
      {
        method: "GET",
        path: "/api/v1/packages/python/flask/latest",
        body: { found: true, patchAvailable: false, cveCount: 0 },
      },
    ])

    const tools = await getTools(configuredOptions)
    const result = await tools.lightwell_scan_containerfile.execute(
      {
        content: [
          "FROM python:3.11",
          "RUN pip install flask",
        ].join("\n"),
      },
      {} as never,
    )

    expect(result).toContain("flask@latest (pip)")
  })

  it("handles API error for one dep without crashing entire scan", async () => {
    setupFetch([
      {
        method: "GET",
        path: "/api/v1/packages/python/flask/2.3.0",
        status: 500,
        body: { error: "Internal error" },
      },
      {
        method: "GET",
        path: "/api/v1/packages/python/requests/2.31.0",
        body: { found: true, patchAvailable: false, cveCount: 0 },
      },
    ])

    const tools = await getTools(configuredOptions)
    const result = await tools.lightwell_scan_containerfile.execute(
      {
        content: [
          "FROM python:3.11",
          "RUN pip install flask==2.3.0 requests==2.31.0",
        ].join("\n"),
      },
      {} as never,
    )

    expect(result).toContain("flask@2.3.0 (pip) | ERROR")
    expect(result).toContain("requests@2.31.0 (pip)")
    expect(result).toContain("OK")
  })

  it("returns no-checkable message for empty Containerfile", async () => {
    const tools = await getTools(configuredOptions)
    const result = await tools.lightwell_scan_containerfile.execute(
      { content: "" },
      {} as never,
    )

    expect(result).toContain("No Lightwell-checkable dependencies found")
  })

  it("scans multi-stage build with deps in build stage", async () => {
    setupFetch([
      {
        method: "GET",
        path: "/api/v1/packages/npm/express/4.18.0",
        body: { found: true, patchAvailable: true, cveCount: 1 },
      },
      {
        method: "GET",
        path: "/api/v1/packages/npm/cors/2.8.5",
        body: { found: true, patchAvailable: false, cveCount: 0 },
      },
    ])

    const tools = await getTools(configuredOptions)
    const result = await tools.lightwell_scan_containerfile.execute(
      {
        content: [
          "FROM node:18 AS build",
          "WORKDIR /app",
          "RUN npm install express@4.18.0 cors@2.8.5",
          "RUN npm run build",
          "FROM node:18-slim",
          "COPY --from=build /app/dist /app/dist",
          'CMD ["node", "dist/index.js"]',
        ].join("\n"),
      },
      {} as never,
    )

    expect(result).toContain("2 checkable")
    expect(result).toContain("express@4.18.0 (npm)")
    expect(result).toContain("PATCH")
    expect(result).toContain("cors@2.8.5 (npm)")
    expect(result).toContain("1 patches available")
    expect(result).toContain("1 total CVEs")
  })

  it("reports NOT FOUND for packages not in Lightwell", async () => {
    setupFetch([
      {
        method: "GET",
        path: "/api/v1/packages/python/obscure-pkg/1.0.0",
        body: { found: false, ecosystem: "python", name: "obscure-pkg", version: "1.0.0" },
      },
    ])

    const tools = await getTools(configuredOptions)
    const result = await tools.lightwell_scan_containerfile.execute(
      {
        content: [
          "FROM python:3.11",
          "RUN pip install obscure-pkg==1.0.0",
        ].join("\n"),
      },
      {} as never,
    )

    expect(result).toContain("NOT FOUND")
    expect(result).toContain("obscure-pkg@1.0.0 (pip)")
  })
})
