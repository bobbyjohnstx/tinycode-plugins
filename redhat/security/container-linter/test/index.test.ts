import { describe, it, expect } from "bun:test"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

async function getTools(options?: Record<string, unknown>) {
  const input = createMockInput()
  const hooks = await plugin.server(input, options)
  return hooks.tool!
}

const CLEAN_CONTAINERFILE = [
  "FROM registry.access.redhat.com/ubi9/ubi:9.5",
  'LABEL name="my-app"',
  'LABEL version="1.0"',
  'LABEL summary="My application"',
  "RUN dnf install -y httpd && dnf clean all",
  "COPY app /app",
  "USER 1001",
  "CMD ['/app/start.sh']",
].join("\n")

describe("tinycode-plugin-container-linter", () => {
  describe("plugin loading", () => {
    it("loads without error", async () => {
      const tools = await getTools(undefined)
      expect(tools).toBeDefined()
    })

    it("registers all three tools", async () => {
      const tools = await getTools()
      expect(tools.container_lint).toBeDefined()
      expect(tools.bootc_validate).toBeDefined()
      expect(tools.container_base_suggest).toBeDefined()
    })

    it("all tools have descriptions", async () => {
      const tools = await getTools()
      expect(tools.container_lint.description).toBeTruthy()
      expect(tools.bootc_validate.description).toBeTruthy()
      expect(tools.container_base_suggest.description).toBeTruthy()
    })
  })

  describe("container_lint", () => {
    it("detects non-UBI base image", async () => {
      const tools = await getTools()
      const result = (await tools.container_lint.execute(
        { content: "FROM ubuntu:22.04\nUSER 1001" },
        {} as never,
      )) as string
      expect(result).toContain("non-ubi-base")
      expect(result).toContain("WARNING")
    })

    it("accepts UBI base image", async () => {
      const tools = await getTools()
      const result = (await tools.container_lint.execute(
        { content: CLEAN_CONTAINERFILE },
        {} as never,
      )) as string
      expect(result).not.toContain("non-ubi-base")
    })

    it("detects latest tag", async () => {
      const tools = await getTools()
      const result = (await tools.container_lint.execute(
        { content: "FROM node:latest\nUSER 1001" },
        {} as never,
      )) as string
      expect(result).toContain("latest-tag")
      expect(result).toContain(":latest tag")
    })

    it("detects missing tag", async () => {
      const tools = await getTools()
      const result = (await tools.container_lint.execute(
        { content: "FROM node\nUSER 1001" },
        {} as never,
      )) as string
      expect(result).toContain("latest-tag")
      expect(result).toContain("implicit latest")
    })

    it("detects root user without reset", async () => {
      const tools = await getTools()
      const content = [
        "FROM registry.access.redhat.com/ubi9/ubi:9.5",
        'LABEL name="app" version="1.0" summary="test"',
        "USER root",
        "RUN dnf install -y httpd",
      ].join("\n")
      const result = (await tools.container_lint.execute(
        { content },
        {} as never,
      )) as string
      expect(result).toContain("root-user")
      expect(result).toContain("ERROR")
    })

    it("accepts root user with reset", async () => {
      const tools = await getTools()
      const content = [
        "FROM registry.access.redhat.com/ubi9/ubi:9.5",
        'LABEL name="app" version="1.0" summary="test"',
        "USER root",
        "RUN dnf install -y httpd",
        "USER 1001",
      ].join("\n")
      const result = (await tools.container_lint.execute(
        { content },
        {} as never,
      )) as string
      expect(result).not.toContain("root-user")
    })

    it("detects missing labels", async () => {
      const tools = await getTools()
      const result = (await tools.container_lint.execute(
        { content: "FROM registry.access.redhat.com/ubi9/ubi:9.5\nUSER 1001" },
        {} as never,
      )) as string
      expect(result).toContain("missing-labels")
      expect(result).toContain("INFO")
    })

    it("accepts present labels", async () => {
      const tools = await getTools()
      const result = (await tools.container_lint.execute(
        { content: CLEAN_CONTAINERFILE },
        {} as never,
      )) as string
      expect(result).not.toContain("missing-labels")
    })

    it("detects consecutive RUN layers", async () => {
      const tools = await getTools()
      const content = [
        "FROM registry.access.redhat.com/ubi9/ubi:9.5",
        'LABEL name="app" version="1.0" summary="test"',
        "RUN dnf install -y httpd",
        "RUN dnf install -y python3",
        "RUN dnf clean all",
        "USER 1001",
      ].join("\n")
      const result = (await tools.container_lint.execute(
        { content },
        {} as never,
      )) as string
      expect(result).toContain("run-layer-chaining")
    })

    it("detects hardcoded secrets in ENV", async () => {
      const tools = await getTools()
      const content = [
        "FROM registry.access.redhat.com/ubi9/ubi:9.5",
        'LABEL name="app" version="1.0" summary="test"',
        'ENV DB_PASSWORD=secret123',
        "USER 1001",
      ].join("\n")
      const result = (await tools.container_lint.execute(
        { content },
        {} as never,
      )) as string
      expect(result).toContain("hardcoded-secret")
      expect(result).toContain("ERROR")
      expect(result).toContain("DB_PASSWORD")
    })

    it("detects ARG with token", async () => {
      const tools = await getTools()
      const content = [
        "FROM registry.access.redhat.com/ubi9/ubi:9.5",
        'LABEL name="app" version="1.0" summary="test"',
        "ARG API_TOKEN",
        "USER 1001",
      ].join("\n")
      const result = (await tools.container_lint.execute(
        { content },
        {} as never,
      )) as string
      expect(result).toContain("hardcoded-secret")
      expect(result).toContain("API_TOKEN")
    })

    it("detects missing USER directive", async () => {
      const tools = await getTools()
      const content = [
        "FROM registry.access.redhat.com/ubi9/ubi:9.5",
        'LABEL name="app" version="1.0" summary="test"',
        "RUN dnf install -y httpd && dnf clean all",
        "COPY app /app",
      ].join("\n")
      const result = (await tools.container_lint.execute(
        { content },
        {} as never,
      )) as string
      expect(result).toContain("missing-user-directive")
      expect(result).toContain("WARNING")
    })

    it("returns no issues for clean Containerfile", async () => {
      const tools = await getTools()
      const result = (await tools.container_lint.execute(
        { content: CLEAN_CONTAINERFILE },
        {} as never,
      )) as string
      expect(result).toContain("No issues found")
      expect(result).toContain("best practices")
    })
  })

  describe("bootc_validate", () => {
    it("validates bootc-compatible image", async () => {
      const tools = await getTools()
      const content = [
        "FROM registry.redhat.io/rhel9/rhel-bootc:9.4",
        'LABEL bootc.diskimage-builder="true"',
        "COPY my-service.service /etc/systemd/system/my-service.service",
        "RUN systemctl enable my-service",
      ].join("\n")
      const result = (await tools.bootc_validate.execute(
        { content },
        {} as never,
      )) as string
      expect(result).toContain("PASS")
      expect(result).toContain("bootc-compatible")
    })

    it("rejects non-bootc base image", async () => {
      const tools = await getTools()
      const content = [
        "FROM registry.access.redhat.com/ubi9/ubi:9.5",
        "RUN dnf install -y httpd",
      ].join("\n")
      const result = (await tools.bootc_validate.execute(
        { content },
        {} as never,
      )) as string
      expect(result).toContain("FAIL")
      expect(result).toContain("not a recognized bootc base")
    })
  })

  describe("container_base_suggest", () => {
    it("suggests Java image for java use case", async () => {
      const tools = await getTools()
      const result = (await tools.container_base_suggest.execute(
        { useCase: "Java microservice with Quarkus" },
        {} as never,
      )) as string
      expect(result).toContain("openjdk-21-runtime")
    })

    it("suggests Python image for python use case", async () => {
      const tools = await getTools()
      const result = (await tools.container_base_suggest.execute(
        { useCase: "Python Flask API" },
        {} as never,
      )) as string
      expect(result).toContain("python-312")
    })

    it("suggests Node image for nodejs use case", async () => {
      const tools = await getTools()
      const result = (await tools.container_base_suggest.execute(
        { useCase: "nodejs backend server" },
        {} as never,
      )) as string
      expect(result).toContain("nodejs-22")
    })

    it("suggests default image for generic use case", async () => {
      const tools = await getTools()
      const result = (await tools.container_base_suggest.execute(
        { useCase: "generic web server" },
        {} as never,
      )) as string
      expect(result).toContain("ubi9/ubi:9.5")
    })
  })
})
