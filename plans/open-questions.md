# Open Questions

## V3 Review Fixes Plan - 2026-08-26

- [ ] Issue #46 (rename obs_network_flows) references a tool that does not exist in the codebase -- the obs-tools.ts has only ocp_top_pods, ocp_resource_usage, ocp_error_rate. The cluster-ops plugin registers exactly 15 tools, none named obs_network_flows. This issue should be closed as invalid or re-scoped if it refers to a different tool.

- [ ] Issue #41 (oc login flag): Bun shell template literal array interpolation needs verification -- `await input.$\`${args}\`` where args is a string array may not work as expected. If Bun shell does not support array splatting, use conditional branching with two separate template literals instead.

- [ ] Issue #51 (tokenFn null): Should empty string ("") also skip the Authorization header, or only explicit null? Recommend treating all falsy values (null, "", undefined) as "skip header" for simplicity, but this changes behavior for any caller that currently expects an empty Bearer token to be sent.

- [ ] Issue #42 (truncation): Should the MAX_OUTPUT_LENGTH constant (5000) be shared across plugins (added to _shared), or should each plugin define its own? The api-catalog already uses 5000 locally. Recommend keeping it local to each plugin for now and extracting later if the pattern stabilizes.

- [ ] Issue #58 (multi-line ENV parsing): Changing parseEnv return type from EnvDirective to EnvDirective[] is a breaking change to the parseInstruction return type. Need to audit all callers of parseContainerfile to ensure they handle the flattened instruction array correctly. The container-linter plugin is the primary consumer.

- [ ] Issue #50 (EDA error counter): The plugin pattern needs to be checked for whether session hooks exist. If no session.end hook is available, the counter can only be exposed via console.error logging, which may not be visible to the LLM. Alternative: add a diagnostic tool (eda_delivery_stats) that returns the counter on demand.

- [ ] Issue #44 (timeout on oc exec): Need to verify whether Bun shell supports .timeout() on command builders. If not, the cluster-info.ts timeout must use Promise.race with a manual timeout promise and AbortController.
