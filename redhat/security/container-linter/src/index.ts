import type { Hooks, PluginModule, ToolDefinition } from "tinycode-plugin"
import { z } from "zod"
import { parseContainerfile } from "tinycode-plugin-redhat-shared/containerfile-parser"
import { runLintRules } from "./lint-rules"
import type { LintWarning } from "./lint-rules"

const optionsSchema = z
  .object({
    autoLint: z.boolean().optional().describe("Auto-lint on Containerfile edit"),
  })
  .optional()

type BaseSuggestion = {
  image: string
  rationale: string
}

const BASE_IMAGE_LOOKUP: Array<{ keywords: string[]; suggestion: BaseSuggestion }> = [
  {
    keywords: ["java", "quarkus"],
    suggestion: {
      image: "registry.access.redhat.com/ubi9/openjdk-21-runtime:1.20",
      rationale: "OpenJDK 21 runtime optimized for Java/Quarkus workloads on UBI 9.",
    },
  },
  {
    keywords: ["python"],
    suggestion: {
      image: "registry.access.redhat.com/ubi9/python-312:1",
      rationale: "Python 3.12 runtime on UBI 9 with pip and virtualenv pre-installed.",
    },
  },
  {
    keywords: ["node", "nodejs"],
    suggestion: {
      image: "registry.access.redhat.com/ubi9/nodejs-22:1",
      rationale: "Node.js 22 runtime on UBI 9 for server-side JavaScript workloads.",
    },
  },
  {
    keywords: ["go", "golang"],
    suggestion: {
      image: "registry.access.redhat.com/ubi9/ubi-minimal:9.5",
      rationale:
        "Go compiles to static binaries. Use ubi-minimal as a lightweight runtime base.",
    },
  },
  {
    keywords: ["minimal"],
    suggestion: {
      image: "registry.access.redhat.com/ubi9/ubi-minimal:9.5",
      rationale: "Minimal UBI image with microdnf. Suitable for compiled or minimal apps.",
    },
  },
  {
    keywords: ["micro"],
    suggestion: {
      image: "registry.access.redhat.com/ubi9/ubi-micro:9.5",
      rationale:
        "Smallest UBI image with no package manager. Best for static binaries.",
    },
  },
]

const DEFAULT_SUGGESTION: BaseSuggestion = {
  image: "registry.access.redhat.com/ubi9/ubi:9.5",
  rationale: "General-purpose UBI 9 base image with dnf and full RHEL userspace.",
}

function formatWarnings(warnings: LintWarning[]): string {
  if (warnings.length === 0) {
    return "No issues found. Containerfile follows Red Hat best practices."
  }

  const grouped: Record<string, LintWarning[]> = { error: [], warning: [], info: [] }
  for (const w of warnings) {
    grouped[w.severity]!.push(w)
  }

  const lines: string[] = []
  for (const severity of ["error", "warning", "info"] as const) {
    const group = grouped[severity]!
    if (group.length === 0) continue
    lines.push(`--- ${severity.toUpperCase()}S (${group.length}) ---`)
    for (const w of group) {
      lines.push(`[${w.severity.toUpperCase()}] Line ${w.line}: ${w.rule} — ${w.message}`)
      lines.push(`  → ${w.suggestion}`)
    }
    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

function validateBootc(content: string): string {
  const parsed = parseContainerfile(content)
  const results: Array<{ check: string; passed: boolean; detail: string }> = []

  const finalStage = parsed.stages[parsed.stages.length - 1]
  const baseImage = finalStage?.from.image ?? ""
  const fullRef = finalStage
    ? `${finalStage.from.image}${finalStage.from.tag ? ":" + finalStage.from.tag : ""}`
    : ""

  const isBootcBase =
    baseImage.startsWith("registry.redhat.io/rhel") &&
    fullRef.includes("rhel-bootc")
  results.push({
    check: "bootc base image",
    passed: isBootcBase,
    detail: isBootcBase
      ? `Base image ${fullRef} is bootc-compatible.`
      : `Base image "${fullRef || baseImage}" is not a recognized bootc base (expected registry.redhat.io/rhel*/rhel-bootc:*).`,
  })

  let hasBootcLabel = false
  for (const stage of parsed.stages) {
    for (const instr of stage.instructions) {
      if (instr.type === "LABEL" && instr.key === "bootc.diskimage-builder") {
        hasBootcLabel = true
      }
    }
  }
  results.push({
    check: "bootc.diskimage-builder label",
    passed: hasBootcLabel,
    detail: hasBootcLabel
      ? "Found bootc.diskimage-builder label."
      : 'Missing LABEL bootc.diskimage-builder. Add LABEL bootc.diskimage-builder="true" for bootc compatibility.',
  })

  let hasSystemdFiles = false
  for (const stage of parsed.stages) {
    for (const instr of stage.instructions) {
      if (
        (instr.type === "COPY" || instr.type === "ADD") &&
        instr.dest.startsWith("/etc/systemd/")
      ) {
        hasSystemdFiles = true
      }
    }
  }
  results.push({
    check: "systemd unit files",
    passed: hasSystemdFiles,
    detail: hasSystemdFiles
      ? "Found systemd unit file(s) copied to /etc/systemd/."
      : "No systemd unit files detected. Bootc images typically include systemd services.",
  })

  const allPassed = results.every((r) => r.passed)
  const lines = [
    allPassed ? "PASS: Containerfile is bootc-compatible." : "FAIL: Containerfile has bootc compatibility issues.",
    "",
    ...results.map((r) => `[${r.passed ? "PASS" : "FAIL"}] ${r.check}: ${r.detail}`),
  ]

  return lines.join("\n")
}

function suggestBaseImage(useCase: string): string {
  const lower = useCase.toLowerCase()

  for (const entry of BASE_IMAGE_LOOKUP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return [
        `Suggested image: ${entry.suggestion.image}`,
        `Rationale: ${entry.suggestion.rationale}`,
        "",
        `FROM ${entry.suggestion.image}`,
      ].join("\n")
    }
  }

  return [
    `Suggested image: ${DEFAULT_SUGGESTION.image}`,
    `Rationale: ${DEFAULT_SUGGESTION.rationale}`,
    "",
    `FROM ${DEFAULT_SUGGESTION.image}`,
  ].join("\n")
}

function createTools(): Record<string, ToolDefinition> {
  return {
    container_lint: {
      description:
        "Lint a Containerfile/Dockerfile for Red Hat best practices including UBI base images, security, and layer optimization.",
      args: {
        content: z.string().describe("Containerfile/Dockerfile content to lint"),
      },
      async execute(args: { content: string }) {
        try {
          const parsed = parseContainerfile(args.content)
          const warnings = runLintRules(parsed)
          return formatWarnings(warnings)
        } catch (error) {
          return `Failed to lint Containerfile: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    bootc_validate: {
      description:
        "Validate whether a Containerfile is compatible with bootc (bootable container) requirements.",
      args: {
        content: z.string().describe("Containerfile/Dockerfile content to validate for bootc compatibility"),
      },
      async execute(args: { content: string }) {
        try {
          return validateBootc(args.content)
        } catch (error) {
          return `Failed to validate bootc compatibility: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    container_base_suggest: {
      description:
        "Suggest a Red Hat UBI base image for a given use case or technology stack.",
      args: {
        useCase: z.string().describe("Description of the use case or technology (e.g. 'Java microservice', 'Python API', 'Go CLI tool')"),
      },
      async execute(args: { useCase: string }) {
        try {
          return suggestBaseImage(args.useCase)
        } catch (error) {
          return `Failed to suggest base image: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

export default {
  schema: optionsSchema,
  server: async (_input, options): Promise<Hooks> => {
    const result = optionsSchema.safeParse(options)
    const parsed = result.success ? result.data : undefined
    const tools = createTools()

    const hooks: Hooks = { tool: tools }

    if (parsed?.autoLint) {
      hooks["tool.execute.after"] = async (_input, output) => {
        const toolOutput = output?.output ?? ""
        if (/containerfile|dockerfile/i.test(toolOutput)) {
          output.output +=
            "\n[container-linter] Auto-lint enabled. Use container_lint to check Containerfile changes."
        }
      }
    }

    return hooks
  },
} satisfies PluginModule
