# Tinycode Plugins Monorepo — Design Specification

**Date:** 2026-08-25
**Status:** Draft
**Plugin API version:** 1 (tinycode-plugin ^1.18.0)

---

## 1. Monorepo Configuration

### 1.1 Root package.json

```json
{
  "name": "tinycode-plugins",
  "private": true,
  "type": "module",
  "workspaces": [
    "redhat/_shared",
    "redhat/*/*"
  ],
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

- `"private": true` prevents accidental root publish.
- `"redhat/_shared"` + `"redhat/*/*"` covers the shared package (depth 1) and all plugins (depth 2).

### 1.2 Root tsconfig.json

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

### 1.3 .gitignore

```
node_modules/
dist/
*.tsbuildinfo
.env
.env.*
!.env.example
.DS_Store
```

---

## 2. Plugin Package Template

Every plugin follows the working example at `tinycode/examples/tinycode-plugin-hello/`.

### 2.1 package.json

```json
{
  "name": "tinycode-plugin-<name>",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "description": "<one-line description>",
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

**Export path is `"."` not `"./server"`.** The plugin-development docs say `"./server"`, but the working example plugin uses `"."` and it works. We follow the working example.

### 2.2 tsconfig.json

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

Extends path is `../../../tsconfig.json` for all plugins (3 levels deep). The `_shared` package uses `../../tsconfig.json` (2 levels deep).

### 2.3 src/index.ts stub

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

### 2.4 test/index.test.ts stub

```typescript
import { describe, it, expect } from "bun:test"
import { createTestHarness } from "tinycode-plugin/test"
import plugin from "../src/index"

describe("tinycode-plugin-<name>", () => {
  it("loads without error", async () => {
    const { hooks } = await createTestHarness(plugin)
    expect(hooks).toBeDefined()
  })
})
```

### 2.5 Plugin name mapping

| # | Directory | npm package name |
|---|-----------|-----------------|
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

---

## 3. Shared Package Design (`redhat/_shared/`)

### 3.1 Architecture Decision: Published npm Package

`_shared` is published to npm as `tinycode-plugin-redhat-shared`. This is NOT an internal-only workspace package.

**Why:** Cross-plugin auth sharing (Section 4) depends on all plugins sharing the same module instance of the `TokenManager` singleton. Publishing `_shared` as a real npm package ensures npm deduplication provides a single instance. Bundling `_shared` into each plugin would create separate `TokenManager` instances per plugin, breaking the "authenticate once" promise.

During development, `workspace:*` resolution handles local linking. On npm publish, Bun/npm replaces `workspace:*` with the actual version.

### 3.2 package.json

```json
{
  "name": "tinycode-plugin-redhat-shared",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "description": "Shared utilities for Red Hat tinycode plugins",
  "exports": {
    "./oc": "./src/oc.ts",
    "./api": "./src/api.ts",
    "./auth": "./src/auth.ts",
    "./test-utils": "./src/test-utils.ts"
  },
  "dependencies": {
    "tinycode-plugin": "^1.18.0"
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

Subpath exports (not a barrel `"."`) so plugins import only what they need: `import { createOcClient } from "tinycode-plugin-redhat-shared/oc"`.

### 3.3 oc.ts — OC CLI wrapper

Wraps `oc` CLI via the plugin's `$` BunShell. Provides typed methods that run `oc -o json` and parse output.

```typescript
import type { PluginInput } from "tinycode-plugin"

type Shell = PluginInput["$"]

export class OcError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message)
    this.name = "OcError"
  }
}

export type OcClient = {
  get<T = unknown>(resource: string, options?: OcGetOptions): Promise<T>
  apply(manifest: string): Promise<string>
  logs(pod: string, options?: OcLogOptions): Promise<string>
  describe(resource: string, name: string, namespace?: string): Promise<string>
  whoami(): Promise<string>
  token(): Promise<string>
  version(): Promise<{ clientVersion: string; serverVersion?: string; openshiftVersion?: string }>
  isAvailable(): Promise<boolean>
  isLoggedIn(): Promise<boolean>
  raw(...args: string[]): Promise<string>
}

export function createOcClient(shell: Shell): OcClient
```

**Error contract:** `isAvailable()` checks `which oc`. If `oc` is not installed, all other methods throw `OcError` with message: `"The 'oc' CLI is required but not found. Install it from https://console.redhat.com/openshift/downloads"`. If `oc` is available but the user is not logged in, `isLoggedIn()` returns `false` and query methods throw `OcError` with the stderr from `oc`.

### 3.4 api.ts — Typed HTTP client

HTTP client for Red Hat product REST APIs. Uses global `fetch()`, no external deps.

```typescript
export type ApiClientConfig = {
  baseUrl: string
  tokenFn: () => Promise<string>
  headers?: Record<string, string>
  maxRetries?: number  // default: 1
}

export type ApiClient = {
  get<T = unknown>(path: string, query?: Record<string, string>): Promise<ApiResponse<T>>
  post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>
  put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>
  delete<T = unknown>(path: string): Promise<ApiResponse<T>>
}

export function createApiClient(config: ApiClientConfig): ApiClient
```

Token injection via `Authorization: Bearer` header. On 401, calls `tokenFn()` again and retries up to `maxRetries`.

### 3.5 auth.ts — Singleton Token Manager

**This is the cross-plugin auth mechanism.** See Section 4 for the full architecture.

```typescript
import type { PluginInput } from "tinycode-plugin"

export type TokenSource = "kubeconfig" | "env" | "option" | "oauth"

export type TokenResult = {
  token: string
  source: TokenSource
  server: string
}

class TokenManager {
  private tokens = new Map<string, TokenResult>()

  setToken(clusterUrl: string, result: TokenResult): void
  getToken(clusterUrl: string): TokenResult | undefined
  removeToken(clusterUrl: string): void
  clear(): void
}

export const tokenManager = new TokenManager()

export async function resolveToken(
  shell: PluginInput["$"],
  options?: Record<string, unknown>,
): Promise<TokenResult>

export function createTokenFn(
  shell: PluginInput["$"],
  options?: Record<string, unknown>,
): () => Promise<string>
```

`tokenManager` is a module-level singleton. All plugins importing `tinycode-plugin-redhat-shared/auth` get the same instance because plugins load in the same Bun process (verified: `loader.ts:139` uses `await import()`).

`resolveToken()` checks sources in priority order: (1) `tokenManager` cache, (2) plugin options, (3) environment variable `OPENSHIFT_TOKEN`, (4) kubeconfig via `oc whoami -t`.

### 3.6 test-utils.ts — Mock helpers

```typescript
export function createMockShell(commands: MockCommand[]): PluginInput["$"]
export function createMockFetch(routes: MockRoute[]): typeof fetch
```

Mock shell matches commands by substring/regex, returns predefined output. Supports the full BunShell chain (`.quiet()`, `.nothrow()`, `.text()`, `.json()`).

---

## 4. Cross-Plugin Auth Architecture

### 4.1 The Problem

10 of 13 plugins need OpenShift cluster auth. The tinycode plugin API has no inter-plugin communication mechanism — each plugin receives its own `PluginInput` and cannot import or call other plugins.

### 4.2 The Solution: Singleton Token Manager + kubeconfig

Plugins communicate indirectly through two channels:

1. **`tokenManager` singleton** — `_shared/auth.ts` exports a module-level `TokenManager` instance. Since all plugins load in the same Bun process via `await import()`, they share the same module instance and therefore the same token cache.

2. **`oc` CLI kubeconfig** — The ocp-oauth plugin runs `oc login` on successful auth, writing credentials to `~/.kube/config`. Other plugins use `oc` commands which inherit this auth state.

### 4.3 Token Flow

```
User authenticates via ocp-oauth plugin
       |
       ├── tokenManager.setToken(clusterUrl, { token, source: "oauth", server })
       |
       └── oc login --token=<token> --server=<url>
              |
              v
         ~/.kube/config updated
              |
    ┌─────────┼─────────┬──────────┬──────────┐
    v         v         v          v          v
 ocp-context  cluster-ops  rhacs     tekton    rhdh
 (uses oc)    (uses oc)    (uses     (uses     (uses
                           API +     oc)       API +
                           tokenMgr)           tokenMgr)
```

Plugins that call REST APIs directly (RHACS, RHDH, Quay) use `createTokenFn()` which reads from `tokenManager` first, falls back to `oc whoami -t`.

### 4.4 Graceful Degradation

If ocp-oauth is not loaded, other plugins still work — they require the user to have run `oc login` manually. Every plugin that depends on `oc` checks `isLoggedIn()` and returns helpful error messages rather than crashing.

### 4.5 Security: Credentials in Auth Hooks, Not Plugin Options

**Rule:** URLs and non-sensitive configuration go in plugin options. Credentials (tokens, passwords, API keys) go through tinycode's `auth` hook system.

This applies to: RHACS (centralUrl in options, API token via auth hook), AAP (controller URL in options, OAuth token via auth hook), Quay (registry URL in options, token via auth hook), Lightwell (service account creds via auth hook).

The `auth` hook provides tinycode's built-in credential storage, prompt UI, and token lifecycle management. Plugin options are stored in plaintext `config.json`.

---

## 5. Phase 1 Implementation

Build order: `_shared` → `ocp-context` → `ocp-oauth`

### 5.1 ocp-context (Plugin 11: Cluster Context Injection)

**Hooks:** `session.start`, `experimental.chat.system.transform`

**Note on experimental hook:** `experimental.chat.system.transform` may change without a major version bump. This risk is acceptable — the oh-my-tiny reference plugin uses this hook successfully, and the fix for a signature change would be small. Monitor tinycode changelogs on upgrade.

**Architecture:**

```
src/
  index.ts          # Plugin entry, hooks
  cluster-info.ts   # Query logic (separated for testability)
```

**Behavior:**
- On `session.start`: runs `oc version`, `oc get nodes`, `oc config current-context`, `oc get csv -A` in parallel via `Promise.allSettled`
- Caches result for session duration
- On `experimental.chat.system.transform`: pushes cached `<cluster-context>` block into system prompt
- If `oc` unavailable or not logged in: pushes `<cluster-context>not connected</cluster-context>`

**No plugin options schema needed** — this plugin has no configuration.

### 5.2 ocp-oauth (Plugin 13: OpenShift OAuth Auth)

**Hooks:** `auth`, `shell.env`

**Architecture:**

```
src/
  index.ts          # Plugin entry, auth hook
```

**Auth methods (Phase 1: API token only):**
1. Prompt for cluster URL and API token (`sha256~...`)
2. On success: call `tokenManager.setToken()` AND run `oc login --token --server`
3. Browser-based OAuth flow deferred to Phase 2

**Shell.env hook:**
- Injects `OC_EDITOR=cat` to prevent interactive editors

**Option schema:**

```typescript
z.object({
  server: z.string().url().optional(),
}).optional()
```

**Design note on `auth` hook semantics:** The `auth` hook was designed for LLM provider auth. Using it with `provider: "openshift"` for cluster auth is an unconventional but functional use — it gives us tinycode's built-in credential UI and storage for free. The trade-off is "openshift" appears in the provider list even though it's not an LLM provider.

---

## 6. Testing Strategy

### 6.1 Conventions

- Runner: `bun:test`
- Location: `test/` directory next to `src/`
- Naming: `<module>.test.ts`
- Run: `bun test` per plugin, `bun test --recursive` at root
- Target: 80% coverage per project testing rules

### 6.2 Mock patterns

**oc CLI:** Use `createMockShell` from `_shared/test-utils`. Match commands by substring, return canned JSON.

**HTTP APIs:** Use `createMockFetch` from `_shared/test-utils`. Replace `globalThis.fetch` in test scope, restore in `afterEach`.

**No live clusters in CI.** Integration tests against real clusters go in `test/integration/*.integration.test.ts`, excluded from default `bun test` runs.

### 6.3 Phase 1 test scope

- `_shared/oc.ts`: `get()` JSON parsing, `isAvailable()`, `isLoggedIn()`, `OcError` on failure
- `_shared/api.ts`: token injection, 401 retry, error responses
- `_shared/auth.ts`: `TokenManager` set/get/resolve, priority order
- `ocp-context`: system prompt injection with mock oc output, graceful degradation when not logged in
- `ocp-oauth`: auth hook registration, `oc login` side effect on success, schema validation

---

## 7. Acknowledged Risks

### 7.1 Experimental hook dependency

Plugins 3 and 11 use `experimental.chat.system.transform`. This hook can change without a major version bump. Mitigation: pin `tinycode-plugin` dependency, monitor changelogs, keep the hook usage thin (a few lines of system prompt injection).

### 7.2 Singleton module deduplication

Cross-plugin auth depends on all plugins resolving `tinycode-plugin-redhat-shared/auth` to the same module instance. Verified that tinycode loads plugins in the same Bun process. Risk: npm version mismatches could create multiple copies. Mitigation: strict version pinning for `_shared`, test multi-plugin install scenario early.

### 7.3 `oc` binary availability

All OCP plugins assume `oc` is on PATH. `createOcClient` checks availability on construction and returns clear error messages pointing to the download URL.

---

## 8. Dispose Hooks

Plugins with persistent state must implement `dispose`:

| Plugin | State to clean up |
|--------|------------------|
| RHOAI Model Serving | Stop model registry polling interval |
| RHOAI Experiment Tracker | Flush pending metrics to MLFlow |
| EDA Session Events | Flush pending event queue |
| ocp-context | Clear cached context (minor) |

Stateless plugins (tools that make one-shot API calls) do not need `dispose`.

---

## Appendix: Directory Tree

```
tinycode-plugins/
  .gitignore
  package.json
  tsconfig.json
  LICENSE
  docs/
    tinycode_redhat_plugin_ideas.md
    superpowers/specs/
      2026-08-25-tinycode-plugins-monorepo-design.md
  redhat/
    _shared/
      package.json
      tsconfig.json
      src/
        oc.ts
        api.ts
        auth.ts
        test-utils.ts
      test/
        oc.test.ts
        api.test.ts
        auth.test.ts
    openshift/
      cluster-ops/        (stub)
      context-injection/  (implemented)
      oauth/              (implemented)
    rhoai/
      model-serving/      (stub)
      experiment-tracker/  (stub)
    security/
      rhacs/              (stub)
      lightwell/          (stub)
    automation/
      aap-bridge/         (stub)
      eda-events/         (stub)
    devex/
      quay/               (stub)
      rhdh/               (stub)
      tekton/             (stub)
    satellite/
      lightspeed/         (stub)
```
