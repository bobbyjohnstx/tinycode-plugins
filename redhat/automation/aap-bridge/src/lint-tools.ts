import type { PluginInput, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"

interface LintViolation {
  type: string
  check_name: string
  categories: string[]
  severity: string
  description: string
  location: {
    path: string
    lines: { begin: number; end: number }
  }
  content?: { body?: string }
}

function formatViolations(violations: LintViolation[], profile: string): string {
  const lines = [
    `Violations found: ${violations.length} (profile: ${profile})`,
    "",
    ...violations.map((v) => {
      const path = v.location?.path ?? "unknown"
      const line = v.location?.lines?.begin ?? "?"
      const header = `- [${v.severity}] ${v.check_name} at ${path}:${line}`
      const desc = v.description ? `  ${v.description}` : ""
      return desc ? `${header}\n${desc}` : header
    }),
  ]

  return lines.join("\n")
}

export function createLintTools($: PluginInput["$"]): Record<string, ToolDefinition> {
  return {
    aap_lint_playbook: {
      description:
        "Lint an Ansible playbook or role using ansible-lint. Returns structured violations with rule, severity, line number, and fix suggestions.",
      args: {
        filePath: z.string().describe("Path to the playbook YAML file to lint"),
        profile: z
          .string()
          .optional()
          .describe("Lint profile: production (default), shared, basic, or safety"),
      },
      async execute(args: { filePath: string; profile?: string }) {
        try {
          const which = await $`which ansible-lint`.nothrow().quiet()
          if (which.exitCode !== 0) {
            return "ansible-lint not found. Install with: pip install ansible-lint (included in ansible-dev-tools)"
          }

          const profile = args.profile ?? "production"
          const result = await $`ansible-lint ${args.filePath} --format json -p ${profile}`.nothrow().quiet()

          const output = result.text()

          if (result.exitCode === 0) {
            return `Playbook ${args.filePath} passed all lint checks (profile: ${profile}).`
          }

          if (result.exitCode === 1 && !output.trim().startsWith("[")) {
            return `ansible-lint error: ${output}`
          }

          const violations: LintViolation[] = JSON.parse(output)
          return formatViolations(violations, profile)
        } catch (error) {
          return `Lint failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}
