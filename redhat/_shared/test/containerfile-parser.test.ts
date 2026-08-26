import { describe, it, expect } from "bun:test"
import { parseContainerfile, extractDependencies } from "../src/containerfile-parser"

describe("parseContainerfile", () => {
  it("parses a single-stage Containerfile with FROM, RUN, COPY", () => {
    const content = [
      "FROM ubi9:9.4",
      "RUN dnf install -y python3",
      "COPY app.py /opt/app/",
    ].join("\n")

    const result = parseContainerfile(content)

    expect(result.stages).toHaveLength(1)
    expect(result.stages[0]!.from.image).toBe("ubi9")
    expect(result.stages[0]!.from.tag).toBe("9.4")
    expect(result.stages[0]!.instructions).toHaveLength(3)
  })

  it("parses a multi-stage Containerfile into separate stages", () => {
    const content = [
      "FROM ubi9:9.4 AS builder",
      "RUN dnf install -y gcc",
      "FROM ubi9-minimal:9.4",
      "COPY --from=builder /app /app",
    ].join("\n")

    const result = parseContainerfile(content)

    expect(result.stages).toHaveLength(2)
    expect(result.stages[0]!.from.alias).toBe("builder")
    expect(result.stages[1]!.from.image).toBe("ubi9-minimal")
    expect(result.stages[1]!.instructions[1]!.type).toBe("COPY")
    const copy = result.stages[1]!.instructions[1] as { from?: string }
    expect(copy.from).toBe("builder")
  })

  it("parses FROM with tag", () => {
    const result = parseContainerfile("FROM registry.access.redhat.com/ubi9:9.4")

    expect(result.stages[0]!.from.image).toBe("registry.access.redhat.com/ubi9")
    expect(result.stages[0]!.from.tag).toBe("9.4")
    expect(result.stages[0]!.from.digest).toBeUndefined()
  })

  it("parses FROM with digest", () => {
    const result = parseContainerfile("FROM ubi9@sha256:abc123def456")

    expect(result.stages[0]!.from.image).toBe("ubi9")
    expect(result.stages[0]!.from.digest).toBe("sha256:abc123def456")
    expect(result.stages[0]!.from.tag).toBeUndefined()
  })

  it("parses FROM with alias", () => {
    const result = parseContainerfile("FROM ubi9:9.4 AS builder")

    expect(result.stages[0]!.from.image).toBe("ubi9")
    expect(result.stages[0]!.from.tag).toBe("9.4")
    expect(result.stages[0]!.from.alias).toBe("builder")
  })

  it("handles multi-line RUN with backslash continuation", () => {
    const content = [
      "FROM ubi9",
      "RUN dnf install -y \\",
      "    python3 \\",
      "    gcc",
    ].join("\n")

    const result = parseContainerfile(content)

    const run = result.stages[0]!.instructions[1]!
    expect(run.type).toBe("RUN")
    expect((run as { command: string }).command).toBe("dnf install -y python3 gcc")
  })

  it("parses LABEL, ENV, USER, EXPOSE, and ARG directives", () => {
    const content = [
      "FROM ubi9",
      'LABEL maintainer="team@redhat.com"',
      'ENV APP_HOME="/opt/app"',
      "EXPOSE 8080/tcp",
      "USER 1001",
      "ARG VERSION=1.0",
    ].join("\n")

    const result = parseContainerfile(content)
    const instrs = result.stages[0]!.instructions

    const label = instrs.find((i) => i.type === "LABEL") as { key: string; value: string }
    expect(label.key).toBe("maintainer")
    expect(label.value).toBe("team@redhat.com")

    const env = instrs.find((i) => i.type === "ENV") as { key: string; value: string }
    expect(env.key).toBe("APP_HOME")
    expect(env.value).toBe("/opt/app")

    const expose = instrs.find((i) => i.type === "EXPOSE") as { port: number; protocol?: string }
    expect(expose.port).toBe(8080)
    expect(expose.protocol).toBe("tcp")

    const user = instrs.find((i) => i.type === "USER") as { user: string }
    expect(user.user).toBe("1001")

    const arg = instrs.find((i) => i.type === "ARG") as { name: string; defaultValue?: string }
    expect(arg.name).toBe("VERSION")
    expect(arg.defaultValue).toBe("1.0")
  })

  it("skips comments and blank lines", () => {
    const content = [
      "# This is a comment",
      "",
      "FROM ubi9",
      "# Another comment",
      "RUN echo hello",
      "",
    ].join("\n")

    const result = parseContainerfile(content)

    expect(result.stages).toHaveLength(1)
    expect(result.stages[0]!.instructions).toHaveLength(2)
  })

  it("returns empty stages for empty input", () => {
    const result = parseContainerfile("")

    expect(result.stages).toHaveLength(0)
    expect(result.globalArgs).toHaveLength(0)
  })

  it("captures global ARGs before first FROM", () => {
    const content = [
      "ARG BASE_IMAGE=ubi9",
      "ARG VERSION",
      "FROM ${BASE_IMAGE}:latest",
      "RUN echo hello",
    ].join("\n")

    const result = parseContainerfile(content)

    expect(result.globalArgs).toHaveLength(2)
    expect(result.globalArgs[0]!.name).toBe("BASE_IMAGE")
    expect(result.globalArgs[0]!.defaultValue).toBe("ubi9")
    expect(result.globalArgs[1]!.name).toBe("VERSION")
    expect(result.globalArgs[1]!.defaultValue).toBeUndefined()
    expect(result.stages).toHaveLength(1)
  })

  it("tracks line numbers correctly across multi-line instructions", () => {
    const content = [
      "FROM ubi9",
      "RUN dnf install -y \\",
      "    python3",
      "COPY app.py /opt/",
    ].join("\n")

    const result = parseContainerfile(content)
    const instrs = result.stages[0]!.instructions

    expect(instrs[0]!.lineNumber).toBe(1)
    expect(instrs[1]!.lineNumber).toBe(2)
    expect(instrs[2]!.lineNumber).toBe(4)
  })

  it("parses WORKDIR, CMD, and ENTRYPOINT as OtherDirective", () => {
    const content = [
      "FROM ubi9",
      "WORKDIR /opt/app",
      'ENTRYPOINT ["python3"]',
      'CMD ["app.py"]',
    ].join("\n")

    const result = parseContainerfile(content)
    const instrs = result.stages[0]!.instructions

    const workdir = instrs.find((i) => i.type === "WORKDIR") as { value: string }
    expect(workdir.value).toBe("/opt/app")

    const entrypoint = instrs.find((i) => i.type === "ENTRYPOINT") as { value: string }
    expect(entrypoint.value).toBe('["python3"]')

    const cmd = instrs.find((i) => i.type === "CMD") as { value: string }
    expect(cmd.value).toBe('["app.py"]')
  })
})

describe("extractDependencies", () => {
  it("extracts pip dependencies from RUN", () => {
    const content = [
      "FROM ubi9",
      "RUN pip install flask==2.3.0 requests",
    ].join("\n")

    const parsed = parseContainerfile(content)
    const deps = extractDependencies(parsed)

    expect(deps).toHaveLength(2)
    expect(deps[0]).toEqual({ name: "flask", version: "2.3.0", source: "pip" })
    expect(deps[1]).toEqual({ name: "requests", source: "pip" })
  })

  it("extracts npm dependencies from RUN", () => {
    const content = [
      "FROM node:18",
      "RUN npm install express@4.18.2 lodash",
    ].join("\n")

    const parsed = parseContainerfile(content)
    const deps = extractDependencies(parsed)

    expect(deps).toHaveLength(2)
    expect(deps[0]).toEqual({ name: "express", version: "4.18.2", source: "npm" })
    expect(deps[1]).toEqual({ name: "lodash", source: "npm" })
  })

  it("extracts dnf/yum dependencies from RUN", () => {
    const content = [
      "FROM ubi9",
      "RUN dnf install -y python3 gcc make",
    ].join("\n")

    const parsed = parseContainerfile(content)
    const deps = extractDependencies(parsed)

    expect(deps).toHaveLength(3)
    expect(deps[0]).toEqual({ name: "python3", source: "dnf" })
    expect(deps[1]).toEqual({ name: "gcc", source: "dnf" })
    expect(deps[2]).toEqual({ name: "make", source: "dnf" })
  })

  it("returns correct sources across multiple package managers", () => {
    const content = [
      "FROM ubi9",
      "RUN dnf install -y python3 && pip install flask",
    ].join("\n")

    const parsed = parseContainerfile(content)
    const deps = extractDependencies(parsed)

    const dnfDeps = deps.filter((d) => d.source === "dnf")
    const pipDeps = deps.filter((d) => d.source === "pip")

    expect(dnfDeps).toHaveLength(1)
    expect(dnfDeps[0]!.name).toBe("python3")
    expect(pipDeps).toHaveLength(1)
    expect(pipDeps[0]!.name).toBe("flask")
  })
})
