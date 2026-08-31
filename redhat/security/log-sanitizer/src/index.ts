import type { Hooks, PluginModule } from "tinycode-plugin"

type RedactionRule = {
  type: string
  pattern: RegExp
}

const API_KEY_PATTERNS: RedactionRule[] = [
  { type: "api-key", pattern: /sk-(?:proj|live)-[A-Za-z0-9_-]{20,}/g },
  { type: "api-key", pattern: /gh[ps]_[A-Za-z0-9]{20,}/g },
  { type: "api-key", pattern: /AKIA[A-Z0-9]{16}/g },
  { type: "api-key", pattern: /xox[bp]-[A-Za-z0-9\-]{20,}/g },
]

const BEARER_PATTERN: RedactionRule = {
  type: "bearer-token",
  pattern: /(?<=Bearer\s)[A-Za-z0-9._\-+=\/]{20,}/g,
}

const PRIVATE_KEY_PATTERN: RedactionRule = {
  type: "private-key",
  pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
}

const HIGH_ENTROPY_PATTERN: RedactionRule = {
  type: "high-entropy",
  pattern: /(?<=[=:\s"'])[A-Za-z0-9+\/=_\-]{40,}(?=["\s,}\]']|$)/g,
}

function redact(text: string): string {
  if (text.length === 0) return text

  // Order matters: private keys first (multi-line), then specific patterns, then generic
  let result = text

  // Private keys (multi-line, must go first)
  result = result.replace(PRIVATE_KEY_PATTERN.pattern, `[REDACTED:${PRIVATE_KEY_PATTERN.type}]`)

  // API keys (specific prefixes)
  for (const rule of API_KEY_PATTERNS) {
    result = result.replace(rule.pattern, `[REDACTED:${rule.type}]`)
  }

  // Bearer tokens (lookbehind ensures "Bearer " prefix is preserved)
  result = result.replace(BEARER_PATTERN.pattern, `[REDACTED:${BEARER_PATTERN.type}]`)

  // High-entropy strings (generic catch-all, runs last to avoid double-redacting)
  result = result.replace(HIGH_ENTROPY_PATTERN.pattern, (match) => {
    // Skip if already redacted
    if (match.startsWith("[REDACTED:")) return match
    // Require mixed character classes to avoid matching plain words/paths
    const hasUpper = /[A-Z]/.test(match)
    const hasLower = /[a-z]/.test(match)
    const hasDigit = /[0-9]/.test(match)
    const classCount = [hasUpper, hasLower, hasDigit].filter(Boolean).length
    if (classCount < 2) return match
    return `[REDACTED:${HIGH_ENTROPY_PATTERN.type}]`
  })

  return result
}

export default {
  server: async (): Promise<Hooks> => {
    const hooks: Hooks = {}

    hooks["tool.execute.after"] = async (_input, output) => {
      output.output = redact(output.output)
    }

    return hooks
  },
} satisfies PluginModule
