import type {
  ParsedContainerfile,
  FromDirective,
  ContainerfileInstruction,
} from "tinycode-plugin-redhat-shared/containerfile-parser"

export type LintWarning = {
  rule: string
  severity: "error" | "warning" | "info"
  line: number
  message: string
  suggestion: string
}

export type LintRule = {
  id: string
  run(parsed: ParsedContainerfile): LintWarning[]
}

const UBI_PREFIXES = [
  "registry.access.redhat.com/ubi",
  "registry.redhat.io/ubi",
]

function isUbiImage(image: string): boolean {
  return UBI_PREFIXES.some((prefix) => image.startsWith(prefix))
}

const nonUbiBase: LintRule = {
  id: "non-ubi-base",
  run(parsed) {
    const warnings: LintWarning[] = []
    for (const stage of parsed.stages) {
      const from = stage.from
      if (!isUbiImage(from.image)) {
        warnings.push({
          rule: "non-ubi-base",
          severity: "warning",
          line: from.lineNumber,
          message: `Base image "${from.image}" is not a Red Hat UBI image.`,
          suggestion:
            "Use a UBI base image such as registry.access.redhat.com/ubi9/ubi:9.5 for RHEL compatibility and support.",
        })
      }
    }
    return warnings
  },
}

const latestTag: LintRule = {
  id: "latest-tag",
  run(parsed) {
    const warnings: LintWarning[] = []
    for (const stage of parsed.stages) {
      const from = stage.from
      if (from.tag === "latest" || (!from.tag && !from.digest)) {
        warnings.push({
          rule: "latest-tag",
          severity: "warning",
          line: from.lineNumber,
          message: `FROM uses ${from.tag === "latest" ? ":latest tag" : "no tag (implicit latest)"}.`,
          suggestion:
            "Pin to a specific version tag for reproducible builds (e.g. :9.5 or :1.20).",
        })
      }
    }
    return warnings
  },
}

const rootUser: LintRule = {
  id: "root-user",
  run(parsed) {
    const warnings: LintWarning[] = []
    for (const stage of parsed.stages) {
      const userInstructions = stage.instructions.filter(
        (i): i is Extract<ContainerfileInstruction, { type: "USER" }> =>
          i.type === "USER",
      )
      for (let idx = 0; idx < userInstructions.length; idx++) {
        const userInstr = userInstructions[idx]!
        if (userInstr.user === "root" || userInstr.user === "0") {
          const hasSubsequentNonRoot = userInstructions
            .slice(idx + 1)
            .some((u) => u.user !== "root" && u.user !== "0")
          if (!hasSubsequentNonRoot) {
            warnings.push({
              rule: "root-user",
              severity: "error",
              line: userInstr.lineNumber,
              message: "USER root without subsequent non-root USER in this stage.",
              suggestion:
                "Add USER 1001 (or another non-root user) after root operations.",
            })
          }
        }
      }
    }
    return warnings
  },
}

const REQUIRED_LABELS = ["name", "version", "summary"]

const missingLabels: LintRule = {
  id: "missing-labels",
  run(parsed) {
    const allLabels = new Set<string>()
    for (const stage of parsed.stages) {
      for (const instr of stage.instructions) {
        if (instr.type === "LABEL") {
          allLabels.add(instr.key.toLowerCase())
        }
      }
    }
    const missing = REQUIRED_LABELS.filter((l) => !allLabels.has(l))
    if (missing.length === 0) return []

    const line = parsed.stages[0]?.from.lineNumber ?? 1
    return [
      {
        rule: "missing-labels",
        severity: "info",
        line,
        message: `Missing recommended labels: ${missing.join(", ")}.`,
        suggestion:
          'Add LABEL name="app-name" version="1.0" summary="description" for OCP compatibility.',
      },
    ]
  },
}

const runLayerChaining: LintRule = {
  id: "run-layer-chaining",
  run(parsed) {
    const warnings: LintWarning[] = []
    for (const stage of parsed.stages) {
      let consecutiveRuns = 0
      let firstRunLine = 0
      for (const instr of stage.instructions) {
        if (instr.type === "RUN") {
          consecutiveRuns++
          if (consecutiveRuns === 1) {
            firstRunLine = instr.lineNumber
          }
          if (consecutiveRuns === 3) {
            warnings.push({
              rule: "run-layer-chaining",
              severity: "info",
              line: firstRunLine,
              message: "3+ consecutive RUN instructions create unnecessary layers.",
              suggestion:
                "Combine related RUN commands with && to reduce image layers.",
            })
          }
        } else {
          consecutiveRuns = 0
        }
      }
    }
    return warnings
  },
}

const SECRET_PATTERNS = /password|secret|token|key/i

const hardcodedSecret: LintRule = {
  id: "hardcoded-secret",
  run(parsed) {
    const warnings: LintWarning[] = []
    for (const stage of parsed.stages) {
      for (const instr of stage.instructions) {
        if (instr.type === "ENV" && SECRET_PATTERNS.test(instr.key)) {
          warnings.push({
            rule: "hardcoded-secret",
            severity: "error",
            line: instr.lineNumber,
            message: `ENV "${instr.key}" may contain a secret exposed in the image layer.`,
            suggestion:
              "Use --mount=type=secret or runtime environment variables instead of build-time ENV for secrets.",
          })
        }
        if (instr.type === "ARG" && SECRET_PATTERNS.test(instr.name)) {
          warnings.push({
            rule: "hardcoded-secret",
            severity: "error",
            line: instr.lineNumber,
            message: `ARG "${instr.name}" may contain a secret visible in build history.`,
            suggestion:
              "Use --mount=type=secret or runtime environment variables instead of build-time ARG for secrets.",
          })
        }
      }
    }
    // Also check globalArgs
    for (const arg of parsed.globalArgs) {
      if (SECRET_PATTERNS.test(arg.name)) {
        warnings.push({
          rule: "hardcoded-secret",
          severity: "error",
          line: arg.lineNumber,
          message: `ARG "${arg.name}" may contain a secret visible in build history.`,
          suggestion:
            "Use --mount=type=secret or runtime environment variables instead of build-time ARG for secrets.",
        })
      }
    }
    return warnings
  },
}

const missingUserDirective: LintRule = {
  id: "missing-user-directive",
  run(parsed) {
    if (parsed.stages.length === 0) return []
    const finalStage = parsed.stages[parsed.stages.length - 1]!
    const hasUser = finalStage.instructions.some((i) => i.type === "USER")
    if (hasUser) return []

    return [
      {
        rule: "missing-user-directive",
        severity: "warning",
        line: finalStage.from.lineNumber,
        message: "No USER instruction in the final stage. Container will run as root.",
        suggestion:
          "Add USER 1001 to run the container as a non-root user.",
      },
    ]
  },
}

export const lintRules: LintRule[] = [
  nonUbiBase,
  latestTag,
  rootUser,
  missingLabels,
  runLayerChaining,
  hardcodedSecret,
  missingUserDirective,
]

export function runLintRules(parsed: ParsedContainerfile): LintWarning[] {
  const warnings: LintWarning[] = []
  for (const rule of lintRules) {
    warnings.push(...rule.run(parsed))
  }
  return warnings.sort((a, b) => a.line - b.line)
}
