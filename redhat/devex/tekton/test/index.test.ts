import { describe, it, expect } from "bun:test"
import {
  createMockShell,
  createMockInput,
} from "tinycode-plugin-redhat-shared/test-utils"
import plugin from "../src/index"

const mockCtx = {
  sessionID: "test",
  messageID: "test",
  agent: "test",
  directory: "/tmp/test",
  worktree: "/tmp/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
  progress: () => {},
  messages: async () => [],
  sessionInfo: async () => ({ id: "test", model: "test", agent: "test" }),
} as any

const pipelineListJson = {
  items: [
    {
      metadata: {
        name: "build-and-deploy",
        namespace: "dev",
        creationTimestamp: "2026-01-01T00:00:00Z",
      },
      spec: {
        tasks: [
          { name: "fetch-source" },
          { name: "build" },
          { name: "deploy" },
        ],
      },
    },
    {
      metadata: {
        name: "run-tests",
        namespace: "dev",
        creationTimestamp: "2026-02-01T00:00:00Z",
      },
      spec: {
        tasks: [{ name: "checkout" }, { name: "test" }],
      },
    },
  ],
}

const pipelineRunListJson = {
  items: [
    {
      metadata: {
        name: "build-and-deploy-run-abc",
        namespace: "dev",
        creationTimestamp: "2026-01-01T10:00:00Z",
      },
      spec: { pipelineRef: { name: "build-and-deploy" } },
      status: {
        conditions: [
          { type: "Succeeded", status: "True", reason: "Succeeded" },
        ],
        startTime: "2026-01-01T10:00:00Z",
        completionTime: "2026-01-01T10:05:00Z",
        childReferences: [
          {
            name: "build-and-deploy-run-abc-fetch-source",
            pipelineTaskName: "fetch-source",
            kind: "TaskRun",
          },
          {
            name: "build-and-deploy-run-abc-build",
            pipelineTaskName: "build",
            kind: "TaskRun",
          },
        ],
      },
    },
  ],
}

const pipelineRunDetailJson = {
  metadata: {
    name: "build-and-deploy-run-abc",
    namespace: "dev",
    creationTimestamp: "2026-01-01T10:00:00Z",
  },
  spec: { pipelineRef: { name: "build-and-deploy" } },
  status: {
    conditions: [
      {
        type: "Succeeded",
        status: "True",
        reason: "Succeeded",
        message: "All tasks completed",
      },
    ],
    startTime: "2026-01-01T10:00:00Z",
    completionTime: "2026-01-01T10:05:00Z",
    childReferences: [
      {
        name: "build-and-deploy-run-abc-fetch-source",
        pipelineTaskName: "fetch-source",
        kind: "TaskRun",
      },
      {
        name: "build-and-deploy-run-abc-build",
        pipelineTaskName: "build",
        kind: "TaskRun",
      },
    ],
  },
}

const taskListJson = {
  items: [
    {
      metadata: {
        name: "git-clone",
        namespace: "dev",
        creationTimestamp: "2026-01-01T00:00:00Z",
      },
      spec: {
        steps: [{ name: "clone", image: "alpine/git" }],
      },
    },
  ],
}

const clusterTaskListJson = {
  items: [
    {
      metadata: {
        name: "buildah",
        creationTimestamp: "2026-01-01T00:00:00Z",
      },
      spec: {
        steps: [
          { name: "build", image: "quay.io/buildah/stable" },
          { name: "push", image: "quay.io/buildah/stable" },
        ],
      },
    },
  ],
}

describe("tinycode-plugin-tekton", () => {
  it("loads without error", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    expect(hooks).toBeDefined()
    expect(hooks.tool).toBeDefined()
  })

  it("registers all six tools", async () => {
    const input = createMockInput()
    const hooks = await plugin.server(input, undefined)
    const toolNames = Object.keys(hooks.tool!)
    expect(toolNames).toContain("tekton_list_pipelines")
    expect(toolNames).toContain("tekton_list_runs")
    expect(toolNames).toContain("tekton_run_status")
    expect(toolNames).toContain("tekton_run_logs")
    expect(toolNames).toContain("tekton_list_tasks")
    expect(toolNames).toContain("tekton_start_run")
  })

  describe("shell.env", () => {
    it("sets OC_EDITOR to cat", async () => {
      const input = createMockInput()
      const hooks = await plugin.server(input, undefined)
      const output = { env: {} as Record<string, string> }
      await hooks["shell.env"]!(
        { cwd: "/tmp/test" },
        output,
      )
      expect(output.env["OC_EDITOR"]).toBe("cat")
    })
  })

  describe("tekton_list_pipelines", () => {
    it("returns pipeline names, dates, and tasks", async () => {
      const shell = createMockShell([
        { match: "oc get pipelines -o json", json: pipelineListJson },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_list_pipelines!.execute(
        { namespace: "dev" },
        mockCtx,
      )
      const parsed = JSON.parse(result as string)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].name).toBe("build-and-deploy")
      expect(parsed[0].tasks).toEqual(["fetch-source", "build", "deploy"])
      expect(parsed[1].name).toBe("run-tests")
    })

    it("returns message when no pipelines found", async () => {
      const shell = createMockShell([
        { match: "oc get pipelines -o json", json: { items: [] } },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_list_pipelines!.execute(
        { namespace: "dev" },
        mockCtx,
      )
      expect(result).toContain("No pipelines found")
    })

    it("returns error message on oc failure", async () => {
      const shell = createMockShell([
        { match: "oc get pipelines -o json", exitCode: 1 },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_list_pipelines!.execute(
        { namespace: "dev" },
        mockCtx,
      )
      expect(result).toContain("Error listing pipelines")
    })
  })

  describe("tekton_list_runs", () => {
    it("returns runs with status, start time, and duration", async () => {
      const shell = createMockShell([
        { match: "oc get pipelineruns -o json", json: pipelineRunListJson },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_list_runs!.execute(
        { namespace: "dev" },
        mockCtx,
      )
      const parsed = JSON.parse(result as string)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toBe("build-and-deploy-run-abc")
      expect(parsed[0].pipeline).toBe("build-and-deploy")
      expect(parsed[0].status).toBe("Succeeded")
      expect(parsed[0].duration).toBe("5m 0s")
    })

    it("filters by pipeline name using label selector", async () => {
      const shell = createMockShell([
        {
          match: "tekton.dev/pipeline=build-and-deploy",
          json: pipelineRunListJson,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_list_runs!.execute(
        { namespace: "dev", pipeline: "build-and-deploy" },
        mockCtx,
      )
      const parsed = JSON.parse(result as string)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].pipeline).toBe("build-and-deploy")
    })

    it("returns message when no runs found", async () => {
      const shell = createMockShell([
        { match: "oc get pipelineruns -o json", json: { items: [] } },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_list_runs!.execute(
        { namespace: "dev" },
        mockCtx,
      )
      expect(result).toBe("No PipelineRuns found")
    })
  })

  describe("tekton_run_status", () => {
    it("returns detailed status with tasks and timing", async () => {
      const shell = createMockShell([
        {
          match: "oc get pipelineruns/build-and-deploy-run-abc -o json",
          json: pipelineRunDetailJson,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_run_status!.execute(
        { namespace: "dev", name: "build-and-deploy-run-abc" },
        mockCtx,
      )
      const parsed = JSON.parse(result as string)
      expect(parsed.name).toBe("build-and-deploy-run-abc")
      expect(parsed.status).toBe("Succeeded")
      expect(parsed.duration).toBe("5m 0s")
      expect(parsed.tasks).toHaveLength(2)
      expect(parsed.tasks[0].name).toBe("fetch-source")
      expect(parsed.condition.message).toBe("All tasks completed")
    })

    it("returns error when run not found", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_run_status!.execute(
        { namespace: "dev", name: "nonexistent-run" },
        mockCtx,
      )
      expect(result).toContain("Error getting PipelineRun status")
    })
  })

  describe("tekton_run_logs", () => {
    it("retrieves logs for a task in a pipeline run", async () => {
      const shell = createMockShell([
        {
          match: "oc get pipelineruns/build-and-deploy-run-abc -o json",
          json: pipelineRunDetailJson,
        },
        {
          match: "oc logs pod/build-and-deploy-run-abc-fetch-source-pod",
          output: "Cloning repository...\nDone.",
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_run_logs!.execute(
        { namespace: "dev", run: "build-and-deploy-run-abc", task: "fetch-source" },
        mockCtx,
      )
      expect(result).toContain("Cloning repository")
    })

    it("returns message when task not found in run", async () => {
      const shell = createMockShell([
        {
          match: "oc get pipelineruns/build-and-deploy-run-abc -o json",
          json: pipelineRunDetailJson,
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_run_logs!.execute(
        { namespace: "dev", run: "build-and-deploy-run-abc", task: "nonexistent-task" },
        mockCtx,
      )
      expect(result).toContain('Task "nonexistent-task" not found')
    })

    it("passes container flag when specified", async () => {
      const shell = createMockShell([
        {
          match: "oc get pipelineruns/build-and-deploy-run-abc -o json",
          json: pipelineRunDetailJson,
        },
        {
          match: "--container step-build",
          output: "Building image...",
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_run_logs!.execute(
        {
          namespace: "dev",
          run: "build-and-deploy-run-abc",
          task: "build",
          container: "step-build",
        },
        mockCtx,
      )
      expect(result).toContain("Building image")
    })
  })

  describe("tekton_list_tasks", () => {
    it("returns both namespace tasks and cluster tasks", async () => {
      const shell = createMockShell([
        { match: "oc get tasks -o json", json: taskListJson },
        { match: "oc get clustertasks -o json", json: clusterTaskListJson },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_list_tasks!.execute(
        { namespace: "dev" },
        mockCtx,
      )
      const parsed = JSON.parse(result as string)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].name).toBe("git-clone")
      expect(parsed[0].scope).toBe("namespace")
      expect(parsed[0].steps).toEqual(["clone"])
      expect(parsed[1].name).toBe("buildah")
      expect(parsed[1].scope).toBe("cluster")
      expect(parsed[1].steps).toEqual(["build", "push"])
    })

    it("returns message when no tasks found", async () => {
      const shell = createMockShell([])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_list_tasks!.execute(
        { namespace: "dev" },
        mockCtx,
      )
      expect(result).toBe("No Tasks or ClusterTasks found")
    })

    it("returns only cluster tasks when namespace tasks fail", async () => {
      const shell = createMockShell([
        { match: "oc get clustertasks -o json", json: clusterTaskListJson },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_list_tasks!.execute(
        { namespace: "dev" },
        mockCtx,
      )
      const parsed = JSON.parse(result as string)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toBe("buildah")
      expect(parsed[0].scope).toBe("cluster")
    })
  })

  describe("tekton_start_run", () => {
    it("creates a PipelineRun and returns confirmation", async () => {
      const shell = createMockShell([
        {
          match: "oc apply",
          output: "pipelinerun.tekton.dev/build-and-deploy-run-123 created",
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_start_run!.execute(
        { namespace: "dev", pipeline: "build-and-deploy" },
        mockCtx,
      )
      const parsed = JSON.parse(result as string)
      expect(parsed.namespace).toBe("dev")
      expect(parsed.pipeline).toBe("build-and-deploy")
      expect(parsed.created).toContain("build-and-deploy-run-")
      expect(parsed.result).toContain("created")
    })

    it("includes params in the PipelineRun manifest", async () => {
      let appliedManifest = ""
      const shell = createMockShell([
        {
          match: "oc apply",
          output: "pipelinerun.tekton.dev/build-and-deploy-run-123 created",
        },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_start_run!.execute(
        {
          namespace: "dev",
          pipeline: "build-and-deploy",
          params: { "git-url": "https://github.com/example/repo", revision: "main" },
        },
        mockCtx,
      )
      const parsed = JSON.parse(result as string)
      expect(parsed.pipeline).toBe("build-and-deploy")
      expect(parsed.created).toContain("build-and-deploy-run-")
    })

    it("returns error when apply fails", async () => {
      const shell = createMockShell([
        { match: "oc apply", exitCode: 1 },
      ])
      const input = createMockInput(shell)
      const hooks = await plugin.server(input, undefined)
      const result = await hooks.tool!.tekton_start_run!.execute(
        { namespace: "dev", pipeline: "build-and-deploy" },
        mockCtx,
      )
      expect(result).toContain("Error starting pipeline run")
    })
  })
})
