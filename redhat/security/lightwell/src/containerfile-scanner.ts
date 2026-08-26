import type { ToolDefinition } from "tinycode-plugin"
import type { LightwellClient } from "./lightwell-client"
import { parseContainerfile, extractDependencies } from "tinycode-plugin-redhat-shared/containerfile-parser"
import { z } from "zod"

const ecosystemMap: Record<string, string> = {
  pip: "python",
  npm: "npm",
  maven: "java",
}

const LIGHTWELL_ECOSYSTEMS = new Set(["pip", "npm", "maven"])

export function createContainerfileScannerTool(client: LightwellClient): Record<string, ToolDefinition> {
  return {
    lightwell_scan_containerfile: {
      description:
        "Parse a Containerfile/Dockerfile and check extracted dependencies (pip, npm, maven) against Lightwell repos for patches and vulnerabilities.",
      args: {
        content: z.string().describe("Content of the Containerfile or Dockerfile"),
      },
      async execute(args: { content: string }) {
        try {
          const parsed = parseContainerfile(args.content)
          const deps = extractDependencies(parsed)

          const lightwellDeps = deps.filter((d) => LIGHTWELL_ECOSYSTEMS.has(d.source))

          if (lightwellDeps.length === 0) {
            return "No Lightwell-checkable dependencies found in Containerfile. (Only pip, npm, and maven dependencies are checked.)"
          }

          const results: string[] = [
            `Dependencies found in Containerfile: ${deps.length} total, ${lightwellDeps.length} checkable`,
            "",
          ]

          let patchCount = 0
          let cveTotal = 0

          for (const dep of lightwellDeps) {
            const eco = ecosystemMap[dep.source] ?? dep.source
            const version = dep.version ?? "latest"

            try {
              const result = await client.checkPackage(eco, dep.name, version)
              const status = result.found ? (result.patchAvailable ? "PATCH" : "OK") : "NOT FOUND"
              const cves = result.cveCount ?? 0
              cveTotal += cves
              if (result.patchAvailable) patchCount++
              results.push(`  ${dep.name}@${version} (${dep.source}) | ${status} | CVEs: ${cves}`)
            } catch {
              results.push(`  ${dep.name}@${version} (${dep.source}) | ERROR | Could not check`)
            }
          }

          const skipped = deps.filter((d) => !LIGHTWELL_ECOSYSTEMS.has(d.source))
          if (skipped.length > 0) {
            results.push("")
            results.push(
              `Skipped (not Lightwell-relevant): ${skipped.map((d) => `${d.name} (${d.source})`).join(", ")}`,
            )
          }

          results.push("")
          results.push(
            `Summary: ${patchCount} patches available, ${cveTotal} total CVEs across ${lightwellDeps.length} dependencies`,
          )

          return results.join("\n")
        } catch (error) {
          return `Containerfile scan failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}
