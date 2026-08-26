# Tinycode Plugins Monorepo -- Phase 1 Implementation Plan

**Date:** 2026-08-25
**Design spec:** `docs/superpowers/specs/2026-08-25-tinycode-plugins-monorepo-design.md`
**Current state:** Empty repo (LICENSE, empty `redhat/`, docs only)
**Plugin API version:** 1 (tinycode-plugin ^1.18.0)

---

## Context

This plan covers Phase 1 of the tinycode-plugins monorepo: standing up the Bun workspace, building the shared package that all Red Hat plugins depend on, scaffolding all 13 plugin stubs, and fully implementing the first two plugins (ocp-context and ocp-oauth). These two plugins were chosen because ocp-context is the simplest (low complexity, high daily value) and ocp-oauth is foundational (unblocks all other OpenShift-dependent plugins).

## Work Objectives

- Establish a working Bun monorepo with workspace resolution across `redhat/_shared` and `redhat/*/*`
- Build the shared package (`tinycode-plugin-redhat-shared`) with OC CLI wrapper, HTTP client, token management, and test utilities
- Scaffold all 13 plugins with loadable stubs and passing baseline tests
- Fully implement ocp-context (cluster context injection into system prompt)
- Fully implement ocp-oauth (OpenShift API token auth with `oc login` side effect)
- All tests pass, all types check

## Guardrails

**Must Have:**
- Every plugin stub loads via `createTestHarness(plugin)` without error
- Shared package exports use subpath exports (`./oc`, `./api`, `./auth`, `./test-utils`), not a barrel
- Plugin exports use `"."` (matching the working example at `tinycode/examples/tinycode-plugin-hello/`), not `"./server"`
- `satisfies PluginModule` on every plugin default export for type safety
- 80% test coverage on `_shared`, `ocp-context`, and `ocp-oauth`
- Credentials never stored in plugin options -- use tinycode's `auth` hook system

**Must NOT Have:**
- No barrel exports from `_shared` (subpath exports only)
- No `@types/node` in devDependencies (use `@types/bun` instead -- the working example uses `@types/node` but this monorepo targets Bun)
- No browser-based OAuth flow (deferred to Phase 2; Phase 1 is API token only)
- No live cluster calls in default test runs (integration tests go in `*.integration.test.ts`)
- No `console.log` statements left in production code

---

## Task 1: Monorepo Foundation

**Complexity:** S
**Dependencies:** None

### Files to create

| File | Source |
|------|--------|
| `package.json` | Design spec Section 1.1 |
| `tsconfig.json` | Design spec Section 1.2 |
| `.gitignore` | Design spec Section 1.3 |

### Specifications

**`package.json`:**
```json
{
  "name": "tinycode-plugins",
  "private": true,
  "type": "module",
  "workspaces": ["redhat/_shared", "redhat/*/*"],
  "scripts": {
    "test": "bun test --recursive",
    "typecheck": "bun run --filter='*' typecheck"
  },
  "devDependencies": {
    "@types/bun": "^1.3.0",
    "typescript": "^5.7.0"
  }
}
```

**`tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "lib": ["ESNext"],
    "types": ["bun-types"]
  },
  "exclude": ["node_modules", "dist"]
}
```

**`.gitignore`:**
```
node_modules/
dist/
*.tsbuildinfo
.env
.env.*
!.env.example
.DS_Store
```

### Acceptance Criteria

- [ ] `bun install` completes with exit code 0
- [ ] `node_modules/` directory is created at root
- [ ] `bun.lockb` or `bun.lock` is generated
- [ ] `.gitignore` excludes `node_modules/`, `dist/`, `.env`, `.DS_Store`

---

## Task 2: Shared Package (`redhat/_shared/`)

**Complexity:** L
**Dependencies:** Task 1

### Files to create

| File | Description |
|------|-------------|
| `redhat/_shared/package.json` | Package manifest with subpath exports |
| `redhat/_shared/tsconfig.json` | Extends `../../tsconfig.json` (2 levels) |
| `redhat/_shared/src/oc.ts` | OC CLI wrapper with typed methods |
| `redhat/_shared/src/api.ts` | HTTP client with token injection and 401 retry |
| `redhat/_shared/src/auth.ts` | Singleton TokenManager and resolveToken |
| `redhat/_shared/src/test-utils.ts` | createMockShell and createMockFetch helpers |
| `redhat/_shared/test/oc.test.ts` | Tests for OcClient |
| `redhat/_shared/test/api.test.ts` | Tests for ApiClient |
| `redhat/_shared/test/auth.test.ts` | Tests for TokenManager and resolveToken |

### Specifications

**`package.json`:**
- Name: `tinycode-plugin-redhat-shared`
- Version: `0.1.0`
- Subpath exports: `"./oc"` -> `"./src/oc.ts"`, `"./api"` -> `"./src/api.ts"`, `"./auth"` -> `"./src/auth.ts"`, `"./test-utils"` -> `"./src/test-utils.ts"`
- Dependencies: `tinycode-plugin: "^1.18.0"`
- DevDependencies: `@types/bun: "^1.3.0"`, `typescript: "^5.7.0"`
- Scripts: `"test": "bun test"`, `"typecheck": "tsc --noEmit"`

**`tsconfig.json`:**
- Extends `../../tsconfig.json` (2 levels deep, not 3)
- `rootDir: "src"`, `outDir: "dist"`
- `include: ["src"]`

#### src/oc.ts

Exports:
- `OcError` class extending `Error` with `exitCode: number` and `stderr: string` properties. `this.name = "OcError"`.
- `OcClient` type with methods: `get<T>(resource, options?)`, `apply(manifest)`, `logs(pod, options?)`, `describe(resource, name, namespace?)`, `whoami()`, `token()`, `version()`, `isAvailable()`, `isLoggedIn()`, `raw(...args)`
- `createOcClient(shell: PluginInput["$"]): OcClient` factory function

Type `Shell` is `PluginInput["$"]` imported from `tinycode-plugin`.

Implementation details:
- `isAvailable()`: runs `which oc` via shell, returns `true` if exit code 0
- `isLoggedIn()`: runs `oc whoami` via shell with `.nothrow()`, returns `true` if exit code 0
- `get()`: runs `oc get <resource> -o json` with optional `--namespace`, `--selector`, `--field-selector` flags. Parses JSON output.
- `apply()`: runs `echo <manifest> | oc apply -f -`, returns stdout text
- `logs()`: runs `oc logs <pod>` with optional `--container`, `--tail`, `--since` flags, returns stdout text
- `describe()`: runs `oc describe <resource> <name>` with optional `--namespace`, returns stdout text
- `whoami()`: runs `oc whoami`, returns trimmed stdout
- `token()`: runs `oc whoami -t`, returns trimmed stdout
- `version()`: runs `oc version -o json`, parses into `{ clientVersion, serverVersion?, openshiftVersion? }`
- `raw()`: runs `oc <args joined>`, returns stdout text
- All methods except `isAvailable()` and `isLoggedIn()` throw `OcError` on non-zero exit code
- When `oc` is not found (checked via `isAvailable()`), throw `OcError` with message: `"The 'oc' CLI is required but not found. Install it from https://console.redhat.com/openshift/downloads"`
- Use `.nothrow()` on shell commands so exit codes can be inspected without throwing

Supporting types to export:
```typescript
type OcGetOptions = {
  namespace?: string
  selector?: string
  fieldSelector?: string
}

type OcLogOptions = {
  container?: string
  tail?: number
  since?: string
}
```

#### src/api.ts

Exports:
- `ApiClientConfig` type: `{ baseUrl: string, tokenFn: () => Promise<string>, headers?: Record<string, string>, maxRetries?: number }`
- `ApiResponse<T>` type: `{ data: T, status: number, headers: Headers }`
- `ApiClient` type with methods: `get<T>(path, query?)`, `post<T>(path, body?)`, `put<T>(path, body?)`, `delete<T>(path)`
- `createApiClient(config: ApiClientConfig): ApiClient` factory function

Implementation details:
- Uses global `fetch()`, no external dependencies
- Every request calls `config.tokenFn()` to get a fresh token
- Injects `Authorization: Bearer <token>` header on every request
- Merges `config.headers` with per-request headers
- On HTTP 401 response: calls `tokenFn()` again and retries up to `config.maxRetries` (default: 1) times
- On non-2xx response (after retries): throw an `Error` with status code and response body text
- `get()` appends query params via `URLSearchParams`
- `post()` and `put()` set `Content-Type: application/json` and `JSON.stringify(body)`

#### src/auth.ts

Exports:
- `TokenSource` type: `"kubeconfig" | "env" | "option" | "oauth"`
- `TokenResult` type: `{ token: string, source: TokenSource, server: string }`
- `tokenManager` -- module-level singleton instance of `TokenManager` class
- `resolveToken(shell, options?)` -- async function
- `createTokenFn(shell, options?)` -- returns `() => Promise<string>`

`TokenManager` class (not exported, only the instance is):
- Private `tokens: Map<string, TokenResult>` keyed by cluster URL
- `setToken(clusterUrl: string, result: TokenResult): void`
- `getToken(clusterUrl: string): TokenResult | undefined`
- `removeToken(clusterUrl: string): void`
- `clear(): void`

`resolveToken()` checks sources in priority order:
1. `tokenManager` cache (calls `tokenManager.getToken()` using server URL from `oc whoami --show-server`)
2. `options?.token` if present (source: `"option"`)
3. `process.env.OPENSHIFT_TOKEN` if set (source: `"env"`)
4. kubeconfig via `oc whoami -t` (source: `"kubeconfig"`)
- Returns `TokenResult` with the token, source, and server URL
- Throws if no token can be resolved from any source

`createTokenFn()` returns an async function that calls `resolveToken()` and returns just the token string. This is the adapter for `ApiClientConfig.tokenFn`.

#### src/test-utils.ts

Exports:
- `MockCommand` type: `{ match: string | RegExp, output?: string, exitCode?: number, json?: unknown }`
- `MockRoute` type: `{ method?: string, path: string | RegExp, status?: number, body?: unknown, headers?: Record<string, string> }`
- `createMockShell(commands: MockCommand[]): PluginInput["$"]`
- `createMockFetch(routes: MockRoute[]): typeof fetch`

`createMockShell()`:
- Returns a callable that matches the `PluginInput["$"]` BunShell interface
- When called with a tagged template literal, matches the command string against `commands` entries (substring match for strings, `.test()` for RegExp)
- Returns a mock result object with `.text()`, `.json()`, `.nothrow()`, `.quiet()` methods
- `.text()` returns `command.output ?? ""`
- `.json()` returns `command.json ?? JSON.parse(command.output ?? "{}")`
- `.nothrow()` returns the same mock (prevents throw on non-zero exit)
- `.quiet()` returns the same mock (suppresses output)
- `.exitCode` returns `command.exitCode ?? 0`
- If no command matches, return exit code 1 with empty output
- Must support the `.env()`, `.cwd()`, `.escape()`, `.braces()` chainable methods (return self / no-op)

`createMockFetch()`:
- Returns a function matching the `fetch` signature
- Matches incoming requests against `routes` by method (default: `"GET"`) and path (substring for string, `.test()` for RegExp)
- Returns a `Response` with `route.status ?? 200`, `JSON.stringify(route.body)`, and `route.headers`
- If no route matches, returns 404

### Test specifications

**test/oc.test.ts:**
- `createOcClient` returns an object with all expected methods
- `isAvailable()` returns true when `which oc` exits 0
- `isAvailable()` returns false when `which oc` exits 1
- `isLoggedIn()` returns true when `oc whoami` exits 0
- `isLoggedIn()` returns false when `oc whoami` exits 1
- `get()` parses JSON output from `oc get pods -o json`
- `get()` throws `OcError` with stderr when command fails
- `whoami()` returns trimmed username string
- `token()` returns trimmed token string
- `version()` parses JSON version output into typed object
- `raw()` passes arguments through and returns stdout
- All tests use `createMockShell` from `../src/test-utils`

**test/api.test.ts:**
- `createApiClient` returns an object with get/post/put/delete methods
- `get()` calls fetch with Authorization Bearer header
- `get()` appends query params to URL
- `post()` sends JSON body with Content-Type header
- On 401 response, retries with fresh token (calls tokenFn twice)
- On 401 response with maxRetries=0, does not retry
- On non-2xx response (after retries), throws error with status and body
- All tests use `createMockFetch` from `../src/test-utils`

**test/auth.test.ts:**
- `tokenManager.setToken()` stores token, `getToken()` retrieves it
- `tokenManager.getToken()` returns undefined for unknown cluster
- `tokenManager.removeToken()` removes a stored token
- `tokenManager.clear()` removes all tokens
- `resolveToken()` returns cached token from tokenManager first (priority 1)
- `resolveToken()` returns option token when no cache exists (priority 2)
- `resolveToken()` returns env var token when no option exists (priority 3)
- `resolveToken()` falls back to `oc whoami -t` when no env var exists (priority 4)
- `resolveToken()` throws when no token source is available
- `createTokenFn()` returns a function that returns just the token string
- All tests use `createMockShell` from `../src/test-utils`

### Acceptance Criteria

- [ ] `bun install` from root resolves `tinycode-plugin-redhat-shared` as workspace package
- [ ] `import { createOcClient } from "tinycode-plugin-redhat-shared/oc"` resolves in other workspace packages
- [ ] `import { createApiClient } from "tinycode-plugin-redhat-shared/api"` resolves
- [ ] `import { tokenManager, resolveToken, createTokenFn } from "tinycode-plugin-redhat-shared/auth"` resolves
- [ ] `import { createMockShell, createMockFetch } from "tinycode-plugin-redhat-shared/test-utils"` resolves
- [ ] `cd redhat/_shared && bun test` passes all tests
- [ ] `cd redhat/_shared && tsc --noEmit` passes with no type errors

---

## Task 3: Scaffold All 13 Plugin Stubs

**Complexity:** M
**Dependencies:** Task 1

### Files to create (4 files per plugin x 13 plugins = 52 files)

Each plugin gets:
- `package.json`
- `tsconfig.json`
- `src/index.ts`
- `test/index.test.ts`

### Plugin directory and package name map

| # | Directory | Package name |
|---|-----------|-------------|
| 1 | `redhat/rhoai/model-serving/` | `tinycode-plugin-rhoai-models` |
| 2 | `redhat/satellite/lightspeed/` | `tinycode-plugin-satellite-lightspeed` |
| 3 | `redhat/openshift/cluster-ops/` | `tinycode-plugin-ocp-cluster-ops` |
| 4 | `redhat/security/rhacs/` | `tinycode-plugin-rhacs` |
| 5 | `redhat/automation/aap-bridge/` | `tinycode-plugin-aap-bridge` |
| 6 | `redhat/devex/quay/` | `tinycode-plugin-quay` |
| 7 | `redhat/security/lightwell/` | `tinycode-plugin-lightwell` |
| 8 | `redhat/devex/rhdh/` | `tinycode-plugin-rhdh` |
| 9 | `redhat/devex/tekton/` | `tinycode-plugin-tekton` |
| 10 | `redhat/rhoai/experiment-tracker/` | `tinycode-plugin-rhoai-experiments` |
| 11 | `redhat/openshift/context-injection/` | `tinycode-plugin-ocp-context` |
| 12 | `redhat/automation/eda-events/` | `tinycode-plugin-eda-events` |
| 13 | `redhat/openshift/oauth/` | `tinycode-plugin-ocp-oauth` |

### Template: package.json

```json
{
  "name": "<package-name-from-table>",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "description": "<one-line-description>",
  "engines": {
    "tinycode-plugin": ">=1"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "tinycode-plugin": "^1.18.0",
    "tinycode-plugin-redhat-shared": "workspace:*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/bun": "^1.3.0",
    "typescript": "^5.7.0"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```

One-line descriptions for each plugin:

| # | Description |
|---|-------------|
| 1 | RHOAI inference endpoint provider with model registry discovery |
| 2 | Satellite Lightspeed AI assistant provider |
| 3 | OpenShift cluster operations tools (get, logs, describe, apply) |
| 4 | RHACS security scanning and policy checking tools |
| 5 | Ansible Automation Platform MCP server bridge |
| 6 | Quay container registry search and inspection tools |
| 7 | Lightwell dependency vulnerability checking tools |
| 8 | Red Hat Developer Hub software catalog query tools |
| 9 | Tekton pipeline runner and Enterprise Contract verification tools |
| 10 | RHOAI experiment tracking via MLFlow |
| 11 | OpenShift cluster context injection into system prompt |
| 12 | Event-Driven Ansible session event bridge |
| 13 | OpenShift OAuth authentication for Red Hat plugins |

### Template: tsconfig.json

All plugins are 3 levels deep (`redhat/<category>/<plugin>/`), so:

```json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

### Template: src/index.ts

```typescript
import type { PluginModule } from "tinycode-plugin"

export default {
  server: async (input, options) => {
    return {
      // TODO: Implement plugin hooks
    }
  },
} satisfies PluginModule
```

### Template: test/index.test.ts

```typescript
import { describe, it, expect } from "bun:test"
import { createTestHarness } from "tinycode-plugin/test"
import plugin from "../src/index"

describe("<package-name-from-table>", () => {
  it("loads without error", async () => {
    const { hooks } = await createTestHarness(plugin)
    expect(hooks).toBeDefined()
  })
})
```

### Acceptance Criteria

- [ ] All 13 plugin directories exist with all 4 files each
- [ ] `bun install` from root resolves all 13 workspace packages plus `_shared`
- [ ] `bun test --recursive` from root runs all 13 stub tests plus `_shared` tests, all pass
- [ ] Each stub test verifies the plugin loads via `createTestHarness` without error
- [ ] `bun run --filter='*' typecheck` passes for all packages

---

## Task 4: Implement ocp-context Plugin

**Complexity:** M
**Dependencies:** Task 2 (needs `createOcClient` from `_shared/oc`), Task 3 (stub exists)

### Files to create/modify

| File | Action |
|------|--------|
| `redhat/openshift/context-injection/src/cluster-info.ts` | Create |
| `redhat/openshift/context-injection/src/index.ts` | Replace stub |
| `redhat/openshift/context-injection/test/cluster-info.test.ts` | Create |
| `redhat/openshift/context-injection/test/index.test.ts` | Replace stub |

### Specifications

#### src/cluster-info.ts

Exports:
- `ClusterContext` type:
  ```typescript
  type ClusterContext = {
    cluster: string       // from oc config current-context
    version: string       // from oc version (server version)
    nodes: string         // e.g., "6 (3 control-plane, 3 worker)"
    namespace: string     // from oc config current-context
    operators: string[]   // from oc get csv -A (names only)
  }
  ```
- `queryClusterContext(oc: OcClient): Promise<ClusterContext | null>` function

Implementation:
- Runs 4 queries in parallel via `Promise.allSettled`:
  1. `oc.version()` -- extracts `serverVersion` or `openshiftVersion`
  2. `oc.get("nodes")` -- counts nodes by role (look for `node-role.kubernetes.io/control-plane` and `node-role.kubernetes.io/worker` labels)
  3. `oc.raw("config", "current-context")` -- extracts cluster name and namespace from context string
  4. `oc.get("csv", { namespace: "all" })` -- or `oc.raw("get", "csv", "-A", "-o", "json")` -- extracts operator display names from `.items[].spec.displayName`
- Each `Promise.allSettled` result is checked: fulfilled results are used, rejected results get fallback values (empty string, `"unknown"`, empty array)
- If `oc.isLoggedIn()` returns false, return `null` immediately (skip all queries)
- If `oc.isAvailable()` returns false, return `null` immediately

#### src/index.ts

```typescript
import type { PluginModule } from "tinycode-plugin"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { queryClusterContext, type ClusterContext } from "./cluster-info"

export default {
  server: async (input, options) => {
    const oc = createOcClient(input.$)
    let cachedContext: ClusterContext | null = null

    return {
      "session.start": async (event, output) => {
        cachedContext = await queryClusterContext(oc)
      },

      "experimental.chat.system.transform": async (event, output) => {
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
```

`formatContextBlock(ctx: ClusterContext): string` is a local helper that formats:
```
<cluster-context>
cluster: <ctx.cluster>
version: <ctx.version>
nodes: <ctx.nodes>
namespace: <ctx.namespace>
operators: [<ctx.operators joined by ", ">]
</cluster-context>
```

No plugin options schema (this plugin has no configuration).

Remove `zod` from this plugin's `package.json` dependencies since it has no options schema.

#### test/cluster-info.test.ts

Tests using `createMockShell` from `tinycode-plugin-redhat-shared/test-utils`:
- `queryClusterContext()` returns a populated `ClusterContext` when all 4 queries succeed
- `queryClusterContext()` returns `null` when `oc` is not logged in (mock `oc whoami` returning exit code 1)
- `queryClusterContext()` returns `null` when `oc` is not available (mock `which oc` returning exit code 1)
- `queryClusterContext()` uses fallback values when individual queries fail (e.g., `oc get csv` fails but version/nodes succeed)
- Node count string correctly parses control-plane and worker roles from `oc get nodes -o json` output

Mock data for tests:
- `oc version -o json`: `{"clientVersion":{"major":"4","minor":"22"},"serverVersion":{"major":"1","minor":"31"},"openshiftVersion":"4.22.3"}`
- `oc get nodes -o json`: JSON with 6 items, 3 with `node-role.kubernetes.io/control-plane` label, 3 with `node-role.kubernetes.io/worker` label
- `oc config current-context`: `"default/api-mycluster-example-com:6443/admin"`
- `oc get csv -A -o json`: JSON with items containing `.spec.displayName` values like `"OpenShift Virtualization"`, `"Red Hat OpenShift Pipelines"`

#### test/index.test.ts

Tests using `createTestHarness` and `createMockPluginInput`:
- Plugin loads without error
- `session.start` hook populates cached context (invoke `session.start`, then invoke `experimental.chat.system.transform` and check `output.system` contains `<cluster-context>`)
- `experimental.chat.system.transform` injects `<cluster-context>not connected</cluster-context>` when oc is not logged in
- System prompt block contains expected fields: cluster, version, nodes, namespace, operators
- `dispose` hook clears cached context

### Acceptance Criteria

- [ ] `cd redhat/openshift/context-injection && bun test` passes all tests
- [ ] `cd redhat/openshift/context-injection && tsc --noEmit` passes
- [ ] `queryClusterContext()` runs 4 oc queries in parallel (uses `Promise.allSettled`, not sequential awaits)
- [ ] System prompt injection includes `<cluster-context>` XML block with cluster, version, nodes, namespace, operators fields
- [ ] When `oc` is unavailable or user is not logged in, injects `<cluster-context>not connected</cluster-context>` (no crash, no throw)
- [ ] Cached context is reused across multiple `experimental.chat.system.transform` calls within the same session (no re-query)

---

## Task 5: Implement ocp-oauth Plugin

**Complexity:** M
**Dependencies:** Task 2 (needs `tokenManager` from `_shared/auth`, `createOcClient` from `_shared/oc`), Task 3 (stub exists)

### Files to create/modify

| File | Action |
|------|--------|
| `redhat/openshift/oauth/src/index.ts` | Replace stub |
| `redhat/openshift/oauth/test/index.test.ts` | Replace stub |

### Specifications

#### src/index.ts

```typescript
import type { PluginModule } from "tinycode-plugin"
import { z } from "zod"
import { createOcClient } from "tinycode-plugin-redhat-shared/oc"
import { tokenManager } from "tinycode-plugin-redhat-shared/auth"

const schema = z.object({
  server: z.string().url().optional(),
}).optional()

export default {
  schema,
  server: async (input, options) => {
    const config = schema.parse(options ?? {})
    const oc = createOcClient(input.$)

    return {
      auth: {
        provider: "openshift",
        methods: [
          {
            type: "api" as const,
            label: "OpenShift API Token",
            prompts: [
              {
                type: "text" as const,
                key: "server",
                message: "OpenShift cluster API URL",
                placeholder: "https://api.mycluster.example.com:6443",
                validate: (value: string) => {
                  try {
                    new URL(value)
                    return undefined
                  } catch {
                    return "Must be a valid URL"
                  }
                },
              },
              {
                type: "text" as const,
                key: "token",
                message: "API token (starts with sha256~)",
                placeholder: "sha256~...",
                validate: (value: string) => {
                  if (!value.startsWith("sha256~")) {
                    return "Token must start with sha256~"
                  }
                  return undefined
                },
              },
            ],
            authorize: async (inputs?: Record<string, string>) => {
              const server = inputs?.server ?? config?.server
              const token = inputs?.token
              if (!server || !token) {
                return { type: "failed" as const }
              }

              // Run oc login to write to kubeconfig
              const result = await input.$`oc login --token=${token} --server=${server} --insecure-skip-tls-verify`.nothrow().quiet()
              if (result.exitCode !== 0) {
                return { type: "failed" as const }
              }

              // Store token in shared TokenManager for other plugins
              tokenManager.setToken(server, {
                token,
                source: "oauth",
                server,
              })

              return {
                type: "success" as const,
                key: token,
                metadata: { server },
              }
            },
          },
        ],
      },

      "shell.env": async (event, output) => {
        output.env["OC_EDITOR"] = "cat"
      },
    }
  },
} satisfies PluginModule
```

Key implementation notes:
- `auth` hook uses `type: "api"` (not `"oauth"` -- browser OAuth is Phase 2)
- Two prompts: server URL and token. Server URL is pre-filled from plugin options if configured.
- `authorize()` runs `oc login --token --server --insecure-skip-tls-verify` via the plugin's BunShell
- On success: stores token in `tokenManager` AND returns `{ type: "success", key: token, metadata: { server } }`
- On failure (non-zero exit from `oc login`): returns `{ type: "failed" }`
- `shell.env` hook injects `OC_EDITOR=cat` to prevent interactive editors

#### test/index.test.ts

Tests using `createTestHarness`, `createMockPluginInput`, and `createMockShell`:
- Plugin loads without error
- `auth` hook is registered with `provider: "openshift"`
- `auth.methods[0].type` is `"api"`
- `auth.methods[0].prompts` has 2 entries: server (text) and token (text)
- Server URL prompt validator accepts valid URLs and rejects invalid ones
- Token prompt validator accepts strings starting with `sha256~` and rejects others
- `authorize()` returns `{ type: "success" }` when `oc login` succeeds (mock shell returns exit code 0)
- `authorize()` returns `{ type: "failed" }` when `oc login` fails (mock shell returns exit code 1)
- `authorize()` calls `tokenManager.setToken()` on success (import `tokenManager` from `_shared/auth` and check `tokenManager.getToken(server)` after authorize)
- `authorize()` returns `{ type: "failed" }` when server or token is missing
- `shell.env` hook sets `OC_EDITOR` to `"cat"`
- Schema validates `{ server: "https://example.com" }` and rejects `{ server: "not-a-url" }`
- Schema accepts `undefined` and `{}` (both optional)
- Clean up: call `tokenManager.clear()` in `afterEach` to avoid test pollution

### Acceptance Criteria

- [ ] `cd redhat/openshift/oauth && bun test` passes all tests
- [ ] `cd redhat/openshift/oauth && tsc --noEmit` passes
- [ ] Auth hook registers with `provider: "openshift"` and `type: "api"`
- [ ] Server URL prompt validates URL format
- [ ] Token prompt validates `sha256~` prefix
- [ ] On successful `oc login`, `tokenManager.setToken()` is called with the token, source `"oauth"`, and server URL
- [ ] On failed `oc login` (non-zero exit), `authorize()` returns `{ type: "failed" }` without throwing
- [ ] `shell.env` hook injects `OC_EDITOR=cat`
- [ ] Plugin options schema validates with zod (accepts valid options, rejects invalid server URLs)

---

## Task 6: End-to-End Verification

**Complexity:** S
**Dependencies:** Tasks 1-5

### Commands to run

1. `bun install` -- verify workspace resolution for all 14 packages (13 plugins + `_shared`)
2. `bun test --recursive` -- all tests pass across all packages
3. `bun run typecheck` -- (which runs `bun run --filter='*' typecheck`) -- all packages type-check clean

### Verification checklist

- [ ] `bun install` exits 0 and resolves all `workspace:*` dependencies
- [ ] `bun test --recursive` exits 0 with all tests passing
- [ ] `bun run --filter='*' typecheck` exits 0 for every package
- [ ] No TypeScript errors in any package
- [ ] No unresolved workspace references
- [ ] All 13 plugin stubs load via `createTestHarness` without error
- [ ] `_shared` tests pass (oc, api, auth modules)
- [ ] ocp-context tests pass (cluster context query, system prompt injection, graceful degradation)
- [ ] ocp-oauth tests pass (auth hook, oc login side effect, schema validation, shell.env)
- [ ] `git status` shows no untracked files that should be committed (verify `.gitignore` works)

### Acceptance Criteria

- [ ] All three commands (`bun install`, `bun test --recursive`, `bun run typecheck`) exit with code 0
- [ ] Zero test failures
- [ ] Zero type errors

---

## Success Criteria

The Phase 1 implementation is complete when:

1. The monorepo builds and resolves all workspace dependencies
2. The shared package (`tinycode-plugin-redhat-shared`) exports working OC CLI wrapper, HTTP client, token manager, and test utilities
3. All 13 plugin stubs load without error
4. The ocp-context plugin injects cluster context into the system prompt on session start
5. The ocp-oauth plugin authenticates via API token, runs `oc login`, and stores the token in the shared `tokenManager`
6. `bun install && bun test --recursive && bun run typecheck` all pass with zero failures and zero type errors
