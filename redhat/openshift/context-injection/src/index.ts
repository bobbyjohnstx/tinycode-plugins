import type { Hooks, PluginModule } from "tinycode-plugin"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { queryClusterContext, type ClusterContext } from "./cluster-info"

function formatContextBlock(ctx: ClusterContext): string {
  return `<cluster-context>
cluster: ${ctx.cluster}
version: ${ctx.version}
nodes: ${ctx.nodes}
namespace: ${ctx.namespace}
operators: [${ctx.operators.join(", ")}]
</cluster-context>`
}

export default {
  server: async (input, _options): Promise<Hooks> => {
    const oc = createOcClient(input.$)
    let cachedContext: ClusterContext | null = null

    return {
      "session.start": async (_event, _output) => {
        cachedContext = await queryClusterContext(oc)
      },

      "experimental.chat.system.transform": async (_event, output) => {
        if (cachedContext) {
          output.system.push(formatContextBlock(cachedContext))
        } else {
          output.system.push("<cluster-context>not connected</cluster-context>")
        }
      },

      dispose: async () => {
        cachedContext = null
      },
    }
  },
} satisfies PluginModule
