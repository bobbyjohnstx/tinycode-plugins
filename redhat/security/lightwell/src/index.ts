import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { createLightwellClient } from "./lightwell-client"
import { createContainerfileScannerTool } from "./containerfile-scanner"
import type { LightwellClient, PackageCheckResult, OsvVulnerability, ProvenanceResult } from "./lightwell-client"

const LIGHTWELL_BASE_URL = "https://packages.redhat.com/lightwell"

const optionsSchema = z
  .object({
    serviceAccountToken: z.string().optional(),
  })
  .optional()

type ParsedDep = { name: string; version: string }

function parsePomXml(content: string): ParsedDep[] {
  const deps: ParsedDep[] = []
  const depBlockRegex = /<dependency>\s*([\s\S]*?)<\/dependency>/g
  let match: RegExpExecArray | null

  while ((match = depBlockRegex.exec(content)) !== null) {
    const block = match[1] ?? ""
    const groupMatch = /<groupId>\s*([^<]+)\s*<\/groupId>/.exec(block)
    const artifactMatch = /<artifactId>\s*([^<]+)\s*<\/artifactId>/.exec(block)
    const versionMatch = /<version>\s*([^<]+)\s*<\/version>/.exec(block)
    if (groupMatch?.[1] && artifactMatch?.[1] && versionMatch?.[1]) {
      deps.push({
        name: `${groupMatch[1].trim()}:${artifactMatch[1].trim()}`,
        version: versionMatch[1].trim(),
      })
    }
  }

  return deps
}

function parseRequirementsTxt(content: string): ParsedDep[] {
  const deps: ParsedDep[] = []
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#") || line.startsWith("-")) {
      continue
    }
    const eqMatch = /^([a-zA-Z0-9_.-]+)==(.+)$/.exec(line)
    if (eqMatch?.[1] && eqMatch[2]) {
      deps.push({ name: eqMatch[1], version: eqMatch[2] })
      continue
    }
    const geMatch = /^([a-zA-Z0-9_.-]+)>=(.+)$/.exec(line)
    if (geMatch?.[1] && geMatch[2]) {
      deps.push({ name: geMatch[1], version: geMatch[2] })
    }
  }
  return deps
}

function parseDeps(content: string, fileType: string): ParsedDep[] | string {
  switch (fileType) {
    case "pom.xml":
      return parsePomXml(content)
    case "requirements.txt":
      return parseRequirementsTxt(content)
    default:
      return `Unsupported file type: ${fileType}. Supported types: pom.xml, requirements.txt`
  }
}

function formatPackageResult(result: PackageCheckResult): string {
  const lines = [
    `Package: ${result.ecosystem ?? "unknown"}/${result.name ?? "unknown"}@${result.version ?? "unknown"}`,
    `Found in Lightwell: ${result.found ? "Yes" : "No"}`,
  ]

  if (result.found) {
    if (result.lightwellVersion) {
      lines.push(`Lightwell Version (.rhlw): ${result.lightwellVersion}`)
    }
    lines.push(`Patch Available: ${result.patchAvailable ? "Yes" : "No"}`)
    lines.push(`CVE Count: ${result.cveCount ?? 0}`)

    const cves = result.cves ?? []
    if (cves.length > 0) {
      lines.push("")
      lines.push("CVEs:")
      for (const cve of cves) {
        const id = cve.id ?? "unknown"
        const severity = cve.severity ?? "UNKNOWN"
        const fixedIn = cve.fixedIn ?? "no fix"
        lines.push(`  - ${id} (${severity}) | Fixed in: ${fixedIn}`)
      }
    }
  }

  return lines.join("\n")
}

function formatOsvResult(ecosystem: string, name: string, vulns: OsvVulnerability[]): string {
  if (vulns.length === 0) {
    return `No known vulnerabilities found for ${ecosystem}/${name}.`
  }

  const lines = [
    `Vulnerabilities for ${ecosystem}/${name}: ${vulns.length} found`,
    "",
    ...vulns.map((v) => {
      const id = v.id ?? "unknown"
      const severity = v.severity ?? "UNKNOWN"
      const summary = v.summary ?? "No summary"
      return `- ${id} (${severity}): ${summary}`
    }),
  ]

  return lines.join("\n")
}

function formatProvenanceResult(result: ProvenanceResult): string {
  const lines = [
    `Provenance Verified: ${result.verified ? "Yes" : "No"}`,
    `SLSA Level: ${result.slsaLevel ?? "unknown"}`,
    `Build Type: ${result.buildType ?? "unknown"}`,
    `Builder: ${result.builder ?? "unknown"}`,
    `Source URI: ${result.sourceUri ?? "unknown"}`,
    `Digest: ${result.digest ?? "unknown"}`,
  ]

  const attestations = result.attestations ?? []
  if (attestations.length > 0) {
    lines.push("")
    lines.push("Attestations:")
    for (const att of attestations) {
      const type = att.type ?? "unknown"
      const verified = att.verified ? "verified" : "unverified"
      const issuer = att.issuer ?? "unknown issuer"
      lines.push(`  - ${type}: ${verified} (issuer: ${issuer})`)
    }
  }

  return lines.join("\n")
}

function checkConfigContent(content: string, fileType: string): string {
  const lightwellUrl = "packages.redhat.com/lightwell"
  const configured = content.includes(lightwellUrl)

  const lines = [`Config file type: ${fileType}`, `Lightwell repos configured: ${configured ? "Yes" : "No"}`]

  if (!configured) {
    lines.push("")
    lines.push("Suggestions:")
    switch (fileType) {
      case "settings.xml":
        lines.push("  - Add a <repository> entry pointing to https://packages.redhat.com/lightwell/maven")
        lines.push("  - Add a <mirror> element for Lightwell in your <mirrors> section")
        break
      case "build.gradle":
        lines.push("  - Add maven { url 'https://packages.redhat.com/lightwell/maven' } to repositories block")
        break
      case "pip.conf":
        lines.push("  - Set index-url = https://packages.redhat.com/lightwell/pypi/simple/ in [global] section")
        break
      default:
        lines.push(`  - Configure your build tool to use https://${lightwellUrl} as a package repository`)
    }
  } else {
    lines.push("")
    lines.push("Lightwell repository URL detected in configuration.")
  }

  return lines.join("\n")
}

function createTools(client: LightwellClient): Record<string, ToolDefinition> {
  return {
    lightwell_check_package: {
      description:
        "Check a single package against Red Hat Lightwell remediated/validated repos. Returns patch availability, .rhlw version, and CVE count.",
      args: {
        ecosystem: z.enum(["java", "python"]).describe("Package ecosystem (java or python)"),
        name: z.string().describe("Package name (groupId:artifactId for java, package name for python)"),
        version: z.string().describe("Package version"),
      },
      async execute(args: { ecosystem: string; name: string; version: string }) {
        try {
          const result = await client.checkPackage(args.ecosystem, args.name, args.version)
          return formatPackageResult(result)
        } catch (error) {
          return `Failed to check package: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    lightwell_check_deps: {
      description:
        "Parse a dependency manifest file and check each dependency against Lightwell repos. Returns a summary table with patch availability and CVE counts.",
      args: {
        content: z.string().describe("File contents of the dependency manifest"),
        fileType: z
          .enum(["pom.xml", "requirements.txt", "build.gradle", "Pipfile.lock"])
          .describe("Type of dependency file"),
      },
      async execute(args: { content: string; fileType: string }) {
        const parsed = parseDeps(args.content, args.fileType)
        if (typeof parsed === "string") {
          return parsed
        }

        if (parsed.length === 0) {
          return `No dependencies found in ${args.fileType} content.`
        }

        const ecosystem = args.fileType === "pom.xml" || args.fileType === "build.gradle" ? "java" : "python"
        const results: string[] = [`Dependencies checked: ${parsed.length}`, `Ecosystem: ${ecosystem}`, ""]

        let patchCount = 0
        let cveTotal = 0

        for (const dep of parsed) {
          try {
            const result = await client.checkPackage(ecosystem, dep.name, dep.version)
            const status = result.found ? (result.patchAvailable ? "PATCH" : "OK") : "NOT FOUND"
            const cves = result.cveCount ?? 0
            cveTotal += cves
            if (result.patchAvailable) patchCount++
            results.push(`  ${dep.name}@${dep.version} | ${status} | CVEs: ${cves}`)
          } catch (_error) {
            results.push(`  ${dep.name}@${dep.version} | ERROR | Could not check`)
          }
        }

        results.push("")
        results.push(`Summary: ${patchCount} patches available, ${cveTotal} total CVEs across ${parsed.length} dependencies`)

        return results.join("\n")
      },
    },

    lightwell_osv: {
      description:
        "Query OSV vulnerability data for a package. Returns a list of known vulnerabilities with severity and summaries.",
      args: {
        ecosystem: z.enum(["java", "python"]).describe("Package ecosystem (java or python)"),
        name: z.string().describe("Package name"),
      },
      async execute(args: { ecosystem: string; name: string }) {
        try {
          const result = await client.queryOsv(args.ecosystem, args.name)
          return formatOsvResult(args.ecosystem, args.name, result.vulnerabilities ?? [])
        } catch (error) {
          return `Failed to query OSV: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    lightwell_provenance: {
      description:
        "Verify SLSA build provenance for a Lightwell artifact. Returns attestation status, build type, and SLSA level.",
      args: {
        ecosystem: z.enum(["java", "python"]).describe("Package ecosystem (java or python)"),
        name: z.string().describe("Package name"),
        version: z.string().describe("Package version"),
      },
      async execute(args: { ecosystem: string; name: string; version: string }) {
        try {
          const result = await client.getProvenance(args.ecosystem, args.name, args.version)
          return formatProvenanceResult(result)
        } catch (error) {
          return `Failed to verify provenance: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    lightwell_config_check: {
      description:
        "Analyze build tool configuration content to check if it is configured to use Lightwell repos. Returns configured status and suggestions.",
      args: {
        content: z.string().describe("File contents of the build tool configuration"),
        fileType: z
          .enum(["settings.xml", "build.gradle", "pip.conf"])
          .describe("Type of configuration file"),
      },
      async execute(args: { content: string; fileType: string }) {
        return checkConfigContent(args.content, args.fileType)
      },
    },
  }
}

export default {
  schema: optionsSchema,
  server: async (_input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined

    const token = parsed?.serviceAccountToken
    const client = createLightwellClient(LIGHTWELL_BASE_URL, token)

    return {
      tool: { ...createTools(client), ...createContainerfileScannerTool(client) },
    }
  },
} satisfies PluginModule
