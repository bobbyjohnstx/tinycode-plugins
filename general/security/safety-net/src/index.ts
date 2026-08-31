import type { Hooks, PluginModule } from "tinycode-plugin"

type BlockRule = {
  name: string
  test: (cmd: string) => boolean
}

const BLOCK_RULES: BlockRule[] = [
  // Shell destructive
  {
    name: "rm-root",
    test: (cmd) => {
      // Block rm -rf / or rm -rf ~ or rm -rf $HOME, but not scoped paths like ./build or /tmp/...
      const match = cmd.match(/\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+(.+)/)
      if (!match) return false
      const target = match[2]!.trim().split(/\s/)[0]!
      return target === "/" || target === "~" || target === "$HOME"
    },
  },
  {
    name: "mkfs",
    test: (cmd) => /\bmkfs\b/.test(cmd),
  },
  {
    name: "dd-overwrite",
    test: (cmd) => /\bdd\s+.*if=\/dev\/(zero|random)/.test(cmd),
  },
  {
    name: "chmod-root",
    test: (cmd) => /\bchmod\s+(-\w*R\w*)\s+777\s+\/\s*$/.test(cmd) || /\bchmod\s+(-\w*R\w*)\s+777\s+\/(?:\s|$)/.test(cmd),
  },
  {
    name: "fork-bomb",
    test: (cmd) => cmd.includes(":(){ :|:& };:"),
  },

  // K8s/OCP destructive
  {
    name: "k8s-delete-namespace",
    test: (cmd) => /\b(kubectl|oc)\s+delete\s+(namespace|project)\b/.test(cmd),
  },
  {
    name: "k8s-delete-node",
    test: (cmd) => /\b(kubectl|oc)\s+delete\s+node\b/.test(cmd),
  },
  {
    name: "helm-uninstall-kube-system",
    test: (cmd) =>
      /\bhelm\s+uninstall\b/.test(cmd) &&
      /(-n|--namespace)\s+kube-system\b/.test(cmd),
  },

  // Git destructive
  {
    name: "git-force-push-main",
    test: (cmd) => {
      // Block force push to main/master only
      const forcePush = /\bgit\s+push\s+.*(-f|--force)\b/.test(cmd)
      if (!forcePush) return false
      return /\b(main|master)\s*$/.test(cmd.trim())
    },
  },
  {
    name: "git-reset-hard-main",
    test: (cmd) => {
      // Block git reset --hard when main/master is referenced in the command context
      if (!/\bgit\s+reset\s+--hard\b/.test(cmd)) return false
      return /\b(main|master)\b/.test(cmd)
    },
  },
]

function extractCommand(pattern: string | string[] | undefined): string {
  if (pattern === undefined) return ""
  if (Array.isArray(pattern)) return pattern.join(" ")
  return pattern
}

function isDangerous(cmd: string): boolean {
  if (!cmd) return false
  return BLOCK_RULES.some((rule) => rule.test(cmd))
}

export default {
  server: async (): Promise<Hooks> => ({
    "permission.ask": async (input, output) => {
      if (input.type !== "bash") return

      const cmd = extractCommand(input.pattern)
      if (isDangerous(cmd)) {
        output.status = "deny"
      }
    },
  }),
} satisfies PluginModule
