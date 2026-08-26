# Security Review — tinycode-plugins

**Date:** 2026-08-26
**Scope:** Full codebase — 25 Red Hat integration plugins, shared modules, all client libraries (~50 source files, ~5,500 LOC)
**Risk Level:** LOW
**Reviewer:** Automated security review (security-reviewer agent)

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |

No vulnerabilities met the 7/10 confidence threshold for actionable findings.

## OWASP Top 10 Coverage

| Category | Status | Notes |
|----------|--------|-------|
| A01: Broken Access Control | PASS | Destructive ops gated by `ctx.ask()`; cluster access controlled by RBAC via `oc` session |
| A02: Cryptographic Failures | PASS | Tokens handled via closures, not hardcoded or logged; SSO uses standard OIDC refresh_token flow |
| A03: Injection | PASS | Shell commands use Bun tagged templates with proper escaping; no SQL; URL path interpolation is path-only |
| A04: Insecure Design | PASS | Plugin architecture isolates concerns; shared modules provide consistent security patterns |
| A05: Security Misconfiguration | PASS | No debug flags exposed; TLS verification optional but explicit (`insecureSkipTlsVerify`) |
| A06: Vulnerable Components | PASS | `cross-spawn` pinned to 7.0.6 (CVE-2024-21538 fixed); minimal dependency tree |
| A07: Auth Failures | PASS | Token validation delegated to SSO/API servers; session tokens handled via OIDC standard flow |
| A08: Integrity Failures | N/A | No software update mechanism in plugin code |
| A09: Logging Failures | N/A | Excluded (no audit logging requirement for CLI plugins) |
| A10: SSRF | PASS | All base URLs are config-time constants validated with `z.string().url()`; no user-controlled host/protocol |

## Security Controls

### Shell Injection Prevention
All `oc` CLI commands in `redhat/_shared/src/oc.ts` use Bun's tagged template literals. Interpolated values become separate arguments without shell interpretation. The `apply()` method pipes manifests through `echo` with proper escaping.

### Input Validation
Every plugin validates configuration options and tool arguments with Zod schemas. URL options use `z.string().url()`. Tool args are schema-validated before execution reaches handler code.

### Path Traversal Protection
`redhat/_shared/src/local-search.ts:147-155` resolves paths against the base directory and checks with `resolved.startsWith(resolvedBase + "/")`.

### Destructive Operation Confirmation
All mutating operations require explicit user confirmation via `ctx.ask()`:
- `core-tools.ts:188` — `ocp_apply`
- `gitops-tools.ts:102` — `ocp_gitops_sync`
- `aap-bridge/src/index.ts:127` — `aap_launch_job`
- `rhacm/src/index.ts:173` — `acm_app_deploy`
- `obs-metrics/src/index.ts:195` — `obs_alert_silence`
- `pipelines/src/index.ts:126` — `rhoai_pipeline_run`
- `eval-trustyai/src/index.ts:75` — `rhoai_eval_run`
- `rhdp-provisioner/src/index.ts:100` — `rhdp_provision`

### Token Isolation
Tokens are passed via closure-based `tokenFn` functions (e.g., `tokenFn: async () => token`), never logged, and not exposed in error messages. The `createApiClient` in `api.ts` attaches tokens as `Authorization: Bearer` headers only at request time.

### No Dangerous Patterns
Zero instances of `eval()`, `new Function()`, `innerHTML`, `child_process.exec()`, or file write operations in any plugin source code.

### No Hardcoded Secrets
Grep scans across all `.ts`, `.json`, `.env`, `.yaml`, `.yml` files found zero hardcoded credentials. Git history scan returned no results.

### Dependency Security
- `cross-spawn` pinned to 7.0.6 in `package.json` overrides (fixes CVE-2024-21538)
- Minimal dependency tree (61 packages total including workspace plugins)
- No known CRITICAL or HIGH CVEs in runtime dependencies

## Below-Threshold Observations

These patterns were analyzed and determined to be below the 7/10 confidence threshold. Noted for defense-in-depth awareness, not as actionable findings.

### 1. Unencoded URL Path Segments (confidence: 6/10)

**Category:** Injection / Broken Access Control
**Locations:** `quay-client.ts:94,99`, `rhdh-client.ts:62,69`, `lightwell-client.ts:67,74,81`, `central-client.ts:136`, `tempo-client.ts:62`, `aap-client.ts:93,100`

User-controlled values (namespace, name, digest, etc.) are interpolated into URL path segments via template literals without `encodeURIComponent()`. Values containing `/`, `?`, or `#` could alter URL structure.

**Mitigating factors:** Base URLs are config-time constants validated with `z.string().url()`. Host/protocol cannot be controlled. Server-side API routing typically rejects malformed paths.

### 2. EDA Event Sanitization Gaps (confidence: 6/10)

**Category:** Credential Leak
**Location:** `redhat/automation/eda-events/src/index.ts:19-39`

The `sanitize()` function checks only string values against regex patterns. Arrays pass through unmodified. Key names are not checked. Non-standard token formats would not be redacted.

**Mitigating factors:** The EDA endpoint is configured by the same user who provides the tokens. Default regex patterns cover common token formats (sha256~, sk-, ghp_, ghs_, glpat-, Bearer, JWT). Tool execution metadata has limited secret exposure.

### 3. LogQL Query Construction (confidence: 5/10)

**Category:** Injection
**Location:** `redhat/openshift/obs-logging/src/index.ts:37-53`

`buildLogQL()` constructs LogQL expressions by interpolating user values (namespace, pod, severity) into string templates without escaping `"` characters.

**Mitigating factors:** The same tool exposes a `query` parameter that accepts arbitrary LogQL directly, so no privilege escalation is possible.

## Architect Review

**Reviewed by:** architect agent, 2026-08-26

### Observation 1: Unencoded URL Path Segments — FIX (low priority)

**Verdict:** Defense-in-depth fix warranted. Low effort, prevents entire class of URL structure manipulation.

The architect confirmed that user-controlled values flow into URL path segments without `encodeURIComponent()` in 5 API clients. Values containing `?` or `#` could alter URL structure. While exploitation is near-impossible in a CLI tool where an LLM generates values from prior API responses, encoding is trivially cheap.

**Correction:** `aap-client.ts` is a **false positive** — `templateId` and `jobId` are `z.number()`, not strings. No encoding needed.

**Files to change:**
- `quay-client.ts:94,99-100,111,118` — namespace, name, digest
- `rhdh-client.ts:62-63,69` — kind, namespace, name
- `lightwell-client.ts:68,74,82` — name, version (skip `ecosystem`, it's `z.enum`)
- `central-client.ts:136` — deploymentId
- `tempo-client.ts:62` — traceId

**Caveat:** Some APIs may not decode percent-encoded paths correctly. Quay expects `sha256:abc123` in paths; encoding produces `sha256%3Aabc123`. Test each API before merging. If an API rejects encoded colons, use a targeted encoder that only escapes `?`, `#`, and space.

### Observation 2: EDA Event Sanitization — ACCEPT

**Verdict:** No change needed. The theoretical array gap does not affect actual data flows.

The architect traced the data flow: `tool.execute.after` sends tool args which are always `Record<string, string | number | undefined>` (flat key-value pairs from Zod schemas). No tool defines array-typed arguments that flow through EDA events. Key-based redaction would add complexity for minimal gain since event data is tool execution metadata, not credential stores.

**Monitor:** If new tools add array-typed arguments that flow through EDA events, revisit.

### Observation 3: LogQL Query Construction — ACCEPT

**Verdict:** No change needed. The raw `query` parameter makes escaping in `buildLogQL()` cosmetic with zero security benefit.

A `"` in namespace or severity would produce invalid LogQL syntax causing a parse error — not a successful injection. The same tool exposes `query` for arbitrary LogQL (`obs-logging/src/index.ts:102`: `const logql = args.query ?? buildLogQL(args)`), so no privilege escalation is possible. K8s namespace/pod names follow RFC 1123 (lowercase alphanumeric, hyphens, dots) and never contain `"`.

## Checklist

- [x] No hardcoded secrets
- [x] All inputs validated (Zod schemas on options and tool args)
- [x] Injection prevention verified (Bun shell escaping, no SQL, parameterized API calls)
- [x] Authentication/authorization verified (`ctx.ask` for mutations, RBAC via oc, token closures)
- [x] Dependencies audited (manual review; cross-spawn CVE fixed; minimal tree)
- [x] Path traversal protection verified
- [x] No dangerous runtime patterns
- [ ] URL path encoding in API clients (low priority, defense-in-depth)
