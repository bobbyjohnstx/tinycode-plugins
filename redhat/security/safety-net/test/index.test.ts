import { describe, it, expect } from "bun:test"
import { createMockInput } from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

type Permission = {
  id: string
  type: string
  pattern?: string | string[]
  sessionID: string
  messageID: string
  callID?: string
  title: string
  metadata: Record<string, unknown>
  time: { created: number }
}

function makePermission(
  type: string,
  pattern?: string | string[],
): Permission {
  return {
    id: "test-id",
    type,
    pattern,
    sessionID: "test-session",
    messageID: "test-message",
    title: "test",
    metadata: {},
    time: { created: Date.now() },
  }
}

async function getHook() {
  const input = createMockInput()
  const hooks = await plugin.server(input, undefined)
  return hooks["permission.ask"]!
}

describe("tinycode-plugin-rh-safety-net", () => {
  describe("plugin loading", () => {
    it("loads without error", async () => {
      const hook = await getHook()
      expect(hook).toBeDefined()
    })
  })

  describe("non-bash permissions pass through", () => {
    it("allows edit permissions unchanged", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("edit", "/some/file.ts"), output)
      expect(output.status).toBe("ask")
    })

    it("allows read permissions unchanged", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("read", "/some/file.ts"), output)
      expect(output.status).toBe("ask")
    })
  })

  describe("empty/undefined pattern passes through", () => {
    it("allows undefined pattern", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", undefined), output)
      expect(output.status).toBe("ask")
    })

    it("allows empty string pattern", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", ""), output)
      expect(output.status).toBe("ask")
    })

    it("allows empty array pattern", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", []), output)
      expect(output.status).toBe("ask")
    })
  })

  describe("pattern as string array", () => {
    it("blocks dangerous command in string array", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", ["rm", "-rf", "/"]), output)
      expect(output.status).toBe("deny")
    })
  })

  describe("shell destructive commands", () => {
    it("blocks rm -rf /", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "rm -rf /"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks rm -rf / with extra flags", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "sudo rm -rf /"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks rm -rf ~", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "rm -rf ~"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks rm -rf $HOME", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "rm -rf $HOME"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks mkfs", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "mkfs.ext4 /dev/sda1"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks dd if=/dev/zero", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "dd if=/dev/zero of=/dev/sda"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks dd if=/dev/random", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "dd if=/dev/random of=/dev/sda"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks chmod -R 777 /", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "chmod -R 777 /"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks fork bomb", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", ":(){ :|:& };:"), output)
      expect(output.status).toBe("deny")
    })
  })

  describe("k8s/OCP destructive commands", () => {
    it("blocks kubectl delete namespace", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "kubectl delete namespace production"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks oc delete project", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "oc delete project my-project"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks kubectl delete node", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "kubectl delete node worker-1"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks oc delete node", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "oc delete node worker-1"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks helm uninstall on kube-system", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "helm uninstall my-release -n kube-system"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks helm uninstall with --namespace kube-system", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "helm uninstall my-release --namespace kube-system"), output)
      expect(output.status).toBe("deny")
    })
  })

  describe("git destructive commands", () => {
    it("blocks git push --force origin main", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "git push --force origin main"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks git push --force origin master", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "git push --force origin master"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks git push -f origin main", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "git push -f origin main"), output)
      expect(output.status).toBe("deny")
    })

    it("blocks git reset --hard on main", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "git checkout main && git reset --hard"), output)
      expect(output.status).toBe("deny")
    })
  })

  describe("safe commands pass through", () => {
    it("allows scoped rm -rf ./build", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "rm -rf ./build"), output)
      expect(output.status).toBe("ask")
    })

    it("allows scoped rm -rf ./node_modules", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "rm -rf ./node_modules"), output)
      expect(output.status).toBe("ask")
    })

    it("allows rm -rf /tmp/something", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "rm -rf /tmp/something"), output)
      expect(output.status).toBe("ask")
    })

    it("allows kubectl delete pod", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "kubectl delete pod my-pod"), output)
      expect(output.status).toBe("ask")
    })

    it("allows oc delete pod", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "oc delete pod my-pod"), output)
      expect(output.status).toBe("ask")
    })

    it("allows git push origin feature-branch", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "git push origin feature-branch"), output)
      expect(output.status).toBe("ask")
    })

    it("allows git push --force origin feature/my-branch", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "git push --force origin feature/my-branch"), output)
      expect(output.status).toBe("ask")
    })

    it("allows helm uninstall on non-system namespace", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "helm uninstall my-release -n my-namespace"), output)
      expect(output.status).toBe("ask")
    })

    it("allows normal git commands", async () => {
      const hook = await getHook()
      const output = { status: "ask" as "ask" | "deny" | "allow" }
      await hook(makePermission("bash", "git status"), output)
      expect(output.status).toBe("ask")
    })
  })
})
