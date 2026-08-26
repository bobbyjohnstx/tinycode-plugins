# V3 Review Fixes Implementation Plan

## Context

Code review of the tinycode-plugins monorepo (25 Red Hat integration plugins + 1 shared package) produced 19 findings (issues #41-#59). An architect validated all issues, adjusted priorities, and organized them into 5 execution batches ordered by severity and dependency. This plan provides implementation-level detail for each issue.

**Repo:** Bun monorepo at `/Users/bjohns/projects/tinycode-plugins/`
**Test framework:** `bun:test`, 687 tests, all passing
**Shared HTTP client:** `redhat/_shared/src/api.ts` (touched by 4 issues in Batch 2)

## Work Objectives

- Fix 3 security vulnerabilities (Batch 1: #41, #45, #47)
- Harden the shared API client against 4 failure modes (Batch 2: #51, #44, #56, #52)
- Fix unbounded output, duplicated code, and misleading tool behavior (Batch 3: #48, #42, #46)
- Clean up dead code and documentation gaps (Batch 4: #43, #49, #50, #53)
- Address 5 independent quality improvements (Batch 5: #54, #55, #57, #58, #59)

## Guardrails

**Must Have:**
- All 687 existing tests continue to pass after each batch
- Each batch is a separate PR
- Security fixes (#41, #45, #47) ship before any other batch
- Batch 2 issues are implemented in order (#51 -> #44 -> #56 -> #52) as a single PR since all touch `api.ts`

**Must NOT Have:**
- No new dependencies added
- No changes to the PluginModule interface or plugin registration pattern
- No breaking changes to tool schemas (new optional params only)

## Dependency Graph

```
Batch 1 (#41, #45, #47) -----> Batch 4 (#43 needs #47 done; #49 touches oauth after #41)
Batch 2 (#51, #44, #56, #52) -> no downstream deps
Batch 3 (#48, #42, #46) ------> Batch 4 (#43 docs)
Batch 5 (#54, #55, #57, #58, #59) -> no deps, all independent
```

Batches 1, 2, and 5 can start in parallel. Batch 3 can start after Batch 1. Batch 4 starts after Batches 1 and 3.

---

## Batch 1: Security Fixes (PR #1)

Issues #41, #45, #47 are independent and can be implemented in parallel within the same PR.

### Issue #41 -- Remove hardcoded --insecure-skip-tls-verify from OAuth plugin

**Files:**
- `redhat/openshift/oauth/src/index.ts` (modify)
- `redhat/openshift/oauth/test/index.test.ts` (modify)

**Implementation Steps:**

1. In `oauth/src/index.ts`, add `insecureSkipTlsVerify` to the options schema (currently lines 5-9):
   ```typescript
   const schema = z.object({
     server: z.string().url().optional(),
     insecureSkipTlsVerify: z.boolean().optional(),
   }).optional()
   ```

2. In the `authorize` tool handler, replace the hardcoded flag at line 59. Current code:
   ```typescript
   const result = await input
     .$`oc login --token=${token} --server=${server} --insecure-skip-tls-verify`
     .nothrow()
     .quiet()
   ```
   Change to conditionally include the flag:
   ```typescript
   const args = ["oc", "login", `--token=${token}`, `--server=${server}`]
   if (parsed?.insecureSkipTlsVerify) {
     args.push("--insecure-skip-tls-verify")
   }
   const result = await input.$`${args}`.nothrow().quiet()
   ```
   Note: Verify that Bun shell template literals support array interpolation. If not, use two separate template paths with a conditional.

**Test Expectations:**

- Existing tests at lines 146-175 use `match: "oc login"` in mock shell -- these will still match since the command starts with `oc login`
- Add new test: "authorize does NOT include --insecure-skip-tls-verify by default" -- use a mock shell that captures the full command string and assert the flag is absent
- Add new test: "authorize includes --insecure-skip-tls-verify when option is true" -- pass `insecureSkipTlsVerify: true` in options and assert the flag is present
- Add new test: "authorize does NOT include --insecure-skip-tls-verify when option is false" -- pass `insecureSkipTlsVerify: false` and assert absence

**Acceptance Criteria:**
- `--insecure-skip-tls-verify` is NOT present in the oc login command when `insecureSkipTlsVerify` is unset, undefined, or false
- `--insecure-skip-tls-verify` IS present only when `insecureSkipTlsVerify: true`
- All existing oauth tests pass unchanged

---

### Issue #45 -- Redact credentials in RHDP provisioner tool output

**Files:**
- `redhat/reference/rhdp-provisioner/src/index.ts` (modify)
- `redhat/reference/rhdp-provisioner/test/index.test.ts` (modify)

**Implementation Steps:**

1. In `rhdp-provisioner/src/index.ts`, modify `formatProvisionStatus()` (line 37). Current code at lines 45-48:
   ```typescript
   if (status.credentials) {
     parts.push(`Username: ${status.credentials.username}`)
     parts.push(`Password: ${status.credentials.password}`)
   }
   ```
   Replace the password line:
   ```typescript
   if (status.credentials) {
     parts.push(`Username: ${status.credentials.username}`)
     parts.push(`Password: [REDACTED -- view credentials at ${status.consoleUrl ?? "the provisioning console"}]`)
   }
   ```

2. This function is called by both `rhdp_provision` (line 107) and `rhdp_status` (line 121), so both tools get the fix automatically.

**Test Expectations:**

- In `rhdp-provisioner/test/index.test.ts`, update the `rhdp_status` test (around line 235-248):
  - Change `expect(result).toContain("secret123")` to `expect(result).not.toContain("secret123")`
  - Add `expect(result).toContain("[REDACTED")`
  - Keep `expect(result).toContain("admin")` (username should still appear)
- Add new test: "formatProvisionStatus never exposes password in plaintext" -- provide mock status with credentials and assert the output contains `[REDACTED` and does NOT contain the raw password string

**Acceptance Criteria:**
- No raw password string appears in the output of `rhdp_provision` or `rhdp_status`
- Username is still visible
- Redacted message includes a pointer to the console URL
- All existing rhdp-provisioner tests pass (with updated assertions)

---

### Issue #47 -- Align Satellite plugin auth model (username/password -> token)

**Files:**
- `redhat/satellite/lightspeed/src/index.ts` (modify)
- `redhat/satellite/lightspeed/src/satellite-client.ts` (modify)
- `redhat/satellite/lightspeed/test/index.test.ts` (modify)

**Implementation Steps:**

1. In `satellite/lightspeed/src/index.ts`, replace the schema (lines 7-11):
   ```typescript
   // FROM:
   const optionsSchema = z.object({
     satelliteUrl: z.string().url(),
     username: z.string().optional(),
     password: z.string().optional(),
   }).optional()

   // TO:
   const optionsSchema = z.object({
     satelliteUrl: z.string().url(),
     token: z.string().optional(),
   }).optional()
   ```

2. Update the guard and client construction (lines 203-209):
   ```typescript
   // FROM:
   if (!parsed?.satelliteUrl || !parsed.username || !parsed.password) {
     return { tool: createUnconfiguredTools() }
   }
   const client = createSatelliteClient(parsed.satelliteUrl, parsed.username, parsed.password)

   // TO:
   if (!parsed?.satelliteUrl || !parsed.token) {
     return { tool: createUnconfiguredTools() }
   }
   const client = createSatelliteClient(parsed.satelliteUrl, parsed.token)
   ```

3. In `satellite-client.ts`, change `createSatelliteClient` signature (lines 53-65):
   ```typescript
   // FROM:
   export function createSatelliteClient(
     satelliteUrl: string,
     username: string,
     password: string,
   ): SatelliteClient {
     const basicAuth = btoa(`${username}:${password}`)
     const api: ApiClient = createApiClient({
       baseUrl: satelliteUrl,
       tokenFn: async () => "",
       headers: { Authorization: `Basic ${basicAuth}` },
     })

   // TO:
   export function createSatelliteClient(
     satelliteUrl: string,
     token: string,
   ): SatelliteClient {
     const api: ApiClient = createApiClient({
       baseUrl: satelliteUrl,
       tokenFn: async () => token,
     })
   ```
   Remove the `btoa` import if it becomes unused. Remove the `headers` override entirely -- the token will flow through the standard `Authorization: Bearer ${token}` path in `api.ts`.

**Test Expectations:**

- Update `satellite/lightspeed/test/index.test.ts`:
  - Line 15: Change `{ satelliteUrl, username, password }` to `{ satelliteUrl, token: "test-token" }`
  - Lines 44-54: Change "returns unconfigured tools when username missing" and "when password missing" to a single test: "returns unconfigured tools when token missing"
  - All fetch-intercepting tests (lines 79+) should still work since `setupFetch`/`createMockFetch` intercepts `globalThis.fetch` regardless of headers
  - Add assertion in at least one test that the fetch call includes `Authorization: Bearer test-token` header (not `Basic`)

**Acceptance Criteria:**
- Satellite plugin accepts `token` instead of `username`/`password`
- No Basic Auth code remains in `satellite-client.ts`
- `Authorization: Bearer <token>` header is sent (not `Basic`)
- Plugin returns unconfigured tools when `token` is missing
- All satellite tests pass with updated assertions

---

## Batch 2: API Client Hardening (PR #2)

All 4 issues modify `redhat/_shared/src/api.ts`. Implement in strict order: #51 -> #44 -> #56 -> #52.

**Files:**
- `redhat/_shared/src/api.ts` (modify -- primary target)
- `redhat/_shared/test/api.test.ts` (modify -- add tests for each issue)
- `redhat/openshift/context-injection/src/cluster-info.ts` (modify -- #44 timeout for oc exec)

### Issue #51 -- Allow tokenFn to return null to skip Authorization header

**Implementation Steps:**

1. In `api.ts`, change the `ApiClientConfig` type (lines 1-6):
   ```typescript
   // FROM:
   tokenFn: () => Promise<string>
   // TO:
   tokenFn: () => Promise<string | null>
   ```

2. In the `request()` function, update header construction (lines 37-42):
   ```typescript
   // FROM:
   const token = await config.tokenFn()
   const headers: Record<string, string> = {
     Authorization: `Bearer ${token}`,
     ...config.headers,
   }

   // TO:
   const token = await config.tokenFn()
   const headers: Record<string, string> = {
     ...config.headers,
   }
   if (token) {
     headers.Authorization = `Bearer ${token}`
   }
   ```
   Note: Place `config.headers` spread first so a custom `Authorization` header (like the former Satellite Basic Auth) would still work if set explicitly. With #47 done, no callers use this pattern anymore.

3. **Behavioral change across 13 plugins:** The following callers currently send `Authorization: Bearer ` (empty bearer) and will now send NO Authorization header:
   - `obs-logging/src/loki-client.ts:25`
   - `obs-logging/src/tempo-client.ts:44`
   - `rhoai/eval-trustyai/src/eval-client.ts:40`
   - `rhoai/eval-trustyai/src/trustyai-client.ts:32`
   - `rhoai/experiment-tracker/src/index.ts:27`
   - `rhoai/mcp-bridge/src/mcp-client.ts:27`
   - `rhoai/mlflow-tools/src/index.ts:401`
   - `rhoai/mlflow-tools/src/mlflow-read-client.ts:62`
   - `rhoai/pipelines/src/pipeline-client.ts:47`
   - `satellite/lightspeed/src/satellite-client.ts:61` (already fixed by #47)
   - `devex/quay/src/quay-client.ts:84`
   - `devex/rhdh/src/rhdh-client.ts:46`
   - `security/lightwell/src/lightwell-client.ts:62`

   For each of these 13 files, change `async () => ""` (or `async () => token ?? ""`) to `async () => token ?? null` (or `async () => null` for the hardcoded empty ones). This ensures callers explicitly opt out of the Authorization header instead of sending a malformed one.

**Test Expectations:**
- Add test in `api.test.ts`: "skips Authorization header when tokenFn returns null" -- assert no `Authorization` key in fetch headers
- Add test: "skips Authorization header when tokenFn returns empty string" -- decide: should empty string also skip? Recommend yes (falsy check).
- Existing test "includes authorization header" should still pass with a non-empty token

**Acceptance Criteria:**
- `tokenFn` returning `null` or `""` results in NO `Authorization` header on the request
- All 13 callers updated from `async () => ""` to `async () => null`
- No `Authorization: Bearer ` (empty bearer) sent by any plugin
- 7 callers with real tokens continue to send proper `Authorization: Bearer <token>`

---

### Issue #44 -- Add configurable timeout (default 30s)

**Implementation Steps:**

1. In `api.ts`, add `timeout` to `ApiClientConfig`:
   ```typescript
   export type ApiClientConfig = {
     baseUrl: string
     tokenFn: () => Promise<string | null>
     headers?: Record<string, string>
     maxRetries?: number
     timeoutMs?: number
   }
   ```

2. In `createApiClient()`, extract the default:
   ```typescript
   const timeout = config.timeoutMs ?? 30_000
   ```

3. In the `request()` function, add `AbortSignal.timeout()` to the fetch call:
   ```typescript
   response = await fetch(url, {
     ...init,
     signal: AbortSignal.timeout(timeout),
   })
   ```

4. In `context-injection/src/cluster-info.ts`, add timeout to the `oc.raw()` call at lines 33-36. The `oc.raw()` method uses Bun shell -- add a `.timeout(30_000)` or wrap with `AbortSignal`:
   ```typescript
   const output = await input
     .$`oc -n openshift-monitoring exec -c alertmanager alertmanager-main-0 -- curl -s http://localhost:9093/api/v2/alerts?active=true&silenced=false`
     .timeout(30_000)
     .text()
   ```
   Verify that Bun shell supports `.timeout()` on the command builder. If not, use `Promise.race` with a timeout promise.

**Test Expectations:**
- Add test in `api.test.ts`: "aborts request after timeout" -- mock a fetch that never resolves, assert `AbortError` or timeout error is thrown
- Add test: "uses custom timeout when provided" -- pass `timeoutMs: 5000`, verify signal
- Add test: "uses default 30s timeout when not specified"

**Acceptance Criteria:**
- All API requests have a 30s default timeout
- Timeout is configurable per-client via `timeoutMs` option
- `cluster-info.ts` oc exec call has a timeout
- `AbortError` propagates as a clear error message

---

### Issue #56 -- Check Content-Type before calling resp.json()

**Implementation Steps:**

1. In `api.ts`, after the `resp.ok` check (line 59), replace the unconditional `resp.json()` call:
   ```typescript
   // FROM:
   const data = (await resp.json()) as T
   return { data, status: resp.status, headers: resp.headers }

   // TO:
   const contentType = resp.headers.get("content-type") ?? ""
   if (!contentType.includes("application/json")) {
     const body = await resp.text()
     throw new Error(
       `Expected JSON response but received ${contentType || "unknown content type"}. ` +
       `Body: ${body.slice(0, 500)}`
     )
   }
   const data = (await resp.json()) as T
   return { data, status: resp.status, headers: resp.headers }
   ```

**Test Expectations:**
- Add test: "throws descriptive error when response is HTML" -- mock fetch returning `Content-Type: text/html` with an HTML body, assert error message includes "Expected JSON" and a truncated snippet of the body
- Add test: "throws descriptive error when Content-Type is missing" -- assert error mentions "unknown content type"
- Add test: "parses JSON normally when Content-Type is application/json" -- existing behavior preserved

**Acceptance Criteria:**
- `resp.json()` is only called when Content-Type includes `application/json`
- Non-JSON responses produce a clear error with the actual content type and first 500 chars of body
- Existing JSON-returning endpoints work unchanged

---

### Issue #52 -- Wrap fetch in try/catch, handle network errors in retry loop

**Implementation Steps:**

1. In `api.ts`, wrap the `fetch()` call inside the retry loop in a try/catch:
   ```typescript
   for (let attempt = 0; attempt <= maxRetries; attempt++) {
     try {
       const token = await config.tokenFn()
       const headers: Record<string, string> = { ...config.headers }
       if (token) {
         headers.Authorization = `Bearer ${token}`
       }
       const init: RequestInit = { method, headers }
       if (options?.body !== undefined) {
         headers["Content-Type"] = "application/json"
         init.body = JSON.stringify(options.body)
       }
       response = await fetch(url, {
         ...init,
         signal: AbortSignal.timeout(timeout),
       })
       if (response.status !== 401) { break }
     } catch (error: unknown) {
       const isTransient = isTransientError(error)
       if (!isTransient || attempt === maxRetries) {
         throw new Error(
           `Network error after ${attempt + 1} attempt(s): ${error instanceof Error ? error.message : String(error)}`
         )
       }
       // Transient error, retry
     }
   }
   ```

2. Add a helper function `isTransientError` above `request()`:
   ```typescript
   function isTransientError(error: unknown): boolean {
     if (!(error instanceof Error)) return false
     const transientCodes = ["ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]
     return transientCodes.some(code =>
       error.message.includes(code) || ("code" in error && (error as { code: string }).code === code)
     )
   }
   ```

3. Remove the unsafe `response!` non-null assertion at line 56. Replace with a guard:
   ```typescript
   if (!response) {
     throw new Error(`No response received after ${maxRetries + 1} attempts`)
   }
   ```

4. **Consider refactoring:** After all 4 issues, `request()` will grow from ~40 to ~70-80 lines. Consider extracting:
   - `buildHeaders(token, config, body)` helper
   - Keep the retry logic inline since it's the core of the function
   This refactor is optional but recommended for readability.

**Test Expectations:**
- Add test: "retries on ECONNRESET" -- mock fetch to throw ECONNRESET on first call, succeed on second
- Add test: "does not retry on non-transient errors" -- mock fetch to throw a TypeError, assert immediate throw
- Add test: "throws after exhausting retries on transient errors" -- mock fetch to always throw ECONNRESET, assert error message includes attempt count
- Add test: "throws clear error when response is null after retries" -- mock all attempts to throw, verify no null reference

**Acceptance Criteria:**
- Network errors (ECONNRESET, ENOTFOUND, ETIMEDOUT, ECONNREFUSED) trigger retries
- Non-transient errors throw immediately
- No `response!` non-null assertion -- safe null check with descriptive error
- Error messages include attempt count and original error

---

## Batch 3: Output Safety and Tool Correctness (PR #3)

Implement #48 before #42 (both touch `obs-tools.ts`). Then #46 (obs-logging).

### Issue #48 -- Consolidate parseDuration: delete local, import shared

**Files:**
- `redhat/openshift/cluster-ops/src/obs-tools.ts` (modify)
- `redhat/openshift/cluster-ops/test/obs-tools.test.ts` (modify if it exists, else `test/index.test.ts`)

**Implementation Steps:**

1. In `cluster-ops/src/obs-tools.ts`, add import at the top:
   ```typescript
   import { parseDuration } from "tinycode-plugin-redhat-shared/promql"
   ```

2. Delete the local `parseDuration` function (lines 248-256):
   ```typescript
   // DELETE THIS:
   function parseDuration(duration: string): number {
     const match = duration.match(/^(\d+)(h|m|s)$/)
     if (!match) return 0
     // ...
   }
   ```

3. Update the caller at lines 187-190 to handle the shared version's throw behavior:
   ```typescript
   // FROM:
   if (args.since) {
     const durationMs = parseDuration(args.since)
     if (durationMs > 0) {
       const cutoff = Date.now() - durationMs

   // TO:
   if (args.since) {
     let durationMs: number
     try {
       durationMs = parseDuration(args.since)
     } catch {
       return `Invalid duration format: "${args.since}". Use e.g. "30s", "5m", "1h", "7d", "1w"`
     }
     const cutoff = Date.now() - durationMs
   ```
   Note: The `durationMs > 0` check is no longer needed because the shared version always returns a positive number (it throws on invalid input, and valid input always produces `value * multiplier > 0`). Remove the `if (durationMs > 0)` wrapping -- the cutoff always applies when `args.since` is provided and valid.

**Key difference between local and shared `parseDuration`:**
- Local: supports `h`, `m`, `s` only; returns 0 on invalid
- Shared: supports `s`, `m`, `h`, `d`, `w`; throws on invalid
- Behavioral gain: users can now use `7d` and `1w` durations

**Test Expectations:**
- Add test: "handles invalid since duration gracefully" -- pass `since: "invalid"`, expect error message (not a throw)
- Add test: "supports day and week durations via shared parseDuration" -- pass `since: "7d"`, verify filtering works
- Existing tests with valid `since: "1h"` values should pass unchanged

**Acceptance Criteria:**
- No local `parseDuration` function in `obs-tools.ts`
- Import comes from `tinycode-plugin-redhat-shared/promql`
- Invalid duration returns a user-friendly error message (not a thrown exception)
- `d` and `w` duration units now work

---

### Issue #42 -- Add truncation/pagination to unbounded tool outputs

**Files:**
- `redhat/openshift/cluster-ops/src/core-tools.ts` (modify)
- `redhat/fleet/rhacm/src/index.ts` (modify)
- `redhat/openshift/cluster-ops/test/index.test.ts` (modify)
- `redhat/fleet/rhacm/test/index.test.ts` (modify)

**Implementation Steps:**

1. Create a shared `truncateOutput` utility. Add to `cluster-ops/src/core-tools.ts` (or a local utils file):
   ```typescript
   const MAX_OUTPUT_LENGTH = 5000
   
   function truncateOutput(data: unknown, label?: string): string {
     const json = JSON.stringify(data, null, 2)
     if (json.length <= MAX_OUTPUT_LENGTH) return json
     return json.slice(0, MAX_OUTPUT_LENGTH) +
       `\n\n... (truncated${label ? ` ${label}` : ""}, showing ${MAX_OUTPUT_LENGTH} of ${json.length} characters)`
   }
   ```
   Note: This mirrors the pattern in `redhat/reference/api-catalog/src/index.ts:75-84` (`MAX_SPEC_LENGTH = 5000`).

2. Add optional `limit` parameter to list tools. For each tool that returns unbounded lists:

   **In `core-tools.ts`:**
   - `ocp_get_resources` (line 34): Add `limit: z.number().optional().describe("Max items to return (default 50)")` to schema. Slice `result.items` to `limit ?? 50` before stringify. Wrap output in `truncateOutput()`.
   - `ocp_events` (line 144): Add `limit` param. Slice events array. Wrap in `truncateOutput()`.
   - `ocp_status` (line 183): This returns composite data (nodes + clusterOperators + version). Truncate each section independently with labels. Add `limit` to control max nodes and operators shown.

   **In `fleet/rhacm/src/index.ts`:**
   - `acm_clusters` (line 39): Add `limit` param, slice, truncate.
   - `acm_policies` (line 78): Add `limit` param, slice, truncate.
   - `acm_violations` (line 106): Add `limit` param, slice, truncate.
   - `acm_applications` (line 128): Add `limit` param, slice, truncate.

3. When slicing, include a count summary:
   ```typescript
   const items = result.items.slice(0, limit)
   const prefix = items.length < result.items.length
     ? `Showing ${items.length} of ${result.items.length} items:\n`
     : ""
   return prefix + truncateOutput(items)
   ```

**Test Expectations:**
- Update `cluster-ops/test/index.test.ts:87` -- currently asserts exact `JSON.stringify(mockData, null, 2)`. If mock data is small (under 5000 chars), test should still pass since truncation only triggers on large output. If test breaks, update assertion to use `.toContain()` for key fields.
- Add test: "ocp_get_resources truncates large output" -- provide mock data with 100+ items, assert output includes truncation message
- Add test: "ocp_get_resources respects limit parameter" -- pass `limit: 5`, assert only 5 items in output
- Add test: "ocp_get_resources defaults to 50 items" -- provide 100 items, assert output shows "Showing 50 of 100"
- Similar tests for `acm_clusters`, `acm_policies`, `acm_violations`, `acm_applications`
- Existing tests with small mock datasets should pass unchanged

**Acceptance Criteria:**
- No tool can return more than 5000 characters without truncation
- List tools default to 50 items max, configurable via optional `limit` param
- Truncation message includes original size for debugging
- All existing tests pass (small mock data stays under truncation threshold)

---

### Issue #46 -- obs_network_flows queries FlowCollector CRD, not actual flow data

**Files:**
- `redhat/openshift/obs-logging/src/index.ts` (modify -- `createOcTools` at line 192)
- `redhat/openshift/obs-logging/test/index.test.ts` (modify)

**Implementation Steps:**

1. The `obs_network_flows` tool at `obs-logging/src/index.ts:196` accepts filter args (`namespace`, `srcPod`, `destPod`, `since`) but only queries the `flowcollectors.flows.netobserv.io` CRD. This returns the FlowCollector operator config, not actual network flow data. The tool name and description are misleading.

2. **Option A (rename to match behavior):** Rename the tool to `obs_flow_collectors` and update the description to clarify it returns FlowCollector CRD status, not flow data. Remove the unused filter args (`namespace`, `srcPod`, `destPod`, `since`) since the CRD query doesn't use them.

3. **Option B (implement actual flow querying):** This would require querying the Loki-based flow logs or the Network Observability API, which is significantly more complex and depends on the cluster's NetObserv configuration. Not recommended for this batch.

4. Implement Option A:
   ```typescript
   obs_flow_collectors: {
     description:
       "Check Network Observability FlowCollector status. Shows agent type, log types, and readiness.",
     args: {},
     async execute() {
       try {
         const result = await oc.get<{
           items: Array<{
             metadata: { name: string; namespace: string }
             spec: {
               agent?: { type?: string }
               processor?: { logTypes?: string }
             }
             status?: { conditions?: Array<{ type: string; status: string }> }
           }>
         }>("flowcollectors.flows.netobserv.io")
         // ... (same formatting logic, minus the unused filter display)
       }
     }
   }
   ```

5. Remove the unused filter args and the filter display block (lines 246-251):
   ```typescript
   // DELETE:
   if (args.namespace || args.srcPod || args.destPod) {
     lines.push("")
     lines.push(
       `Filter: namespace=${args.namespace ?? "*"}, src=${args.srcPod ?? "*"}, dest=${args.destPod ?? "*"}`
     )
   }
   ```

6. Update `createUnconfiguredLogTools` if it has a matching unconfigured stub (it doesn't -- the oc tools are always available since they use the oc client, not API URL config).

7. Update `README.md` to reflect the renamed tool (`obs_flow_collectors` instead of `obs_network_flows`).

**Test Expectations:**
- Update existing tests that reference `obs_network_flows` to use `obs_flow_collectors`
- Remove tests for filter args (namespace, srcPod, destPod, since) since they're no longer accepted
- Tool count assertion in obs-logging tests may need updating if tool name changes

**Acceptance Criteria:**
- Tool renamed from `obs_network_flows` to `obs_flow_collectors`
- Description accurately states it checks FlowCollector CRD status
- Unused filter args removed (namespace, srcPod, destPod, since)
- README updated with correct tool name
- All obs-logging tests pass

---

## Batch 4: Documentation and Dead Code Cleanup (PR #4)

Depends on Batch 1 (#47 satellite auth) and Batch 3 being done.

### Issue #43 -- Fix README config table

**Files:**
- `README.md` (modify -- config table around lines 23-38)

**Implementation Steps:**

1. After #47 is merged, update the satellite row (line 37) to reflect token-based auth:
   ```
   | satellite-lightspeed | satelliteUrl, token | Satellite AI assistant |
   ```

2. Verify each plugin row against its actual schema:
   - `aap-bridge`: Check `redhat/automation/aap-bridge/src/index.ts` schema for exact option names (`controllerUrl`, `controllerToken` or similar)
   - `obs-logging`: Check `redhat/openshift/observability/src/index.ts` or `obs-logging` schema for `lokiUrl`, `tempoUrl`, `networkObsUrl`, `grafanaUrl`
   - `rhacm`: Check `redhat/fleet/rhacm/src/index.ts` schema for `thanosUrl`
   - Fix any mismatches between README and actual schema field names

3. Ensure the table format is consistent (aligned columns, consistent description style).

**Test Expectations:**
- No code tests -- manual verification that README table matches schemas

**Acceptance Criteria:**
- Every config option in the README matches the actual zod schema field name in the corresponding plugin
- Satellite row shows `token` (not `username, password`)
- No stale or missing config options

---

### Issue #49 -- Remove tokenManager singleton from auth.ts

**Files:**
- `redhat/_shared/src/auth.ts` (modify)
- `redhat/_shared/test/auth.test.ts` (modify)
- `redhat/openshift/oauth/src/index.ts` (modify -- after #41 is done)
- `redhat/openshift/oauth/test/index.test.ts` (modify)
- `redhat/_shared/package.json` (verify exports)
- `README.md` (modify -- line 471)

**Implementation Steps:**

1. In `oauth/src/index.ts`, remove the `tokenManager.setToken` call at lines 66-70. The authorize tool should still return the token to the LLM context but should NOT cache it in a singleton.

2. In `oauth/src/index.ts`, remove the `import { tokenManager }` from line 3.

3. In `_shared/src/auth.ts`:
   - Delete the `TokenManager` class (lines 17-37)
   - Delete `export const tokenManager = new TokenManager()` (line 37)
   - Delete `resolveToken()` function (lines 39-67)
   - Delete `createTokenFn()` function (lines 69-77)
   - Keep any type exports or other utilities that remain in the file
   - If the file becomes empty (or only has types), consider whether the `./auth` export in `package.json` should be removed or kept for types

4. In `_shared/package.json`, check if `"./auth": "./src/auth.ts"` export (line 10) should be removed. Grep for other importers:
   ```bash
   grep -rn "from.*shared/auth\|from.*_shared.*auth" redhat/ --include="*.ts" | grep -v node_modules
   ```
   If only oauth imports it, and oauth no longer needs it, remove the export.

5. In `README.md`, update or remove line 471 referencing "Token Manager -- singleton auth token management across plugins".

**Test Expectations:**
- In `_shared/test/auth.test.ts`: Remove the `tokenManager` describe block (lines 21-48), the `resolveToken` describe block (lines 52-55+), and the `createTokenFn` describe block (lines 115+). Keep any remaining test blocks.
- In `oauth/test/index.test.ts`: Remove `tokenManager` import (line 4), remove `tokenManager.clear()` calls (line 63), remove `tokenManager.setToken` assertion (line 177), remove `tokenManager.getToken` assertion (line 188). Update tests to verify authorize returns the token without caching.

**Acceptance Criteria:**
- No `TokenManager` class, `tokenManager` singleton, `resolveToken`, or `createTokenFn` in the codebase
- OAuth authorize tool still returns token info but does not cache it
- No `tokenManager` imports anywhere in the repo
- `./auth` export removed from `_shared/package.json` if no other importers exist
- README reference updated

---

### Issue #50 -- Add error counter to EDA events

**Files:**
- `redhat/automation/eda-events/src/index.ts` (modify)
- `redhat/automation/eda-events/test/index.test.ts` (modify)

**Implementation Steps:**

1. In `eda-events/src/index.ts`, add a module-level counter near the top of the server function scope:
   ```typescript
   let failedDeliveries = 0
   ```

2. Update the `.catch()` at line 59:
   ```typescript
   // FROM:
   .catch(() => {})

   // TO:
   .catch((error: unknown) => {
     failedDeliveries++
     console.error(`EDA event delivery failed (${failedDeliveries} total):`, error instanceof Error ? error.message : String(error))
   })
   ```

3. Expose the counter. Look for a `session.end` or diagnostic hook in the plugin pattern. If the plugin has a `session` hook (around lines 102-118), add the counter to the session end data:
   ```typescript
   "session.end": () => {
     if (failedDeliveries > 0) {
       return `${failedDeliveries} event delivery failure(s) occurred during this session`
     }
   }
   ```
   If no session hook exists, expose via a diagnostic tool or log output.

**Test Expectations:**
- Existing test at lines 269-277 (error handling with `failingFetch`) should still pass -- it verifies no throw on failure
- Add test: "increments failed delivery counter on fetch error" -- trigger multiple failures, verify counter value
- Add test: "reports failed deliveries at session end" -- if exposed via session hook

**Acceptance Criteria:**
- Failed event deliveries are counted (not silently swallowed)
- Counter is exposed via session end data or diagnostic output
- Fire-and-forget behavior is preserved (failures don't block the main flow)
- Error details are logged via `console.error`

---

### Issue #53 -- Document AAP CONTROLLER_OAUTH_TOKEN env var exposure

**Files:**
- `README.md` (modify)

**Implementation Steps:**

1. Find the AAP Bridge section in the README (around the config table).
2. Add a note documenting that `CONTROLLER_OAUTH_TOKEN` environment variable is used for authentication:
   ```markdown
   > **Note:** The `aap-bridge` plugin reads `CONTROLLER_OAUTH_TOKEN` from the environment
   > for controller authentication. Ensure this variable is set in your shell or `.env` file.
   ```
3. If there's an environment variables section, add it there instead.

**Test Expectations:**
- No code tests -- documentation only

**Acceptance Criteria:**
- README documents the `CONTROLLER_OAUTH_TOKEN` env var, where it's used, and how to set it
- Documentation is near the aap-bridge config table entry

---

## Batch 5: P3 Quality Improvements (PR #5)

All 5 issues are independent and can be implemented in parallel.

### Issue #54 -- Fix acm_app_deploy to use oc.apply() instead of raw shell

**Files:**
- `redhat/fleet/rhacm/src/index.ts` (modify)
- `redhat/fleet/rhacm/test/index.test.ts` (modify)

**Implementation Steps:**

1. In `rhacm/src/index.ts`, update `createAcmTools` function signature (line 21) to accept `oc` client:
   ```typescript
   // FROM:
   function createAcmTools(api: AcmClient, $: PluginInput["$"])
   // TO:
   function createAcmTools(api: AcmClient, oc: ReturnType<typeof createOcClient>, $: PluginInput["$"])
   ```

2. Update the `acm_app_deploy` handler (line 151):
   ```typescript
   // FROM:
   const result = await $`echo ${args.yaml} | oc apply -f -`.text()
   // TO:
   const result = await oc.apply(args.yaml)
   ```
   Verify `oc.apply()` exists and returns a string. Check `_shared/src/oc.ts` for the method signature.

3. Update the call site where `createAcmTools` is invoked (around line 209) to pass the `oc` client:
   ```typescript
   const oc = createOcClient(input.$)
   const tools = createAcmTools(client, oc, input.$)
   ```

**Test Expectations:**
- Existing test at `rhacm/test/index.test.ts:376-408` uses mock shell matching `"oc apply"` -- should still match since `oc.apply()` internally runs `oc apply`
- Verify test still passes after the change

**Acceptance Criteria:**
- `acm_app_deploy` uses `oc.apply()` method, not raw shell `$` template
- No raw `oc` shell commands in rhacm plugin (all go through oc client)
- Existing tests pass

---

### Issue #55 -- Externalize hardcoded UBI versions in container-linter

**Files:**
- `redhat/security/container-linter/src/index.ts` (modify)
- `redhat/security/container-linter/test/index.test.ts` (modify if needed)

**Implementation Steps:**

1. In `container-linter/src/index.ts`, extract version strings into a config constant at the top of the file (before `BASE_IMAGE_LOOKUP`):
   ```typescript
   const UBI_VERSIONS = {
     openjdkRuntime: "1.20",
     python312: "1",
     nodejs22: "1",
     ubiMinimal: "9.5",
     ubiMicro: "9.5",
     ubi: "9.5",
   } as const
   ```

2. Update `BASE_IMAGE_LOOKUP` (lines 18-63) to reference the config:
   ```typescript
   // FROM:
   suggestion: "registry.access.redhat.com/ubi9/openjdk-21-runtime:1.20"
   // TO:
   suggestion: `registry.access.redhat.com/ubi9/openjdk-21-runtime:${UBI_VERSIONS.openjdkRuntime}`
   ```
   Apply to all 5 image references and the `DEFAULT_SUGGESTION` at lines 65-68.

**Test Expectations:**
- Existing tests assert on substrings like `"openjdk-21-runtime"`, `"python-312"` (image names, not version tags) -- these should still pass
- If any test asserts on exact version strings, update to reference `UBI_VERSIONS` or use `.toContain()` for the image name portion
- No new tests needed -- this is a refactoring

**Acceptance Criteria:**
- All UBI version strings come from the `UBI_VERSIONS` constant
- No hardcoded version strings in `BASE_IMAGE_LOOKUP` or `DEFAULT_SUGGESTION`
- Updating versions requires changing only the `UBI_VERSIONS` object
- All existing container-linter tests pass

---

### Issue #57 -- Replace local mock in oauth test with shared test-utils

**Files:**
- `redhat/openshift/oauth/test/index.test.ts` (modify)

**Implementation Steps:**

1. Delete the local `createMockInput` function (lines 7-60).

2. Add `createMockInput` to the existing import from shared test-utils (line 3):
   ```typescript
   // FROM:
   import { createMockShell } from "tinycode-plugin-redhat-shared/test-utils"
   // TO:
   import { createMockInput, createMockShell } from "tinycode-plugin-redhat-shared/test-utils"
   ```

3. Verify that the shared `createMockInput` (at `_shared/src/test-utils.ts:87-100`) accepts the same parameters as the local version. Both accept an optional `shell` parameter to override the mock shell. The shared version returns the same `PluginInput` structure.

4. Search for any call sites of the local `createMockInput` in the test file and verify they work with the shared version's signature.

**Test Expectations:**
- All existing oauth tests should pass unchanged after the swap
- The shared `createMockInput` is functionally equivalent

**Acceptance Criteria:**
- No local `createMockInput` in `oauth/test/index.test.ts`
- Import comes from `tinycode-plugin-redhat-shared/test-utils`
- All oauth tests pass

---

### Issue #58 -- Fix multi-line ENV parsing in containerfile-parser

**Files:**
- `redhat/_shared/src/containerfile-parser.ts` (modify)
- `redhat/_shared/test/containerfile-parser.test.ts` (modify)

**Implementation Steps:**

1. The current `parseEnv()` (lines 168-186) returns a single `EnvDirective`. Docker supports `ENV FOO=bar BAZ=qux` (multiple key=value pairs on one line). The function needs to handle this.

2. Change `parseEnv` to return `EnvDirective[]`:
   ```typescript
   function parseEnv(args: string, lineNumber: number): EnvDirective[] {
     // Try key=value format (supports multiple pairs)
     const pairs: EnvDirective[] = []
     const pairRegex = /(\w+)=(["']?)([^"']*)\2/g
     let match
     while ((match = pairRegex.exec(args)) !== null) {
       pairs.push({ type: "ENV", key: match[1]!, value: match[3]!, lineNumber })
     }
     if (pairs.length > 0) return pairs

     // Fallback: space-separated single pair (ENV KEY VALUE)
     const spaceIdx = args.indexOf(" ")
     if (spaceIdx !== -1) {
       return [{ type: "ENV", key: args.slice(0, spaceIdx).trim(), value: args.slice(spaceIdx + 1).trim(), lineNumber }]
     }

     return [{ type: "ENV", key: args.trim(), value: "", lineNumber }]
   }
   ```

3. Update the caller in `parseInstruction` (line 241) to handle the array return:
   ```typescript
   // FROM:
   case "ENV": return parseEnv(args, lineNumber)
   // TO:
   case "ENV": return parseEnv(args, lineNumber)
   ```
   If `parseInstruction` returns a single `ContainerfileInstruction`, it needs to return `ContainerfileInstruction | ContainerfileInstruction[]`. Then `parseContainerfile` (line 285 where it pushes instructions) needs to handle the array:
   ```typescript
   const result = parseInstruction(...)
   if (Array.isArray(result)) {
     instructions.push(...result)
   } else {
     instructions.push(result)
   }
   ```

4. **Check callers for return type assumptions.** Grep for code that assumes `parseEnv` or `parseInstruction` returns a single object. The `ContainerfileInstruction` union type may need updating if callers do type narrowing.

**Test Expectations:**
- Existing test at line 77-108 (`ENV APP_HOME="/opt/app"`) should still pass (single pair returns array of length 1, but caller flattens)
- Add test: "parses multi-pair ENV instruction" -- `ENV FOO=bar BAZ=qux` should produce 2 EnvDirective entries
- Add test: "parses multi-pair ENV with quotes" -- `ENV FOO="hello world" BAZ='test'`
- Add test: "single key=value ENV still works" -- backwards compatibility
- Add test: "ENV without value still works" -- `ENV MYVAR`

**Acceptance Criteria:**
- `ENV FOO=bar BAZ=qux` produces two separate `EnvDirective` entries
- Single key=value ENV still works
- Space-separated `ENV KEY VALUE` format still works
- `ENV KEY` (no value) still works
- All existing containerfile-parser tests pass
- No callers break due to return type change

---

### Issue #59 -- Add default sensitive patterns to EDA events

**Files:**
- `redhat/automation/eda-events/src/index.ts` (modify)
- `redhat/automation/eda-events/test/index.test.ts` (modify)

**Implementation Steps:**

1. In `eda-events/src/index.ts`, add a default patterns constant near the top:
   ```typescript
   const DEFAULT_SENSITIVE_PATTERNS = [
     "sha256~",
     "^sk-",
     "^ghp_",
     "Bearer\\s+\\S+",
   ]
   ```

2. Update line 74 to use defaults when user provides none:
   ```typescript
   // FROM:
   const patterns = (parsed.sensitivePatterns ?? []).map((p) => new RegExp(p))
   // TO:
   const patterns = (parsed.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS).map((p) => new RegExp(p))
   ```

**Test Expectations:**
- Existing test for user-provided patterns (lines 237-265) should pass unchanged (user patterns override defaults)
- Add test: "uses default sensitive patterns when none provided" -- send event data containing `sha256~xxxx`, `sk-test123`, `ghp_abc`, `Bearer token123` and verify they are redacted
- Add test: "user-provided patterns override defaults" -- provide custom patterns, verify defaults are not applied

**Acceptance Criteria:**
- When `sensitivePatterns` is not configured, the 4 default patterns are active
- When `sensitivePatterns` IS configured, only user patterns are used (defaults are NOT merged)
- `sha256~`, `sk-`, `ghp_`, and `Bearer` tokens are redacted by default
- All existing EDA events tests pass

---

## Master Execution Checklist

### Batch 1 (PR: `fix/security-batch1`)
- [ ] #41: Add `insecureSkipTlsVerify` to oauth schema
- [ ] #41: Make `--insecure-skip-tls-verify` conditional in oc login command
- [ ] #41: Add 3 tests (flag absent by default, present when true, absent when false)
- [ ] #45: Replace password with `[REDACTED]` in `formatProvisionStatus`
- [ ] #45: Update `rhdp_status` test assertions
- [ ] #47: Replace `username`/`password` with `token` in satellite schema
- [ ] #47: Update `createSatelliteClient` to use `tokenFn` instead of Basic Auth
- [ ] #47: Update satellite tests for token-based auth
- [ ] Run `bun test` -- all 687+ tests pass
- [ ] Create PR

### Batch 2 (PR: `fix/api-client-hardening`)
- [ ] #51: Change `tokenFn` return type to `string | null`
- [ ] #51: Skip Authorization header when token is falsy
- [ ] #51: Update 13 callers from `async () => ""` to `async () => null`
- [ ] #51: Add tests for null/empty token behavior
- [ ] #44: Add `timeoutMs` to `ApiClientConfig`
- [ ] #44: Add `AbortSignal.timeout()` to fetch call
- [ ] #44: Add timeout to `cluster-info.ts` oc exec
- [ ] #44: Add timeout tests
- [ ] #56: Add Content-Type check before `resp.json()`
- [ ] #56: Add tests for HTML response, missing Content-Type
- [ ] #52: Wrap fetch in try/catch inside retry loop
- [ ] #52: Add `isTransientError` helper
- [ ] #52: Remove `response!` non-null assertion
- [ ] #52: Add network error retry tests
- [ ] Run `bun test` -- all tests pass
- [ ] Create PR

### Batch 3 (PR: `fix/output-safety`)
- [ ] #48: Import `parseDuration` from shared promql
- [ ] #48: Delete local `parseDuration` from obs-tools.ts
- [ ] #48: Add try/catch at caller for invalid duration
- [ ] #48: Add tests for invalid duration and d/w units
- [ ] #42: Add `truncateOutput` helper (MAX_OUTPUT_LENGTH = 5000)
- [ ] #42: Add `limit` param to ocp_get_resources, ocp_events, ocp_status
- [ ] #42: Add `limit` param to acm_clusters, acm_policies, acm_violations, acm_applications
- [ ] #42: Add truncation and limit tests
- [ ] #46: Rename `obs_network_flows` to `obs_flow_collectors`
- [ ] #46: Remove unused filter args (namespace, srcPod, destPod, since)
- [ ] #46: Update description to match CRD-query behavior
- [ ] #46: Update README tool name
- [ ] #46: Update obs-logging tests
- [ ] Run `bun test` -- all tests pass
- [ ] Create PR

### Batch 4 (PR: `fix/docs-dead-code-cleanup`)
- [ ] #43: Update README config table (satellite token, verify all rows)
- [ ] #49: Remove `tokenManager.setToken` from oauth/src/index.ts
- [ ] #49: Delete TokenManager class, resolveToken, createTokenFn from auth.ts
- [ ] #49: Remove tokenManager imports/assertions from oauth and auth tests
- [ ] #49: Remove/update `./auth` export in _shared/package.json
- [ ] #49: Update README line 471
- [ ] #50: Add `failedDeliveries` counter to EDA events
- [ ] #50: Update `.catch()` to increment counter and log
- [ ] #50: Expose counter via session end or diagnostic
- [ ] #53: Document CONTROLLER_OAUTH_TOKEN in README
- [ ] Run `bun test` -- all tests pass
- [ ] Create PR

### Batch 5 (PR: `fix/quality-improvements`)
- [ ] #54: Pass oc client to `createAcmTools`, use `oc.apply()` in acm_app_deploy
- [ ] #55: Extract `UBI_VERSIONS` constant, update BASE_IMAGE_LOOKUP references
- [ ] #57: Delete local createMockInput, import from shared test-utils
- [ ] #58: Update `parseEnv` to return `EnvDirective[]` for multi-pair ENV
- [ ] #58: Update `parseInstruction` caller to handle array return
- [ ] #58: Add multi-pair ENV tests
- [ ] #59: Add `DEFAULT_SENSITIVE_PATTERNS` constant
- [ ] #59: Use defaults when `sensitivePatterns` not provided
- [ ] #59: Add tests for default pattern redaction
- [ ] Run `bun test` -- all tests pass
- [ ] Create PR

## Success Criteria

- All 19 issues implemented (#41-#59)
- 5 PRs created, one per batch
- All tests pass after each batch (no regressions)
- No security vulnerabilities remain (#41 TLS, #45 credential exposure, #47 auth model)
- Shared API client handles timeout, network errors, null tokens, and HTML responses
- No unbounded tool output can exceed 5000 characters
- No dead code (tokenManager, duplicate parseDuration, local mock)
- README accurately reflects current schemas and auth models
