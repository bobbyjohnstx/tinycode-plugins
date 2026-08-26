import type { Hooks, PluginModule } from "tinycode-plugin"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { createCoreTools } from "./core-tools"

export default {
  server: async (input, _options): Promise<Hooks> => {
    const oc = createOcClient(input.$)

    return {
      "shell.env": async (
        _event: { cwd: string; sessionID?: string; callID?: string },
        output: { env: Record<string, string> },
      ) => {
        output.env["OC_EDITOR"] = "cat"
      },

      tool: {
        ...createCoreTools(oc),
      },
    }
  },
} satisfies PluginModule
