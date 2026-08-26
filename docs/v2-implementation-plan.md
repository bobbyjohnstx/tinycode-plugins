# tinycode-plugins v2 Implementation Plan

**Date:** 2026-08-25
**Scope:** 25 Gitea issues (#15-#39) across 4 phases, 8 execution batches
**Baseline:** 13 plugins, 296 tests, 14 packages typechecking clean

---

## Architecture Decisions (Final)

These are locked. Do not deviate.

1. Plugin 23 (RHOAI Platform Tools) split into #35 (Pipelines) and #36 (Eval/TrustyAI/Workbenches), sharing `redhat/rhoai/`
2. Plugin 21 (Observability) split into #30 (Metrics/Alerts) and #31 (Logging/Tracing)
3. Plugin 19 (Learning Paths) merged into #28 (Developer Content Search)
4. Plugin 3 enhancements (#20, #22, #26) go into separate source files; existing 6 tools refactored into `core-tools.ts` first so `index.ts` becomes an aggregator
5. Plugins #28 and #38 must use configurable paths via plugin options schema (no hardcoded filesystem paths)
6. 4 shared prerequisites (#15-#18) must be built before their dependents
7. New directories: `redhat/reference/` for content/catalog plugins, `redhat/fleet/` for RHACM
8. Before #34 (MLFlow Tools), move `experiment-tracker/src/mlflow-client.ts` to `_shared/src/mlflow.ts`

## Dependency Graph

```
Phase 1 (Foundation)
  #15 (console auth) ──→ #19 (Cost), #22 (Insights), #21 (Sandbox), #39 (RHDP Provisioner)
  #16 (PromQL)       ──→ #30 (Obs Metrics), #26 (Obs Shortcuts), #32 (RHACM)
  #17 (Local Search) ──→ #28 (Dev Content), #38 (Ecosystem Catalog)
  #18 (Containerfile) ─→ #25 (Lightwell CF), #29 (Container Linter)
  cluster-ops refactor → #20 (GitOps), #22 (Insights), #26 (Obs Shortcuts)
  mlflow migration    ──→ #34 (MLFlow Tools)

Phase 2→3 chains
  #30 (Obs Metrics)  ──→ #31 (Obs Logging/Tracing)
  #34 (MLFlow Tools) ──→ #27 (Experiment Tracker Read-Side)

No upstream dependency (can start anytime after Phase 1)
  #23 (RHACS Compliance), #24 (AAP Linting), #33 (RHOAI MCP Bridge),
  #35 (RHOAI Pipelines), #36 (RHOAI Eval/TrustyAI), #37 (API Catalog)
```

## Existing Patterns Reference

Every new plugin and enhancement MUST follow these established patterns. Do not invent new patterns.

**API-based plugin structure** (see `rhacs/src/index.ts`, `aap-bridge/src/index.ts`):
- Separate `*-client.ts` for API calls (typed request/response, uses `createApiClient` from shared)
- `src/index.ts` exports `PluginModule` with `schema` (zod options), `server` function
- `server` returns `Hooks` with `tool` record
- `notConfigured()` helper returns user-friendly message
- `createTools(client)` for configured state, `createUnconfiguredTools()` for unconfigured
- All tools use plain objects (NOT the broken `tool()` helper import)
- Error handling: try/catch in every execute, return string error messages

**oc-based plugin structure** (see `cluster-ops/src/index.ts`):
- `createOcClient(input.$)` from `tinycode-plugin-redhat-shared/oc`
- JSON output parsing via `oc.get<T>()`, raw output via `oc.raw()`
- Tools defined inline in the `tool` record

**Lifecycle hook plugin** (see `context-injection/src/index.ts`, `experiment-tracker/src/index.ts`):
- `session.start` / `session.end` hooks for setup/teardown
- `experimental.chat.system.transform` for system prompt injection
- `tool.execute.after` for post-tool-execution side effects
- State stored in closure variables (e.g., `let cachedContext`, `let runId`)

**Test pattern** (see `rhacs/test/index.test.ts`):
- Import `createMockShell`, `createMockInput`, `createMockFetch` from `tinycode-plugin-redhat-shared/test-utils`
- Override `globalThis.fetch` for API mocking, restore in `afterEach`
- Helper: `getTools(options)` calls `plugin.server(input, options)` and returns `hooks.tool!`
- Test groups: plugin loading (configured/unconfigured), each tool (success/empty/error), unconfigured variants
- ~20-30 tests per plugin, 300-400 lines per test file

**Package scaffolding** (copy from any existing plugin):
- `package.json` with name, exports `./src/index.ts`, deps on `tinycode-plugin` + `tinycode-plugin-redhat-shared`
- `tsconfig.json` extending root config
- `src/index.ts` + `src/*-client.ts`
- `test/index.test.ts`

---

## Phase 1: Shared Infrastructure

**Goal:** Build the 4 shared utility modules and perform 2 structural refactors that all subsequent phases depend on.
**Parallelism:** All 6 items are independent. Run all in a single batch.
**Estimated scope:** ~800 lines code + ~500 lines tests, 12-15 files created/modified

### Batch 1 (6 parallel items)

---

#### #15 — Shared: console.redhat.com Auth Client

**Package:** `redhat/_shared/`
**Files to create:** `src/console-auth.ts`
**Files to test:** `test/console-auth.test.ts`

**Implementation steps:**
1. Create `ConsoleAuthConfig` type with fields: `offlineToken: string` (from `console.redhat.com/openshift/token`), `ssoUrl?: string` (default `https://sso.redhat.com`), `apiBaseUrl?: string` (default `https://console.redhat.com`)
2. Implement `createConsoleAuthClient(config)` returning `ConsoleAuthClient` with:
   - `getAccessToken(): Promise<string>` — exchanges offline token for short-lived access token via `POST ${ssoUrl}/auth/realms/redhat-external/protocol/openid-connect/token` with `grant_type=refresh_token&client_id=cloud-services&refresh_token=${offlineToken}`
   - `isConfigured(): boolean` — returns true if offlineToken is set
   - Internal caching: store access token + expiry, refresh when within 60s of expiry
3. Add export `"./console-auth": "./src/console-auth.ts"` to `_shared/package.json`
4. Write tests: token exchange success, token caching (second call uses cache), token refresh on expiry, error on invalid offline token (401), error on network failure

**Tests:** 8-10 tests
**Acceptance:** `createConsoleAuthClient({offlineToken: "test"}).getAccessToken()` returns a token string. Token is cached on second call. 401 response throws with descriptive error.

**Risk:** SSO token exchange endpoint behavior needs validation against real Red Hat SSO. The `client_id=cloud-services` grant type is based on documented patterns but may differ. If the auth flow is more complex (e.g., requires PKCE), this module will need a spike. **Mitigation:** Build the interface first, stub the implementation, validate against a real offline token before Phase 2 starts.

---

#### #16 — Shared: PromQL/Observability Query Client

**Package:** `redhat/_shared/`
**Files to create:** `src/promql.ts`
**Files to test:** `test/promql.test.ts`

**Implementation steps:**
1. Create `PromQLClientConfig` type: `{ baseUrl: string; tokenFn: () => Promise<string>; namespace?: string }`
2. Implement `createPromQLClient(config)` returning `PromQLClient` with:
   - `instantQuery(query: string): Promise<PromQLResult>` — `GET /api/v1/query?query=...` returns `{ resultType, result: Array<{metric, value}> }`
   - `rangeQuery(query: string, start: string, end: string, step: string): Promise<PromQLResult>` — `GET /api/v1/query_range?query=...&start=...&end=...&step=...`
   - `alerts(): Promise<Alert[]>` — `GET /api/v1/alerts` returns firing and pending alerts with labels, annotations, state, activeAt
   - `silenceAlert(matchers: AlertMatcher[], duration: string, comment: string): Promise<string>` — `POST /api/v1/silences`
3. Define result types: `PromQLResult` (union of vector/matrix/scalar), `Alert` (name, state, labels, annotations, activeAt, value), `AlertMatcher` (name, value, isRegex)
4. Use `createApiClient` from `./api.ts` internally for HTTP calls
5. Add export `"./promql": "./src/promql.ts"` to `_shared/package.json`
6. Write tests: instant query returns vector results, range query returns matrix results, alerts returns firing/pending list, silence creates and returns silence ID, network error handling, empty results

**Tests:** 10-12 tests
**Acceptance:** `createPromQLClient(config).instantQuery("up")` returns parsed `PromQLResult` with `resultType: "vector"` and typed result array. `alerts()` returns typed `Alert[]`.

**Risk:** OpenShift Prometheus may be behind an OAuth proxy (`oauth-proxy` sidecar). The client may need to handle `thanos-querier` endpoints vs. direct Prometheus. **Mitigation:** Support both `baseUrl` patterns: direct Prometheus (`/api/v1/query`) and Thanos Querier (same path but via route). Auth via bearer token handles both cases.

---

#### #17 — Shared: Local File Search/Index Utility

**Package:** `redhat/_shared/`
**Files to create:** `src/local-search.ts`
**Files to test:** `test/local-search.test.ts`

**Implementation steps:**
1. Create `LocalSearchConfig` type: `{ basePath: string; extensions?: string[]; indexFields?: ("title" | "filename" | "content")[] }`
2. Implement `createLocalSearchIndex(config)` returning `LocalSearchIndex` with:
   - `build(): Promise<void>` — recursively scan `basePath` for files matching `extensions` (default `[".txt", ".md", ".json"]`), build in-memory index of `{ filePath, title (first line), filename }` entries
   - `search(query: string, limit?: number): Promise<SearchResult[]>` — case-insensitive keyword matching against indexed fields, returns `{ filePath, title, score, snippet }` sorted by relevance score (number of keyword hits)
   - `getContent(filePath: string): Promise<string>` — read file content, validate path is under `basePath` (path traversal prevention)
   - `count(): number` — number of indexed files
3. Path traversal prevention: `getContent` must verify the resolved absolute path starts with `config.basePath`
4. Performance: lazy-load file content (index only title + filename by default). Full content search is opt-in via `indexFields: ["content"]`
5. Add export `"./local-search": "./src/local-search.ts"` to `_shared/package.json`
6. Write tests using a temp directory with test fixture files: build indexes files, search returns ranked results, getContent reads file, getContent rejects path traversal (`../../etc/passwd`), search with no matches returns empty array, count returns correct number

**Tests:** 10-12 tests
**Acceptance:** `createLocalSearchIndex({ basePath: "/tmp/test" }).search("quarkus")` returns array of `SearchResult` with `filePath`, `title`, `score`. Path traversal attempt throws error.

---

#### #18 — Shared: Containerfile Parser

**Package:** `redhat/_shared/`
**Files to create:** `src/containerfile-parser.ts`
**Files to test:** `test/containerfile-parser.test.ts`

**Implementation steps:**
1. Create `ContainerfileInstruction` union type covering: `FROM` (image, tag, alias), `RUN` (command string, multi-line support), `COPY` (src, dest), `ADD` (src, dest), `ENV` (key, value), `EXPOSE` (port, protocol), `USER` (user), `WORKDIR` (path), `LABEL` (key, value), `ARG` (name, default), `ENTRYPOINT` (exec/shell form), `CMD` (exec/shell form), `HEALTHCHECK`, `VOLUME`, `STAGECOMMENT` (comment lines)
2. Implement `parseContainerfile(content: string): ParsedContainerfile` returning:
   - `stages: Stage[]` — each stage has `from: { image, tag, alias }` + `instructions: ContainerfileInstruction[]`
   - `args: Array<{ name, default }>` — top-level ARG instructions (before first FROM)
3. Implement `extractDependencies(parsed: ParsedContainerfile): Dependency[]` — finds dependencies from:
   - `RUN pip install <package>==<version>` and `RUN pip install -r requirements.txt`
   - `RUN mvn ... -DartifactId=...` patterns
   - `COPY requirements.txt`, `COPY pom.xml` references
   - `RUN npm install <package>@<version>` and `COPY package.json`
4. Handle multi-line RUN instructions (backslash continuation)
5. Add export `"./containerfile-parser": "./src/containerfile-parser.ts"` to `_shared/package.json`
6. Write tests: parse single-stage Containerfile, parse multi-stage, extract pip dependencies, extract maven dependencies, handle multi-line RUN, parse FROM with tag and alias, handle comments, empty file

**Tests:** 12-15 tests
**Acceptance:** `parseContainerfile("FROM ubi9:9.4\nRUN pip install flask==2.3.0")` returns parsed stages with correct FROM image/tag and RUN instruction. `extractDependencies()` returns `[{ name: "flask", version: "2.3.0", source: "pip" }]`.

---

#### Refactor A — Cluster Ops: Extract core-tools.ts

**Package:** `redhat/openshift/cluster-ops/`
**Files to create:** `src/core-tools.ts`
**Files to modify:** `src/index.ts`

**Implementation steps:**
1. Create `src/core-tools.ts` exporting `createCoreTools(oc: OcClient): Record<string, ToolDefinition>` containing the 6 existing tools: `ocp_get_resources`, `ocp_logs`, `ocp_describe`, `ocp_events`, `ocp_apply`, `ocp_status`
2. Move all 6 tool definitions from `src/index.ts` into `createCoreTools()` — cut/paste, no logic changes
3. Refactor `src/index.ts` to import `createCoreTools` and spread into the `tool` record: `tool: { ...createCoreTools(oc) }`
4. The `shell.env` hook stays in `index.ts`
5. Run existing tests — all 379 lines of `test/index.test.ts` must pass without changes
6. `index.ts` is now an aggregator that will also spread in GitOps tools (#20), Insights tools (#22), and Obs Shortcuts (#26) in Phase 2

**Tests:** 0 new tests (existing tests must pass unchanged)
**Acceptance:** `bun test` in `redhat/openshift/cluster-ops/` passes. All existing test assertions unchanged. `index.ts` imports from `core-tools.ts` and spreads.

---

#### Refactor B — MLflow Client Migration

**Package:** `redhat/_shared/` and `redhat/rhoai/experiment-tracker/`
**Files to create:** `_shared/src/mlflow.ts`
**Files to modify:** `experiment-tracker/src/index.ts`, `_shared/package.json`

**Implementation steps:**
1. Copy `redhat/rhoai/experiment-tracker/src/mlflow-client.ts` to `redhat/_shared/src/mlflow.ts`
2. Update the import path: change `import type { ApiClient } from "tinycode-plugin-redhat-shared/api"` to a relative import `import type { ApiClient } from "./api"` (since it's now inside _shared)
3. Add export `"./mlflow": "./src/mlflow.ts"` to `_shared/package.json`
4. Update `experiment-tracker/src/index.ts`: change `import { createMlflowClient } from "./mlflow-client"` to `import { createMlflowClient } from "tinycode-plugin-redhat-shared/mlflow"`
5. Delete `experiment-tracker/src/mlflow-client.ts`
6. Run experiment-tracker tests — must pass unchanged

**Tests:** 0 new tests (existing tests must pass unchanged)
**Acceptance:** `bun test` in `redhat/rhoai/experiment-tracker/` passes. `import { createMlflowClient } from "tinycode-plugin-redhat-shared/mlflow"` resolves correctly. Old `mlflow-client.ts` file is deleted.

---

### Phase 1 Verification Gate

Run these commands. All must pass before starting Phase 2:

```bash
bun test --recursive                    # All tests pass (296 existing + ~40 new)
bun run typecheck                       # All 14+ packages typecheck clean
# Verify new shared exports resolve:
bun -e "import { createConsoleAuthClient } from './redhat/_shared/src/console-auth'; console.log('ok')"
bun -e "import { createPromQLClient } from './redhat/_shared/src/promql'; console.log('ok')"
bun -e "import { createLocalSearchIndex } from './redhat/_shared/src/local-search'; console.log('ok')"
bun -e "import { parseContainerfile } from './redhat/_shared/src/containerfile-parser'; console.log('ok')"
bun -e "import { createMlflowClient } from './redhat/_shared/src/mlflow'; console.log('ok')"
```

**Expected test count after Phase 1:** ~336 tests (296 existing + ~40 new shared module tests)

---

## Phase 2: Existing Plugin Enhancements

**Goal:** Add 8 enhancements to existing plugins using the shared infrastructure from Phase 1.
**Parallelism:** 2 batches. Batch 2A has no inter-dependencies. Batch 2B items are also independent of each other but logically grouped as a second wave.
**Estimated scope:** ~1,400 lines code + ~900 lines tests, 16-20 files created/modified

### Batch 2A (5 parallel items)

---

#### #20 — Enhancement: Cluster Ops - GitOps Awareness

**Package:** `redhat/openshift/cluster-ops/`
**Files to create:** `src/gitops-tools.ts`, `test/gitops-tools.test.ts`
**Files to modify:** `src/index.ts`
**Depends on:** Refactor A (core-tools.ts extraction)

**Implementation steps:**
1. Create `src/gitops-tools.ts` exporting `createGitOpsTools(oc: OcClient): Record<string, ToolDefinition>` with 4 tools:
   - `ocp_gitops_apps` — `oc get applications.argoproj.io -n openshift-gitops -o json` → parse into list with name, syncStatus, healthStatus, lastSyncTime
   - `ocp_gitops_sync` — `oc patch application <name> -n openshift-gitops --type=merge -p '{"operation":{"initiatedBy":{"username":"tinycode"},"sync":{"revision":"HEAD"}}}'` (with `ctx.ask()` permission prompt)
   - `ocp_gitops_diff` — `oc get application <name> -n openshift-gitops -o jsonpath='{.status.resources}'` → filter for resources where `status != Synced`, format as diff showing desired vs live state
   - `ocp_gitops_history` — `oc get application <name> -n openshift-gitops -o jsonpath='{.status.history}'` → format revision, deployedAt, source
2. Update `src/index.ts` to conditionally import and spread: `tool: { ...createCoreTools(oc), ...createGitOpsTools(oc) }`
3. Add system prompt enhancement: in `index.ts`, check if ArgoCD CRD exists via `oc get crd applications.argoproj.io` (catch = not installed). If installed, query app count + out-of-sync count and expose via a `chat.system.transform` hook injecting `<gitops-context>managed-by=argocd apps=N out-of-sync=M</gitops-context>`

**Tests:** 15-18 tests (4 tools x 3 paths: success/empty/error + 2 system prompt tests + 2 permission tests)
**Acceptance:** `ocp_gitops_apps` returns formatted ArgoCD application list. `ocp_gitops_sync` calls `ctx.ask()` before executing. System prompt includes `<gitops-context>` when ArgoCD is detected.

---

#### #23 — Enhancement: RHACS - Compliance Scanning

**Package:** `redhat/security/rhacs/`
**Files to create:** `src/compliance-tools.ts`, `test/compliance-tools.test.ts`
**Files to modify:** `src/index.ts`
**Depends on:** Nothing (independent enhancement)

**Implementation steps:**
1. Create `src/compliance-tools.ts` exporting `createComplianceTools(client: CentralClient): Record<string, ToolDefinition>` with 2 tools:
   - `rhacs_compliance_scan` — `GET /v2/compliance/scan/configurations` + `POST /v2/compliance/scan/configurations/{id}/run` → returns scan results by profile (CIS, NIST, PCI-DSS) with passing/failing controls count and failing control details (name, description, remediation)
   - `rhacs_compliance_status` — `GET /v2/compliance/profiles/summary` → returns per-profile summary: profile name, percentage passing, total controls, top 5 failing controls with remediation
2. Add API methods to `src/central-client.ts`: `getComplianceProfiles()`, `runComplianceScan(profileId)`, `getComplianceSummary()`
3. Update `src/index.ts`: spread `createComplianceTools(client)` into configured tools, add unconfigured stubs
4. Format output: group failing controls by severity, include remediation text

**Tests:** 12-14 tests (2 tools x success/empty/error + unconfigured stubs + profile filter)
**Acceptance:** `rhacs_compliance_scan` returns formatted compliance results with pass/fail counts. `rhacs_compliance_status` returns percentage passing per profile.

---

#### #24 — Enhancement: AAP Bridge - Playbook Linting

**Package:** `redhat/automation/aap-bridge/`
**Files to create:** `src/lint-tools.ts`, `test/lint-tools.test.ts`
**Files to modify:** `src/index.ts`
**Depends on:** Nothing (independent enhancement)

**Implementation steps:**
1. Create `src/lint-tools.ts` exporting `createLintTools($: PluginInput["$"]): Record<string, ToolDefinition>` with 1 tool:
   - `aap_lint_playbook` — runs `ansible-lint <filePath> --format json` via `$` shell, parses JSON output into structured violations: `{ rule, severity, description, filename, line, column, fixSuggestion }`. If `ansible-lint` is not installed, returns a descriptive message with install instructions.
2. Check for `ansible-lint` availability: `$ which ansible-lint` — if not found, return "ansible-lint not found. Install with: pip install ansible-lint"
3. Update `src/index.ts`: spread `createLintTools(input.$)` into the tool record (lint tools don't require AAP controller config — they run locally)
4. Parse `ansible-lint` JSON output format: `[{ "type": "issue", "rule": { "id": "...", "severity": "..." }, "message": "...", "filename": "...", "line": N }]`

**Tests:** 8-10 tests (lint success with violations, lint clean, ansible-lint not installed, invalid file path, permission error, JSON parse failure)
**Acceptance:** `aap_lint_playbook` with a bad playbook returns structured violations. Missing `ansible-lint` returns install instructions, not a crash.

---

#### #19 — Enhancement: Context Injection - Cost Context

**Package:** `redhat/openshift/context-injection/`
**Files to create:** `src/cost-context.ts`, `test/cost-context.test.ts`
**Files to modify:** `src/index.ts`
**Depends on:** #15 (console.redhat.com auth)

**Implementation steps:**
1. Create `src/cost-context.ts` exporting `queryCostContext(authClient: ConsoleAuthClient, clusterId: string, namespace?: string): Promise<CostContext | null>`:
   - Call `GET https://console.redhat.com/api/cost-management/v1/reports/openshift/costs/?filter[cluster]=${clusterId}&filter[time_scope_value]=-1&filter[time_scope_units]=month`
   - Parse response into `CostContext`: `{ namespace, monthlyEstimate, topResource, topResourceCost, currency }`
   - Return null on auth failure or API error (non-blocking — cost context is best-effort)
2. Update `src/index.ts`:
   - Add optional `consoleOfflineToken` to options schema
   - In `session.start`, if token configured, create `ConsoleAuthClient` and call `queryCostContext`
   - In `experimental.chat.system.transform`, append cost context block:
     ```
     <cost-context>namespace=my-app monthly-estimate=$847 top-resource=gpu-worker-0 ($412/mo)</cost-context>
     ```
3. Cost context is optional — if not configured or API fails, skip silently

**Tests:** 8-10 tests (cost context injected when configured, skipped when no token, API failure returns null, format output correctly, handles missing namespace)
**Acceptance:** System prompt includes `<cost-context>` when console token is configured and API returns data. No crash when token is missing or API fails.

---

#### #25 — Enhancement: Lightwell - Containerfile Scanning

**Package:** `redhat/security/lightwell/`
**Files to create:** `src/containerfile-scanner.ts`, `test/containerfile-scanner.test.ts`
**Files to modify:** `src/index.ts`
**Depends on:** #18 (Containerfile parser)

**Implementation steps:**
1. Create `src/containerfile-scanner.ts` exporting `createContainerfileScannerTool(lightwellClient: LightwellClient): ToolDefinition` that extends the existing `lightwell_check_deps` tool:
   - Accept a `containerfilePath` argument (in addition to existing `manifestPath`)
   - When `containerfilePath` is provided: read file content, call `parseContainerfile()` from shared, then `extractDependencies()` to get pip/maven/npm dependencies
   - Pass extracted dependencies through the existing Lightwell check logic
   - Return combined results: dependencies found in Containerfile + Lightwell patch availability per dependency
2. Update existing `lightwell_check_deps` tool args to accept optional `containerfilePath: z.string().optional()`
3. Reuse existing `LightwellClient` for dependency checks — no new API calls needed
4. Handle edge cases: Containerfile with no dependency-installing RUN instructions, malformed Containerfile

**Tests:** 10-12 tests (scan Containerfile with pip deps, with maven deps, with npm deps, no deps found, malformed Containerfile, mixed manifest + Containerfile scan)
**Acceptance:** `lightwell_check_deps` with `containerfilePath` pointing to a Containerfile containing `RUN pip install flask==2.3.0` returns Lightwell patch status for flask.

---

### Batch 2B (3 parallel items)

---

#### #22 — Enhancement: Cluster Ops - Insights/Advisor Integration

**Package:** `redhat/openshift/cluster-ops/`
**Files to create:** `src/insights-tools.ts`, `test/insights-tools.test.ts`
**Files to modify:** `src/index.ts`
**Depends on:** #15 (console.redhat.com auth), Refactor A (core-tools.ts extraction)

**Implementation steps:**
1. Create `src/insights-tools.ts` exporting `createInsightsTools(authClient: ConsoleAuthClient): Record<string, ToolDefinition>` with 2 tools:
   - `ocp_insights_recommendations` — `GET https://console.redhat.com/api/insights-results-aggregator/v2/cluster/{clusterId}/reports/` → returns active recommendations with `rule_id`, `description`, `risk` (1-4), `resolution`, `total_risk`, `created_at`
   - `ocp_insights_cves` — `GET https://console.redhat.com/api/vulnerability/v1/clusters/{clusterId}/cves` → returns CVEs with `synopsis`, `severity`, `public_date`, `advisories_list` (with fix info)
2. Add optional `consoleOfflineToken` and `clusterId` to cluster-ops options schema
3. Update `src/index.ts`: if console auth is configured, spread `createInsightsTools(authClient)` into the tool record. If not configured, spread unconfigured stubs.
4. Format recommendations by risk level (Critical=4, Important=3, Moderate=2, Low=1)

**Tests:** 12-14 tests (recommendations success/empty/error, CVEs success/empty/error, unconfigured stubs, risk level filtering)
**Acceptance:** `ocp_insights_recommendations` returns formatted recommendations sorted by risk. Unconfigured returns helpful message about console.redhat.com token.

---

#### #26 — Enhancement: Cluster Ops - Observability Shortcuts

**Package:** `redhat/openshift/cluster-ops/`
**Files to create:** `src/obs-shortcuts.ts`, `test/obs-shortcuts.test.ts`
**Files to modify:** `src/index.ts`
**Depends on:** #16 (PromQL client), Refactor A (core-tools.ts extraction)

**Implementation steps:**
1. Create `src/obs-shortcuts.ts` exporting `createObsShortcutTools(oc: OcClient, promql?: PromQLClient): Record<string, ToolDefinition>` with 3 tools:
   - `ocp_top_pods` — if `promql` is configured, query `topk(20, container_memory_working_set_bytes{namespace="${ns}"})` and `topk(20, rate(container_cpu_usage_seconds_total{namespace="${ns}"}[5m]))`; if not configured, fall back to `oc adm top pods -n ${ns}` via `oc.raw()`. Format as sorted table: pod, CPU cores, memory MB
   - `ocp_resource_usage` — query `kube_resourcequota` metrics via PromQL for namespace resource usage vs. requests vs. limits. If no PromQL, use `oc describe resourcequota -n ${ns}`. Return: requested/limit/used for CPU and memory
   - `ocp_error_rate` — if PromQL available, query `sum(rate(http_requests_total{namespace="${ns}",code=~"5.."}[5m])) by (service)`. If not, return "PromQL not configured — install Observability plugin for error rate queries". Return: service name, current 5xx rate, 1h trend (increasing/decreasing/stable)
2. PromQL client is optional — tools degrade gracefully to `oc adm top` fallbacks when not configured
3. Update `src/index.ts`: add optional `prometheusUrl` to options schema. If configured, create PromQL client and pass to obs shortcut tools. If not, pass `undefined`.

**Tests:** 14-16 tests (3 tools x 2 paths: PromQL configured / oc fallback, x 2: success/error + graceful degradation tests + format tests)
**Acceptance:** `ocp_top_pods` returns sorted pod resource usage. Works with PromQL configured OR falls back to `oc adm top pods`. `ocp_error_rate` without PromQL returns helpful message, not crash.

---

#### #21 — Enhancement: RHOAI Model Serving - RHDP Sandbox Integration

**Package:** `redhat/rhoai/model-serving/`
**Files to create:** `src/sandbox.ts`, `test/sandbox.test.ts`
**Files to modify:** `src/index.ts`
**Depends on:** #15 (console.redhat.com auth)

**Implementation steps:**
1. Create `src/sandbox.ts` exporting `createSandboxTools(authClient: ConsoleAuthClient): Record<string, ToolDefinition>` with 2 tools:
   - `rhoai_sandbox_status` — `GET https://api.sandbox.devshift.net/api/v1/signup` with bearer token → returns signup state (ready/pending/not-registered), cluster URL, namespace, console URL, expiry
   - `rhoai_sandbox_provision` — `POST https://api.sandbox.devshift.net/api/v1/signup` (with `ctx.ask()` permission prompt) → initiates sandbox provisioning, returns signup status. Poll with `rhoai_sandbox_status` until ready.
2. Update `src/index.ts`: add optional `consoleOfflineToken` to options schema. If configured and no `ocpUrl` is set (i.e., no cluster configured), add sandbox tools alongside model tools with a system prompt note: "No cluster configured. Developer Sandbox available — use rhoai_sandbox_provision to get a free RHOAI environment."
3. When sandbox is ready, inject its cluster URL so model-serving tools can discover models there

**Tests:** 10-12 tests (sandbox status ready/pending/not-registered, provision success, provision requires permission, error handling, sandbox URL injection into model tools)
**Acceptance:** `rhoai_sandbox_status` returns sandbox state. `rhoai_sandbox_provision` calls `ctx.ask()` before provisioning. When no cluster is configured, system prompt mentions sandbox availability.

**Risk:** Developer Sandbox API (`api.sandbox.devshift.net`) is internal Red Hat infrastructure. Endpoint paths and auth may differ from documented patterns. **Mitigation:** Implement against the documented signup flow. If API differs, the tools return descriptive error messages rather than crashing.

---

### Phase 2 Verification Gate

```bash
bun test --recursive                    # All tests pass (~336 + ~75 new = ~411)
bun run typecheck                       # All packages typecheck clean
# Verify no existing tests broke:
cd redhat/openshift/cluster-ops && bun test   # Original 6 tools still work
cd redhat/security/rhacs && bun test          # Original 5 tools still work
cd redhat/automation/aap-bridge && bun test   # Original 6 tools still work
```

**Expected test count after Phase 2:** ~411 tests

---

## Phase 3: New Plugins — Core

**Goal:** Build 12 new plugin packages. Each is a standalone package following the established plugin patterns.
**Parallelism:** 3 batches. Batch 3A and 3B items have no inter-dependencies. Batch 3C items depend on Batch 3A outputs (#30, #34).
**Estimated scope:** ~3,500 lines code + ~2,200 lines tests, 48-60 files (12 new packages, each with 4-5 files)

### Batch 3A (5 parallel items)

---

#### #28 — Plugin: Red Hat Developer Content Search

**Package:** NEW `redhat/reference/dev-content/` (tinycode-plugin-rh-dev-content)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `test/index.test.ts`
**Depends on:** #17 (local search utility)

**Implementation steps:**
1. Scaffold package: `package.json` with name `tinycode-plugin-rh-dev-content`, deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ contentPath: z.string().describe("Path to Red Hat developer content directory (e.g., ~/offline-repo/RH_developers/txt/)"), learningPathsPath: z.string().optional().describe("Path to learning paths directory") }`
3. Implement 4 tools using `createLocalSearchIndex` from shared:
   - `rh_dev_search` — search indexed articles by keyword, return title, file path, snippet, content type (article/cheatsheet/learning-path). Args: `{ query: string, type?: "article" | "cheatsheet" | "learning-path", limit?: number }`
   - `rh_dev_article` — read full article content by file path via `index.getContent()`. Args: `{ path: string }`
   - `rh_dev_cheatsheet` — search with `type: "cheatsheet"` filter, return matching cheat sheets. Args: `{ topic: string }`
   - `rh_dev_learning_path` — search with `type: "learning-path"` filter, return ordered module list. Args: `{ topic: string }`. (Merged from original Plugin 19 — learning path features are absorbed here.)
4. Add `experimental.chat.system.transform` hook: detect project framework from working directory (check for `pom.xml` → Java/Quarkus, `package.json` → Node.js, `Containerfile` → containers, `requirements.txt` → Python), inject `<rh-dev-context>Relevant cheat sheets: [topics]. Learning paths: [paths]</rh-dev-context>`
5. Build index lazily on first search call, cache for session lifetime

**Tests:** 18-22 tests (4 tools x success/empty/error + system prompt detection tests for 4 frameworks + unconfigured/missing-path tests)
**Acceptance:** `rh_dev_search({ query: "quarkus" })` returns search results with titles and snippets. `rh_dev_cheatsheet({ topic: "podman" })` returns cheat sheet content. System prompt injects framework-relevant content hints. Missing `contentPath` returns descriptive error.

---

#### #29 — Plugin: Containerfile/Image Mode Linter

**Package:** NEW `redhat/security/container-linter/` (tinycode-plugin-container-linter)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `src/lint-rules.ts`, `test/index.test.ts`
**Depends on:** #18 (Containerfile parser)

**Implementation steps:**
1. Scaffold package with deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ autoLint?: z.boolean().default(false).describe("Auto-lint on Containerfile edit") }`
3. Create `src/lint-rules.ts` with lint rule definitions, each returning `LintWarning { rule, severity, line, message, suggestion }`:
   - `non-ubi-base`: FROM image is not `registry.access.redhat.com/ubi*` or `registry.redhat.io/ubi*` → suggest UBI equivalent
   - `latest-tag`: FROM uses `:latest` tag → suggest pinned version
   - `root-user`: `USER root` without subsequent `USER <non-root>` → suggest adding non-root USER
   - `missing-labels`: no `LABEL` instructions for `name`, `version`, `summary` → suggest OCP-required labels
   - `run-layer-chaining`: 3+ consecutive `RUN` instructions → suggest combining with `&&`
   - `hardcoded-secret`: ENV or ARG with names containing `password`, `secret`, `token`, `key` → warn about build-time secrets
   - `missing-user-directive`: no `USER` instruction at all → suggest adding non-root user
4. Implement 3 tools:
   - `container_lint` — parse Containerfile, run all lint rules, return warnings grouped by severity. Args: `{ filePath: string }`
   - `bootc_validate` — check if base image is bootc-compatible (`registry.redhat.io/rhel9/rhel-bootc:*`), verify required bootc labels (e.g., `bootc.diskimage-builder`), check for systemd-related files. Args: `{ filePath: string }`
   - `container_base_suggest` — given a use case description, suggest UBI base image. Static lookup table: Java → `ubi9/openjdk-21-runtime`, Python → `ubi9/python-312`, Node → `ubi9/nodejs-22`, minimal → `ubi9/ubi-minimal`. Args: `{ useCase: string }`
5. `tool.execute.after` hook (when `autoLint` enabled): if the edited file matches `Containerfile`, `Dockerfile`, or `*.containerfile`, run `container_lint` and append warnings to tool output

**Tests:** 20-25 tests (7 lint rules x 2 pass/fail + 3 tools x success/empty/error + auto-lint hook test + bootc validation tests)
**Acceptance:** `container_lint` on a file with `FROM ubuntu:latest` returns warnings for `non-ubi-base` and `latest-tag`. `bootc_validate` on a non-bootc image returns validation failures. `container_base_suggest({ useCase: "Java 21 app" })` returns `registry.access.redhat.com/ubi9/openjdk-21-runtime:1.20`.

---

#### #30 — Plugin: Observability - Metrics and Alerts (Prometheus/AlertManager)

**Package:** NEW `redhat/openshift/obs-metrics/` (tinycode-plugin-obs-metrics)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `test/index.test.ts`
**Depends on:** #16 (PromQL client)

**Implementation steps:**
1. Scaffold package with deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ prometheusUrl: z.string().url(), tokenFn: from OCP OAuth or manual token, namespace?: z.string() }`
3. Implement 3 tools using `createPromQLClient` from shared:
   - `obs_promql` — run arbitrary PromQL query. Args: `{ query: string, time?: string, start?: string, end?: string, step?: string }`. If `start`+`end`+`step` provided, use range query; otherwise instant query. Format results as table for vector, time-series for matrix.
   - `obs_alerts` — call `promqlClient.alerts()`, format as list: `[SEVERITY] alert-name | namespace | since | description`. Args: `{ severity?: "critical" | "warning" | "info", namespace?: string }`
   - `obs_alert_silence` — call `promqlClient.silenceAlert()` with permission prompt via `ctx.ask()`. Args: `{ alertName: string, duration: string, comment: string }`. Validate duration format (e.g., "1h", "30m", "2h30m").
4. Add `experimental.chat.system.transform` hook: on session start, query alerts and inject `<observability-context>firing-alerts: N critical (...), M warning (...)</observability-context>`
5. Unconfigured tools pattern: if `prometheusUrl` not set, return "Observability plugin not configured. Set prometheusUrl in plugin options."

**Tests:** 16-20 tests (3 tools x success/empty/error + unconfigured + system prompt with/without alerts + instant vs range query + duration validation + permission prompt)
**Acceptance:** `obs_promql({ query: "up" })` returns formatted PromQL results. `obs_alerts()` returns formatted alert list. `obs_alert_silence` calls `ctx.ask()` before silencing. System prompt injects firing alert summary.

---

#### #33 — Plugin: RHOAI MCP Bridge

**Package:** NEW `redhat/rhoai/mcp-bridge/` (tinycode-plugin-rhoai-mcp-bridge)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `src/mcp-client.ts`, `test/index.test.ts`
**Depends on:** Nothing (independent, but benefits from OCP OAuth for token)

**Implementation steps:**
1. Scaffold package with deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ mcpServerUrl: z.string().url().describe("URL of the RHOAI MCP server endpoint"), oauthToken?: z.string() }`
3. Create `src/mcp-client.ts` implementing a lightweight MCP client:
   - `listTools(): Promise<McpToolDef[]>` — calls MCP `tools/list` method, returns tool name + description + input schema
   - `callTool(name: string, args: Record<string, unknown>): Promise<string>` — calls MCP `tools/call`, returns result content as string
   - Transport: HTTP+SSE or Streamable HTTP (match whatever RHOAI ships — start with HTTP POST to MCP endpoint)
4. Implement 2 meta-tools:
   - `rhoai_mcp_list` — lists available tools from the RHOAI MCP server. Args: none
   - `rhoai_mcp_call` — calls any tool on the RHOAI MCP server by name. Args: `{ tool: string, args: string (JSON) }`. Parse args JSON, forward to MCP server, return result.
5. Alternative approach (if tinycode supports dynamic tool registration): register each RHOAI MCP tool as a native tinycode tool dynamically at plugin load time

**Tests:** 10-12 tests (list tools success/error, call tool success/error, unconfigured, invalid tool name, invalid JSON args, token injection)
**Acceptance:** `rhoai_mcp_list` returns RHOAI MCP server's available tools. `rhoai_mcp_call({ tool: "recommend_model", args: '{"task":"text-generation"}' })` forwards to MCP server and returns result.

**Risk:** RHOAI MCP server is Developer Preview in RHOAI 3.5. The MCP transport protocol (HTTP vs stdio vs SSE) and available tools may change before GA. **Mitigation:** Isolate transport logic in `mcp-client.ts`. The 2 meta-tools work regardless of what specific tools the MCP server exposes.

---

#### #34 — Plugin: MLFlow Experiment and Model Registry Tools

**Package:** NEW `redhat/rhoai/mlflow-tools/` (tinycode-plugin-mlflow-tools)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `src/mlflow-read-client.ts`, `test/index.test.ts`
**Depends on:** Refactor B (mlflow-client.ts migration to _shared)

**Implementation steps:**
1. Scaffold package with deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ mlflowUrl: z.string().url() }`
3. Create `src/mlflow-read-client.ts` extending the shared `MlflowClient` with read-side operations (the shared client already has write operations for experiment tracker):
   - `listExperiments(): Promise<Experiment[]>` — `GET /api/2.0/mlflow/experiments/search`
   - `listRuns(experimentId: string, filter?: string): Promise<Run[]>` — `GET /api/2.0/mlflow/runs/search` with filter string
   - `compareRuns(runIds: string[]): Promise<RunComparison>` — fetch each run, build side-by-side comparison of params + metrics
   - `listArtifacts(runId: string, path?: string): Promise<Artifact[]>` — `GET /api/2.0/mlflow/artifacts/list`
   - `listRegisteredModels(): Promise<RegisteredModel[]>` — `GET /api/2.0/mlflow/registered-models/search`
   - `getModelVersion(name: string, version: string): Promise<ModelVersion>` — `GET /api/2.0/mlflow/model-versions/get`
   - `transitionModelStage(name: string, version: string, stage: string): Promise<void>` — `POST /api/2.0/mlflow/model-versions/transition-stage` (with permission prompt)
4. Implement 8 tools:
   - `mlflow_experiments` — list experiments with run count and last activity
   - `mlflow_runs` — list runs for an experiment with status, metrics, params
   - `mlflow_compare` — compare 2-5 runs side-by-side (diff table of params + metrics)
   - `mlflow_artifacts` — list artifacts for a run
   - `mlflow_model_registry` — list registered models with latest version and stage
   - `mlflow_model_version` — get model version details
   - `mlflow_promote` — transition model stage (with `ctx.ask()`) — args: `{ name, version, stage }`
   - `mlflow_log_metric` — log metric to a run (delegates to shared `mlflowClient.logMetric`)

**Tests:** 22-28 tests (8 tools x success/error + unconfigured + comparison formatting + promote permission + stage validation)
**Acceptance:** `mlflow_experiments` returns formatted experiment list. `mlflow_compare` with 2+ run IDs returns side-by-side metrics table. `mlflow_promote` calls `ctx.ask()` before stage transition.

---

### Batch 3B (4 parallel items)

---

#### #38 — Plugin: Ecosystem Catalog Search

**Package:** NEW `redhat/reference/ecosystem-catalog/` (tinycode-plugin-ecosystem-catalog)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `test/index.test.ts`
**Depends on:** #17 (local search utility)

**Implementation steps:**
1. Scaffold package with deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ catalogPath: z.string().describe("Path to ecosystem catalog data directory (e.g., ~/offline-repo/RH_ecosystem/)") }`
3. Implement 3 tools using `createLocalSearchIndex`:
   - `ecosystem_search` — search catalog by keyword, category (storage/networking/security/AI-ML), or platform (OCP/RHEL/Ansible). Args: `{ query: string, category?: string, platform?: string, limit?: number }`. Returns: partner name, product, certification level, operator name
   - `ecosystem_operator` — get certified operator details: supported OCP versions, install method, certified config. Args: `{ operatorName: string }`. Search index for operator name match, read full entry via `getContent()`
   - `ecosystem_hardware` — search certified hardware by vendor or model. Args: `{ query: string }`. Filter to hardware entries. Returns: vendor, model, certification status, supported RHEL/OCP versions
4. Index the JSON/TXT files in the catalog directory. Parse partner name, product name, certification level from file content
5. Unconfigured: if `catalogPath` not set or directory missing, return descriptive message

**Tests:** 14-16 tests (3 tools x success/empty/error + category filter + platform filter + missing catalog path + operator details lookup)
**Acceptance:** `ecosystem_search({ query: "NetApp storage" })` returns certified partner entries with operator names. `ecosystem_operator({ operatorName: "trident-csi" })` returns detailed operator information with supported OCP versions.

---

#### #35 — Plugin: RHOAI Data Science Pipelines

**Package:** NEW `redhat/rhoai/pipelines/` (tinycode-plugin-rhoai-pipelines)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `src/pipeline-client.ts`, `test/index.test.ts`
**Depends on:** Nothing (independent new plugin)

**Implementation steps:**
1. Scaffold package with deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ ocpUrl: z.string().url(), namespace: z.string(), oauthToken?: z.string() }`
3. Create `src/pipeline-client.ts` using `createApiClient` from shared. RHOAI Data Science Pipelines (Kubeflow) API:
   - `listPipelines(namespace: string): Promise<Pipeline[]>` — `GET /apis/v2beta1/pipelines`
   - `listRuns(pipelineId?: string): Promise<PipelineRun[]>` — `GET /apis/v2beta1/runs`
   - `getRunStatus(runId: string): Promise<PipelineRunDetail>` — `GET /apis/v2beta1/runs/{runId}` with task-level status
   - `createRun(pipelineId: string, params: Record<string, string>): Promise<string>` — `POST /apis/v2beta1/runs`
4. Implement 4 tools:
   - `rhoai_pipeline_list` — list pipelines with name, last run, schedule status. Args: `{ namespace?: string }`
   - `rhoai_pipeline_run` — trigger pipeline run with `ctx.ask()`. Args: `{ pipelineId: string, params?: string (JSON) }`
   - `rhoai_pipeline_status` — check run status: per-task completion, duration, logs reference. Args: `{ runId: string }`
   - `rhoai_pipeline_create` — create pipeline from YAML with `ctx.ask()`. Args: `{ yaml: string }` — `POST /apis/v2beta1/pipelines`
5. Format pipeline status as step-by-step task list with status icons

**Tests:** 16-20 tests (4 tools x success/error + unconfigured + permission prompts for run/create + params JSON parsing + task status formatting)
**Acceptance:** `rhoai_pipeline_list` returns formatted pipeline list. `rhoai_pipeline_run` calls `ctx.ask()` before triggering. `rhoai_pipeline_status` shows per-task completion status.

---

#### #36 — Plugin: RHOAI Eval, TrustyAI, and Workbenches

**Package:** NEW `redhat/rhoai/eval-trustyai/` (tinycode-plugin-rhoai-eval-trustyai)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `src/eval-client.ts`, `src/trustyai-client.ts`, `test/index.test.ts`
**Depends on:** Nothing (independent new plugin)

**Implementation steps:**
1. Scaffold package with deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ ocpUrl: z.string().url(), namespace: z.string(), oauthToken?: z.string() }`
3. Create `src/eval-client.ts` for EvalHub API calls:
   - `runEval(modelName: string, provider: string, config: EvalConfig): Promise<string>` — `POST /api/v1/evaluations`
   - `getEvalStatus(evalId: string): Promise<EvalResult>` — `GET /api/v1/evaluations/{evalId}`
   - `compareEvals(evalIds: string[]): Promise<EvalComparison>` — fetch multiple, build comparison
4. Create `src/trustyai-client.ts` for TrustyAI service API calls:
   - `getMetrics(modelName: string): Promise<TrustyMetrics>` — drift score, feature distributions, bias metrics
   - `getAlerts(): Promise<TrustyAlert[]>` — active drift/bias alerts
5. Implement 6 tools:
   - `rhoai_eval_run` — run evaluation with `ctx.ask()`. Args: `{ model: string, provider: "lm-eval" | "ragas" | "garak" | "guidellm", config?: string (JSON) }`
   - `rhoai_eval_status` — check eval status and results. Args: `{ evalId: string }`
   - `rhoai_eval_compare` — compare eval results across models. Args: `{ evalIds: string[] }`
   - `rhoai_trusty_metrics` — get TrustyAI metrics. Args: `{ model: string }`
   - `rhoai_trusty_alerts` — list active TrustyAI alerts. Args: none
   - `rhoai_workbench_list` — `oc get notebooks.kubeflow.org -n ${ns} -o json` → list workbenches with status, image, GPU. Args: `{ namespace?: string }`
6. Group tools by feature in output formatting

**Tests:** 18-22 tests (6 tools x success/error + unconfigured + permission prompt for eval_run + comparison formatting + empty alerts)
**Acceptance:** `rhoai_eval_run` calls `ctx.ask()` before starting evaluation. `rhoai_trusty_metrics` returns formatted drift/bias metrics. `rhoai_workbench_list` returns notebook environments.

**Risk:** EvalHub and TrustyAI APIs are newer components in RHOAI 3.5. API schemas may not be fully stable. **Mitigation:** Build read-only tools first (eval_status, trusty_metrics, workbench_list). Write tools (eval_run) come second. Use generic error handling to surface API response errors clearly.

---

#### #32 — Plugin: RHACM Multi-Cluster Management

**Package:** NEW `redhat/fleet/rhacm/` (tinycode-plugin-rhacm)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `src/acm-client.ts`, `test/index.test.ts`
**Depends on:** #16 (PromQL client for `acm_observability`)

**Implementation steps:**
1. Scaffold package under `redhat/fleet/rhacm/` with deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ hubUrl?: z.string().url(), oauthToken?: z.string() }`. If not set, try auto-detect via `oc` (check if ACM CRDs exist)
3. Create `src/acm-client.ts` using `createOcClient` from shared (ACM resources are Kubernetes CRDs):
   - `listClusters(): Promise<ManagedCluster[]>` — `oc get managedclusters -o json` → parse name, status, version, provider, labels
   - `getClusterDetail(name: string): Promise<ClusterDetail>` — `oc get managedcluster <name> -o json` + `oc get managedclusteraddons -n <name> -o json`
   - `listPolicies(): Promise<Policy[]>` — `oc get policies.policy.open-cluster-management.io --all-namespaces -o json`
   - `listViolations(): Promise<Violation[]>` — filter policies where `status.compliant == "NonCompliant"`
   - `listApplications(): Promise<Application[]>` — `oc get applications.argoproj.io --all-namespaces -o json` (ACM uses ArgoCD)
4. Implement 7 tools:
   - `acm_clusters` — list all managed clusters with status, version, provider. Args: `{ status?: "Ready" | "NotReady" }`
   - `acm_cluster_detail` — detailed info for one cluster. Args: `{ name: string }`
   - `acm_policies` — list governance policies with compliance. Args: `{ namespace?: string }`
   - `acm_violations` — active policy violations across fleet. Args: `{ cluster?: string, severity?: string }`
   - `acm_applications` — list ACM-managed applications. Args: `{ cluster?: string }`
   - `acm_app_deploy` — deploy ApplicationSet with `ctx.ask()`. Args: `{ yaml: string }`
   - `acm_observability` — run PromQL query via Thanos (ACM observability). Uses `createPromQLClient` pointed at Thanos route. Args: same as `obs_promql`
5. Add `experimental.chat.system.transform` hook: inject `<acm-context>` with cluster count, non-compliant count, degraded apps

**Tests:** 22-26 tests (7 tools x success/error + unconfigured + system prompt + ACM not installed + cluster filter + violation grouping)
**Acceptance:** `acm_clusters` returns formatted managed cluster list. `acm_violations` shows policy violations grouped by cluster. `acm_observability` runs federated PromQL queries via Thanos. System prompt includes fleet summary.

**Risk:** RHACM API surface is large. Scope creep risk is high. **Mitigation:** Focus on read-only tools first (clusters, policies, violations). `acm_app_deploy` is the only write tool and requires permission prompt. Skip ACM search/placement tools — they add complexity without proportional value.

---

### Batch 3C (3 parallel items — depends on Batch 3A)

**Note:** Start Batch 3C only after Batch 3A completes. Items #31 and #27 have hard dependencies on #30 and #34 respectively. #37 has no hard dependency but is logically grouped here to control batch sizes.

---

#### #31 — Plugin: Observability - Logging and Tracing (Loki/Tempo/Network)

**Package:** NEW `redhat/openshift/obs-logging/` (tinycode-plugin-obs-logging)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `src/loki-client.ts`, `src/tempo-client.ts`, `test/index.test.ts`
**Depends on:** #30 (Obs Metrics — reuses patterns and PromQL client setup)

**Implementation steps:**
1. Scaffold package with deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ lokiUrl?: z.string().url(), tempoUrl?: z.string().url(), oauthToken?: z.string() }`
3. Create `src/loki-client.ts` using `createApiClient`:
   - `query(logql: string, limit?: number, start?: string, end?: string): Promise<LogEntry[]>` — `GET /loki/api/v1/query_range?query=...`
   - `labels(): Promise<string[]>` — `GET /loki/api/v1/labels`
4. Create `src/tempo-client.ts` using `createApiClient`:
   - `searchTraces(service: string, operation?: string, minDuration?: string): Promise<TraceSummary[]>` — `GET /api/search?...`
   - `getTrace(traceId: string): Promise<TraceDetail>` — `GET /api/traces/{traceId}`
5. Implement 5 tools:
   - `obs_logs` — run LogQL query against Loki. Args: `{ query?: string, namespace?: string, pod?: string, severity?: string, since?: string, limit?: number }`. If no `query`, build LogQL from namespace/pod/severity filters.
   - `obs_traces` — search traces by service, operation, or duration. Args: `{ service: string, operation?: string, minDuration?: string, limit?: number }`
   - `obs_trace_detail` — get full span tree for a trace ID. Args: `{ traceId: string }`. Format as indented span tree with timing.
   - `obs_network_flows` — `oc get flowcollectors.flows.netobserv.io -o json` + query Network Observability API for flows. Args: `{ namespace?: string, srcPod?: string, destPod?: string, since?: string }`
   - `obs_dashboards` — `oc get configmaps -n openshift-config-managed -l grafana_dashboard=1 -o json` → list available dashboards. Args: none

**Tests:** 18-22 tests (5 tools x success/empty/error + LogQL builder from filters + trace tree formatting + unconfigured Loki/Tempo independently)
**Acceptance:** `obs_logs({ namespace: "my-app", severity: "error" })` returns log lines. `obs_traces({ service: "api" })` returns trace summaries. `obs_trace_detail` returns formatted span tree.

---

#### #27 — Enhancement: Experiment Tracker - Read-Side Integration

**Package:** `redhat/rhoai/experiment-tracker/`
**Files to create:** `src/read-side.ts`, `test/read-side.test.ts`
**Files to modify:** `src/index.ts`
**Depends on:** #34 (MLFlow Tools — provides the MLflow read client that this enhancement annotates)

**Implementation steps:**
1. Create `src/read-side.ts` exporting:
   - `createReadSideHook(mlflowClient: MlflowReadClient): Hooks["tool.execute.after"]` — when `mlflow_compare` or `mlflow_runs` tools execute (detected by tool name in event), enrich the output with tinycode session metadata: session duration, model ID, tool call count from the current/matching run
   - `createSessionContextHook(mlflowClient: MlflowReadClient, experimentName: string): Hooks["session.start"]` — on session start, query MLflow for the last completed run in the experiment, inject `<last-session>model=granite-3.3-8b tasks=N accuracy=M% tool-calls=K</last-session>` into system prompt
2. Update `src/index.ts`:
   - Add optional `mlflowToolsAvailable: z.boolean().optional()` to options schema
   - If MLflow URL is configured, create read client and register both hooks
   - `session.start` hook now also queries last session and stores result for system prompt injection
   - `experimental.chat.system.transform` hook appends last-session context block
3. The read-side hooks are additive — existing write-side tracking (run creation, metric logging) continues unchanged

**Tests:** 10-12 tests (last-session injection with/without prior runs, enrichment of mlflow_compare output, no crash when MLflow unreachable, session context format)
**Acceptance:** On session start, system prompt includes `<last-session>` block with last run's metrics. MLflow query results are enriched with session metadata when available.

---

#### #37 — Plugin: Red Hat API Catalog Integration

**Package:** NEW `redhat/reference/api-catalog/` (tinycode-plugin-rh-api-catalog)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `src/catalog-client.ts`, `test/index.test.ts`
**Depends on:** #15 (console.redhat.com auth for live spec fetching)

**Implementation steps:**
1. Scaffold package with deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ consoleOfflineToken?: z.string(), catalogPath?: z.string().describe("Optional local path to cached API specs") }`
3. Create `src/catalog-client.ts`:
   - Static catalog: hardcode the 50 console.redhat.com API entries (name, description, version, base path) as a typed constant array. This is stable data that changes infrequently.
   - `fetchSpec(apiName: string, token: string): Promise<string>` — `GET https://console.redhat.com/api/${apiName}/v1/openapi.json` or fetch from local cache at `catalogPath`
4. Implement 3 tools:
   - `rh_api_list` — list all 50 APIs with name, description, version. Args: `{ search?: string }`. Filter by keyword match on name/description. No auth needed (static data).
   - `rh_api_spec` — fetch the OpenAPI spec for a specific API. Args: `{ api: string }`. Try local cache first, then live fetch with auth. Return spec as JSON string (may be large — consider returning summary + key endpoints).
   - `rh_api_endpoints` — list endpoints for an API without full spec. Args: `{ api: string, search?: string }`. Parse spec, extract paths with method, description, required params. Lighter than full spec.
5. Unconfigured: `rh_api_list` always works (static data). `rh_api_spec` and `rh_api_endpoints` work from cache or require auth for live fetch.

**Tests:** 14-16 tests (3 tools x success/empty/error + static list always works + cached vs live spec + large spec truncation + search filtering)
**Acceptance:** `rh_api_list()` returns all 50 APIs. `rh_api_endpoints({ api: "cost-management" })` returns endpoint list with paths and methods. Works offline from cache, works online with auth.

---

### Phase 3 Verification Gate

```bash
bun test --recursive                    # All tests pass (~411 + ~190 new = ~601)
bun run typecheck                       # All packages typecheck clean (now 26+ packages)
# Verify new packages are discoverable:
ls redhat/reference/     # dev-content/, ecosystem-catalog/, api-catalog/
ls redhat/fleet/         # rhacm/
ls redhat/openshift/     # obs-metrics/, obs-logging/ (alongside existing)
ls redhat/rhoai/         # mcp-bridge/, mlflow-tools/, pipelines/, eval-trustyai/ (alongside existing)
ls redhat/security/      # container-linter/ (alongside existing)
```

**Expected test count after Phase 3:** ~601 tests

---

## Phase 4: Final Delivery

**Goal:** Build the last new plugin, run full integration verification, and update documentation.
**Estimated scope:** ~250 lines code + ~150 lines tests (plugin) + ~200 lines docs

### Batch 4A (2 parallel items)

---

#### #39 — Plugin: RHDP Demo Environment Provisioner

**Package:** NEW `redhat/reference/rhdp-provisioner/` (tinycode-plugin-rhdp-provisioner)
**Files to create:** `package.json`, `tsconfig.json`, `src/index.ts`, `src/rhdp-client.ts`, `test/index.test.ts`
**Depends on:** #15 (console.redhat.com auth)

**Implementation steps:**
1. Scaffold package with deps on `tinycode-plugin`, `tinycode-plugin-redhat-shared`, `zod`
2. Options schema: `{ consoleOfflineToken: z.string(), rhdpApiUrl?: z.string().url().default("https://demo.redhat.com/api/v1") }`
3. Create `src/rhdp-client.ts` using `createApiClient`:
   - `searchCatalog(query: string, category?: string): Promise<CatalogItem[]>` — search demo catalog
   - `provision(catalogItemId: string): Promise<ProvisionStatus>` — request demo environment
   - `getStatus(orderId: string): Promise<ProvisionStatus>` — check provisioning status
   - `listActive(): Promise<ActiveEnvironment[]>` — list running environments
4. Implement 4 tools:
   - `rhdp_search` — search demo catalog. Args: `{ query: string, category?: "workshop" | "demo" | "lab" | "open-environment" }`
   - `rhdp_provision` — request environment with `ctx.ask()`. Args: `{ catalogItemId: string }`
   - `rhdp_status` — check provisioning status. Args: `{ orderId: string }`
   - `rhdp_list_active` — list active environments. Args: none

**Tests:** 14-16 tests (4 tools x success/error + unconfigured + permission prompt + catalog search filtering + status transitions)
**Acceptance:** `rhdp_search({ query: "ansible automation" })` returns catalog items. `rhdp_provision` calls `ctx.ask()`. `rhdp_status` returns provisioning state with connection details when ready.

**Risk:** RHDP API access may require Red Hat internal credentials or partner access. API structure is not publicly documented. **Mitigation:** Build against assumed REST patterns (search, provision, status). If API differs, the client can be adapted without changing tool interfaces.

---

#### Documentation: README.md Update

**File to modify:** `README.md`

**Implementation steps:**
1. Add all 12 new plugins to the Plugins section, organized by the updated category structure:
   - OpenShift section: add obs-metrics, obs-logging
   - Security section: add container-linter
   - RHOAI section: add mcp-bridge, mlflow-tools, pipelines, eval-trustyai
   - NEW Reference section: add dev-content, ecosystem-catalog, api-catalog
   - NEW Fleet section: add rhacm
   - NEW Reference section: add rhdp-provisioner
2. List all new tools per plugin (follow existing format)
3. Add enhancement notes to existing plugin entries (GitOps, Insights, Compliance, Linting, Containerfile, Cost, Sandbox, Obs Shortcuts, Read-Side)
4. Update Suggested Bundles with new plugin combinations:
   - AI/ML Engineer bundle: add mlflow-tools, pipelines, eval-trustyai, mcp-bridge
   - Platform/SRE bundle: add obs-metrics, obs-logging
   - Security bundle: add container-linter
   - NEW Fleet Manager bundle: rhacm + obs-metrics + ocp-cluster-ops
   - NEW Developer bundle: dev-content + ecosystem-catalog + api-catalog
5. Update Development section: test count, package count
6. Update Project Structure tree

**Tests:** 0 (documentation only)
**Acceptance:** README lists all 25 plugins with correct tool names. Suggested bundles are updated. Project structure tree matches filesystem.

---

### Phase 4 Verification Gate (Final)

```bash
# Full test suite
bun test --recursive                    # All tests pass (~615+)
bun run typecheck                       # All 26 packages typecheck clean

# Package count verification
find redhat -name "package.json" -not -path "*/node_modules/*" | wc -l   # Should be 26 (1 shared + 13 original + 12 new)

# Verify no TypeScript errors
bun run typecheck 2>&1 | tail -1       # Should show "0 errors"

# Spot-check plugin loading (each plugin should export a valid PluginModule)
for dir in redhat/reference/*/  redhat/fleet/*/  redhat/openshift/obs-*/  redhat/security/container-linter/  redhat/rhoai/mcp-bridge/  redhat/rhoai/mlflow-tools/  redhat/rhoai/pipelines/  redhat/rhoai/eval-trustyai/; do
  echo "Checking $dir..."
  bun -e "const m = require('./${dir}src/index.ts'); console.log(typeof m.default.server)"
done
```

**Final expected test count:** ~615 tests across 26 packages

---

## Summary

| Phase | Items | New Tests | Cumulative Tests | Estimated LOC |
|-------|-------|-----------|-----------------|---------------|
| 1: Foundation | 4 shared modules + 2 refactors | ~40 | ~336 | ~1,300 |
| 2: Enhancements | 8 plugin enhancements (2 batches) | ~75 | ~411 | ~2,300 |
| 3: New Plugins | 12 new plugins (3 batches) | ~190 | ~601 | ~5,700 |
| 4: Final | 1 plugin + docs | ~16 | ~617 | ~450 |
| **Total** | **25 issues + 2 refactors** | **~321** | **~617** | **~9,750** |

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| console.redhat.com SSO token exchange flow is more complex than assumed | Blocks #19, #22, #21, #39 | Medium | Spike in Phase 1, build interface first, validate against real token |
| RHOAI MCP server transport changes before GA | Breaks #33 | Medium | Isolate transport in mcp-client.ts, use meta-tool pattern that adapts |
| EvalHub/TrustyAI APIs not stable | Breaks #36 tools | Medium | Build read-only first, generic error surfacing |
| RHDP API requires internal-only access | Blocks #39 | High | Build against assumed patterns, degrade gracefully |
| Developer Sandbox API differs from documented patterns | Breaks #21 sandbox provisioning | Medium | Descriptive errors, manual fallback instructions |
| ACM scope creep (7+ CRDs, 20+ API surfaces) | Phase 3 delay | Medium | Cap at 7 tools, read-only first, skip placement APIs |
| LogQL/Tempo auth models differ from Prometheus | Complicates #31 | Low | Each client handles auth independently |

## New Directory Structure (After v2)

```
redhat/
  _shared/                          # +4 new modules (console-auth, promql, local-search, containerfile-parser, mlflow)
  openshift/
    oauth/                          # unchanged
    context-injection/              # +cost-context.ts
    cluster-ops/                    # +core-tools.ts, +gitops-tools.ts, +insights-tools.ts, +obs-shortcuts.ts
    obs-metrics/                    # NEW (#30)
    obs-logging/                    # NEW (#31)
  security/
    rhacs/                          # +compliance-tools.ts
    lightwell/                      # +containerfile-scanner.ts
    container-linter/               # NEW (#29)
  devex/
    tekton/                         # unchanged
    quay/                           # unchanged
    rhdh/                           # unchanged
  automation/
    aap-bridge/                     # +lint-tools.ts
    eda-events/                     # unchanged
  rhoai/
    model-serving/                  # +sandbox.ts
    experiment-tracker/             # +read-side.ts, mlflow-client.ts deleted (migrated to _shared)
    mcp-bridge/                     # NEW (#33)
    mlflow-tools/                   # NEW (#34)
    pipelines/                      # NEW (#35)
    eval-trustyai/                  # NEW (#36)
  fleet/                            # NEW directory
    rhacm/                          # NEW (#32)
  satellite/
    lightspeed/                     # unchanged
  reference/                        # NEW directory
    dev-content/                    # NEW (#28)
    ecosystem-catalog/              # NEW (#38)
    api-catalog/                    # NEW (#37)
    rhdp-provisioner/               # NEW (#39)
```
