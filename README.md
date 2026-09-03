# tinycode-plugins

Plugins for [tinycode](https://github.com/bobbyjohnstx/tinycode), a local-LLM coding assistant.

This monorepo contains **37 plugins** organized in two collections:

- **`redhat/`** — 25 plugins for Red Hat product integration (OpenShift, RHACS, Ansible, RHOAI, Satellite, and more)
- **`general/`** — 12 general-purpose plugins for security, developer experience, productivity, search, automation, and session management

Plus a shared utilities package (`redhat/_shared`) used by the Red Hat plugins.

## Quick Start

```bash
# Install a single plugin
tinycode plugin add tinycode-plugin-gen-safety-net

# Install a Red Hat bundle for your role (see Suggested Bundles below)
tinycode plugin add tinycode-plugin-ocp-oauth tinycode-plugin-ocp-context tinycode-plugin-ocp-cluster-ops

# Install a general-purpose starter set
tinycode plugin add tinycode-plugin-gen-log-sanitizer tinycode-plugin-gen-safety-net tinycode-plugin-gen-web-search tinycode-plugin-gen-notify

# Add office document support (Word, Excel, PowerPoint, PDF, CSV)
tinycode plugin add tinycode-plugin-gen-documents
```

All plugins that connect to OpenShift-hosted services require `tinycode-plugin-ocp-oauth` — it provides the `oc login` auth hook that every OCP-connected plugin depends on. Authenticate once, and every plugin reuses the token.

## Configuration

Most plugins work out of the box. Plugins that connect to external APIs require options in your tinycode config or environment variables:

### Red Hat Plugins

| Plugin | Required Options | Optional Options |
|--------|-----------------|------------------|
| ocp-cluster-ops | — | `consoleOfflineToken`, `clusterId` (enables Insights tools) |
| obs-metrics | `prometheusUrl` | `alertManagerUrl`, `token`, `namespace` |
| obs-logging | — | `lokiUrl`, `tempoUrl`, `token` |
| rhacs | `centralUrl` | `apiToken` |
| lightwell | — | `serviceAccountToken` |
| aap-bridge | `controllerUrl` | `oauthToken` |
| rhacm | — | `hubUrl`, `thanosUrl`, `token` |
| rhoai-models | — | `namespace`, `routeHost`, `consoleOfflineToken` |
| rhoai-mcp-bridge | `mcpServerUrl` | `oauthToken` |
| mlflow-tools | `mlflowUrl` | — |
| rhoai-pipelines | `pipelinesUrl` | `namespace`, `token` |
| rhoai-eval-trustyai | — | `evalApiUrl`, `trustyaiUrl`, `namespace`, `token` |
| satellite-lightspeed | `satelliteUrl` | `token` |
| rhdp-provisioner | `consoleOfflineToken` | `rhdpApiUrl` |

### General Plugins

| Plugin | Environment Variables | Notes |
|--------|----------------------|-------|
| pilot | `GITEA_URL` (default: `http://localhost:3000`), `GITEA_TOKEN` (required) | Token needs repo/issues scope |
| command-inject | `COMMAND_INJECT_DIR` (required) | Path to directory of executable scripts |
| notify | `NTFY_TOPIC` (optional) | Enables push notifications via ntfy.sh |
| telemetry | `TELEMETRY_DB` (optional) | Default: `~/.tinycode/telemetry.db` |
| handoff | `HANDOFF_DIR` (optional) | Default: `~/.tinycode/handoff` |
| snippets | `SNIPPETS_DIR` (optional) | Default: `~/.tinycode/snippets` |
| context-pruning | `CONTEXT_PRUNE_THRESHOLD` (optional) | Messages before outputs are considered stale (default: 20) |

Plugins not listed above require no configuration.

---

## General Plugins

General-purpose plugins that work with any tinycode setup — no Red Hat infrastructure required.

### Productivity

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-gen-documents** | Read, write, and convert office documents (Word, Excel, PowerPoint, PDF, CSV, text). | `tool` (3) |

#### Documents

Three tools for office document handling. Uses pure-JS libraries (no native dependencies).

**Supported formats:**

| Format | Read | Write | Convert to JSON/Markdown |
|--------|------|-------|--------------------------|
| Word (.docx) | Paragraphs and tables in document order | `append_paragraph`, `replace_text`, `insert_after` | Structured `{ paragraphs, tables }` or Markdown |
| Excel (.xlsx) | All sheets with `Row N: val \| val` format | `set_cell`, `append_row`, `set_column` | Header-keyed records or pipe-delimited tables |
| PowerPoint (.pptx) | Slide text extraction | `add_slide` with title and content | — |
| PDF | Page-by-page text extraction | `add_page`, `add_paragraph`, `add_text` | Pages array or `## Page N` Markdown |
| CSV | Rows with encoding fallback (UTF-8 → latin-1) | `append_row`, `set_cell` | Records array or pipe-delimited table |
| Text | Raw content with encoding fallback | `replace_content`, `append_text`, `replace_text` | — |

Write operations use a JSON string of structured operations — the LLM passes `[{"type": "set_cell", "sheet": "Sheet1", "row": 1, "col": "A", "value": "Hello"}]` rather than generating binary formats. Supports create-or-modify: new files are created with proper structure, existing files are patched.

**Why use it:** Office document manipulation is a common non-coding use case for local LLMs. Enterprise users working with spreadsheets, reports, and presentations can use tinycode for document workflows without switching tools.

**Tools:**
- `read_document` — Read and extract text content from office documents
- `write_document` — Create or modify documents using JSON operations (permission-gated)
- `convert_document` — Convert documents to JSON or Markdown format (permission-gated)

### Security

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-gen-log-sanitizer** | Redacts secrets and sensitive data from tool outputs before they reach the LLM context. | `tool.execute.after` |
| **tinycode-plugin-gen-safety-net** | Blocks dangerous shell commands — `rm -rf /`, `git push --force main`, `kubectl delete namespace` — before execution. | `permission.ask` |

#### Log Sanitizer

Enterprise ops teams paste cluster logs constantly — sensitive data leaking into LLM context is a real risk. The log sanitizer intercepts every tool output via `tool.execute.after` and applies regex-based redaction rules in priority order:

1. PEM private key blocks
2. API key prefixes — OpenAI (`sk-proj-`/`sk-live-`), GitHub (`ghs_`/`ghp_`), AWS (`AKIA`), Slack (`xoxb-`/`xoxp-`)
3. Bearer tokens (via lookbehind pattern)
4. High-entropy catch-all — 40+ character strings with mixed character classes

Matches are replaced with `[REDACTED:<type>]`. Already-redacted strings and plain words are skipped.

**Why use it:** Prevents accidental secret exposure in terminal output, logs, and LLM context. Zero configuration, zero performance overhead — just install and forget.

#### Safety Net

Intercepts `permission.ask` for `bash`-type permissions and checks command patterns against block rules covering three categories:

- **Filesystem destructive** — `rm -rf /`, `mkfs`, `dd` to block device, `chmod -R 777 /`, fork bombs
- **Kubernetes/OCP destructive** — `kubectl/oc delete namespace/project/node`, `helm uninstall` in kube-system
- **Git destructive** — `git push --force main/master`, `git reset --hard main/master`

Sets `output.status = "deny"` to block matching commands. Scoped paths like `./build` are allowed; only root/home/system targets are blocked.

**Why use it:** Critical safety layer when tinycode operates against real clusters or production repositories. Catches destructive commands before they execute, even if the LLM confidently suggests them.

### Developer Experience

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-gen-context-pruning** | Prunes stale and duplicate tool outputs from conversation context to optimize token usage. | `experimental.chat.messages.transform` |
| **tinycode-plugin-gen-handoff** | Cross-session context handoff — saves goals, decisions, open tasks, and modified files for the next session. | `session.start`, `session.end`, `system.transform`, `tool` (1) |
| **tinycode-plugin-gen-notify** | Desktop and push notifications when long-running tasks complete. | `tool` (1) |
| **tinycode-plugin-gen-command-inject** | Auto-discovers executable scripts in a directory and registers each as a callable tool. | `tool` (dynamic) |
| **tinycode-plugin-gen-snippets** | YAML template library for Kubernetes/OpenShift resources with variable substitution. | `tool` (2) |
| **tinycode-plugin-gen-code-review** | Git diff viewer formatted for AI-assisted code review. | `tool` (2) |
| **tinycode-plugin-gen-telemetry** | Tool call telemetry with local SQLite persistence and reporting. | `session.start`, `session.end`, `tool.execute.after`, `tool` (2) |

#### Context Pruning

Critical for local LLMs with 8k-32k context windows where every token matters. On each message transform pass, the plugin:

1. Creates a deterministic key from `{tool, input}` (sorted JSON.stringify) for each completed tool call
2. Identifies duplicate calls (same tool + same input) and replaces older outputs with `[pruned: ... — superseded by more recent call]`
3. Prunes outputs older than the configurable threshold with `[pruned: ... — older than threshold]`
4. Always preserves the most recent invocation of each unique tool+input pair

**Why use it:** Keeps the LLM focused on current information in long sessions. A single `ocp_get_resources` call can produce hundreds of tokens of output — when called 5 times, only the latest matters.

#### Handoff

Enables seamless session continuation when context runs out or you start a new session:

- **`session.start`** — Loads the most recent handoff state from `HANDOFF_DIR`
- **`experimental.chat.system.transform`** — Injects restored state into the system prompt as a `<previous-session>` block
- **`handoff_save` tool** — Accumulates goal, decisions, open tasks, and files modified during the session
- **`session.end`** — Writes accumulated state to `<sessionID>.json`

**Why use it:** Local LLMs hit context limits faster than cloud models. Handoff captures the "why" (goals and decisions), not just the "what" (file diffs), so the next session starts with full context instead of cold.

**Tools:**
- `handoff_save` — Save session context for handoff to the next session

#### Notify

Sends a desktop notification via `osascript` on macOS or `notify-send` on Linux. If `NTFY_TOPIC` is set, also sends a push notification to `ntfy.sh/<topic>` for mobile alerts.

**Why use it:** Walk away from a long-running cluster operation or build and get pinged when it finishes — on your desktop and your phone.

**Tools:**
- `notify` — Send a desktop notification and optional push notification

#### Command Inject

At plugin load time, reads `COMMAND_INJECT_DIR` and discovers all regular executable files. For each file, creates a tool named from the filename (lowercased, non-alphanumeric replaced with `_`). Descriptions are extracted from `# description:` or `// description:` comments in the first 5 lines.

**Why use it:** Turn any shell script into an LLM-callable tool without writing plugin code. Drop a script into a directory and it becomes a tool.

**Tools:** Dynamically generated — one tool per executable file in the configured directory.

#### Snippets

Merges 5 built-in Kubernetes/OpenShift templates with custom templates from `SNIPPETS_DIR`:

| Built-in | Resource |
|----------|----------|
| `deployment` | Kubernetes Deployment |
| `service` | Kubernetes Service |
| `route` | OpenShift Route |
| `configmap` | ConfigMap |
| `pvc` | PersistentVolumeClaim |

Templates use `{{variable}}` placeholders that are replaced with provided values. Unresolved variables are reported in the output. Custom templates (`.yaml`/`.yml` files) override built-ins by name.

**Why use it:** Consistent, validated resource templates that the LLM can expand with project-specific values. Faster than generating YAML from scratch and less error-prone.

**Tools:**
- `snippet_list` — List available snippet templates with names and descriptions
- `snippet_expand` — Expand a template by name, replacing `{{variable}}` placeholders with provided values

#### Code Review

Runs `git diff` via the plugin shell and formats the output for LLM analysis. Supports `ref` (e.g., `HEAD~3`, `main`), `path` (scope to file/directory), and `staged` (--cached) options. Full diffs are truncated at 10,000 chars to fit in context.

**Why use it:** Structured diff retrieval that the LLM can analyze for correctness, security, performance, and style issues. The stat-only tool gives a quick overview before pulling the full diff.

**Tools:**
- `code_review` — Gather a git diff formatted for AI-assisted code review
- `code_review_diff_stat` — Lightweight diff stat overview (files changed, insertions, deletions)

#### Telemetry

Passive tool-call tracking to local SQLite (`bun:sqlite` with WAL mode):

- **`session.start`** — Inserts a session record
- **`tool.execute.after`** — Buffers tool calls in memory (tool name, SHA-256 args hash, timestamp)
- **`session.end`** — Flushes the buffer to SQLite in a single transaction, updates session end time and tool count

**Why use it:** Understand your tool usage patterns — which tools get called most, how sessions compare, whether a new plugin is actually being used. All data stays local in `~/.tinycode/telemetry.db`.

**Tools:**
- `telemetry_report` — Aggregate summary: total sessions, total tool calls, top 10 tools, average calls per session
- `telemetry_query` — Query tool call records filtered by tool name and recency (default: last 7 days)

### Reference

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-gen-web-search** | Web search via DuckDuckGo with Red Hat knowledge base integration. No API key required. | `tool` (2) |

#### Web Search

Addresses the biggest limitation of local LLMs: stale or missing knowledge. Fetches the DuckDuckGo HTML endpoint, parses result links and snippets via regex. The `rh_kb_search` tool prepends `site:access.redhat.com` to scope results to Red Hat KB articles.

**Why use it:** Gives the LLM the ability to look things up — error messages, API docs, configuration syntax — without leaving the session. No API key, no account, no rate limits.

**Tools:**
- `web_search` — Search the web via DuckDuckGo. Returns titles, URLs, and snippets
- `rh_kb_search` — Search the Red Hat knowledge base (access.redhat.com) via DuckDuckGo

### Automation

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-gen-pilot** | Gitea issue management — list, create, update, and comment on issues from the coding session. | `tool` (4) |

#### Pilot

Connects your local development workflow to your Gitea issue tracker via the REST API (`/api/v1/repos/{owner}/{repo}/issues`). Token-based auth via `GITEA_TOKEN`.

**Why use it:** Read issue context, update status, and post comments without switching to the browser. Enables automated workflows where the LLM picks up tagged issues and reports progress back.

**Tools:**
- `gitea_issues_list` — List issues with optional state and label filters
- `gitea_issue_create` — Create a new issue with title, body, and labels
- `gitea_issue_update` — Update an existing issue (title, body, state)
- `gitea_issue_comment` — Add a comment to an issue

---

## Red Hat Plugins

Red Hat product integration plugins. All plugins that connect to OpenShift-hosted services require `tinycode-plugin-ocp-oauth`.

### OpenShift

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-ocp-oauth** | Shared OpenShift authentication. API token login via `oc login`, sets `OC_EDITOR=cat`. Authenticate once for all OCP-hosted plugins. | `auth`, `shell.env` |
| **tinycode-plugin-ocp-context** | Injects cluster metadata (version, nodes, namespace, operators) into the system prompt on session start. The LLM knows what cluster it's targeting without being told. Includes cost context injection when console token is configured. | `session.start`, `system.transform` |
| **tinycode-plugin-ocp-cluster-ops** | Direct cluster visibility — get resources, tail logs, describe objects, view events, check cluster health, apply manifests (with confirmation). Includes GitOps tools (app listing/sync/diff/history), Insights integration (recommendations, CVEs), and observability shortcuts (pod metrics, resource usage, error rate). | `tool` (15), `shell.env` |
| **tinycode-plugin-obs-metrics** | Observability metrics and alerts — run PromQL queries, list alerts, silence alerts with confirmation. Injects firing alert count into system prompt. | `tool` (3), `system.transform` |
| **tinycode-plugin-obs-logging** | Observability logging and tracing — query Loki logs, search Tempo traces, view network flows, list dashboards. | `tool` (5) |

**Tools (ocp-cluster-ops):**
- `ocp_get_resources` — Get pods, deployments, services, routes by namespace
- `ocp_logs` — Tail pod logs with container/since/tail filtering
- `ocp_describe` — Describe any resource with events and conditions
- `ocp_events` — Cluster/namespace events filtered by type, reason, or object
- `ocp_apply` — Apply a YAML manifest (prompts for confirmation)
- `ocp_status` — Cluster health: nodes, cluster operators, API server
- `ocp_gitops_apps` — List ArgoCD applications with sync and health status
- `ocp_gitops_sync` — Sync an ArgoCD application (prompts for confirmation)
- `ocp_gitops_diff` — Show diff between live and desired state
- `ocp_gitops_history` — Deployment history for an ArgoCD application
- `ocp_insights_recommendations` — Insights Advisor recommendations by risk
- `ocp_insights_cves` — CVEs affecting the cluster from Insights
- `ocp_top_pods` — CPU/memory metrics for pods in a namespace
- `ocp_resource_usage` — Namespace resource usage vs. quotas
- `ocp_error_rate` — Error rate summary for workloads in a namespace

**Tools (obs-metrics):**
- `obs_promql` — Run PromQL instant or range query with formatted results
- `obs_alerts` — List active alerts filtered by severity and namespace
- `obs_alert_silence` — Silence an alert with confirmation

**Tools (obs-logging):**
- `obs_logs` — Query Loki logs with LogQL or namespace/pod/severity filters
- `obs_traces` — Search Tempo traces by service, operation, duration
- `obs_trace_detail` — Full span tree for a trace ID
- `obs_flow_collectors` — List FlowCollector resources from Network Observability
- `obs_dashboards` — List available Grafana dashboards

### Security

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-rhacs** | RHACS security scanning via Central API. Scan images, check policies, validate deployments, list violations, assess risk. Enhanced with compliance scan and compliance results tools. | `tool` (7) |
| **tinycode-plugin-lightwell** | Red Hat Lightwell dependency checker. Verify Java/Python packages against remediated repos, check SLSA provenance, scan for OSV vulnerabilities, audit build configs. Enhanced with Containerfile scanner. | `tool` (6) |
| **tinycode-plugin-container-linter** | Containerfile/Dockerfile linter with Red Hat best practices — UBI base image checks, security warnings, bootc validation, base image suggestions. | `tool` (3) |

**Tools (rhacs):**
- `rhacs_image_scan` — Scan container image for CVEs with severity, CVSS, fix status
- `rhacs_image_check` — Check image against deploy-time policies
- `rhacs_deployment_check` — Validate deployment YAML against security policies
- `rhacs_violations` — List active policy violations by namespace or severity
- `rhacs_risk` — Risk score and factors for a deployment
- `rhacs_compliance_scan` — Trigger a compliance scan for a cluster or namespace
- `rhacs_compliance_status` — Get compliance scan results by standard (CIS, NIST, PCI)

**Tools (lightwell):**
- `lightwell_check_package` — Check a single package against Lightwell repos
- `lightwell_check_deps` — Scan pom.xml or requirements.txt for Lightwell patches
- `lightwell_osv` — Query OSV vulnerability data for a package
- `lightwell_provenance` — Verify SLSA Level 3 build provenance
- `lightwell_config_check` — Audit settings.xml/build.gradle/pip.conf for Lightwell repo config
- `lightwell_scan_containerfile` — Scan Containerfile for dependency and base image issues

**Tools (container-linter):**
- `container_lint` — Lint Containerfile against 7 Red Hat best practice rules
- `bootc_validate` — Validate bootc-compatible image builds
- `container_base_suggest` — Suggest UBI base image for a use case

### DevEx

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-tekton** | Tekton pipeline management — list pipelines and tasks, start runs (with confirmation), check status, view logs. | `tool` (6), `shell.env` |
| **tinycode-plugin-quay** | Quay container registry — search repos, list tags, inspect manifests, get Clair vulnerability scans, manage labels. | `tool` (5) |
| **tinycode-plugin-rhdh** | Red Hat Developer Hub catalog — search the software catalog, fetch entity details, pull OpenAPI specs, read TechDocs, map dependencies. | `tool` (5) |

**Tools (tekton):**
- `tekton_list_pipelines` — List pipelines in namespace with task details
- `tekton_list_runs` — List PipelineRuns with status and duration
- `tekton_run_status` — Detailed status of a specific PipelineRun
- `tekton_run_logs` — Logs for a task in a PipelineRun
- `tekton_list_tasks` — Available Tasks and ClusterTasks
- `tekton_start_run` — Start a pipeline run (prompts for confirmation)

**Tools (quay):**
- `quay_search` — Search repositories by name or keyword
- `quay_tags` — List tags with digest, size, security scan status
- `quay_manifest` — Inspect manifest layers, architecture, config
- `quay_vulnerabilities` — Clair CVE scan results sorted by severity
- `quay_labels` — Get labels on a manifest

**Tools (rhdh):**
- `rhdh_catalog_search` — Search by name, kind, or lifecycle stage
- `rhdh_catalog_entity` — Full entity details with metadata and relations
- `rhdh_api_spec` — Fetch OpenAPI/AsyncAPI spec for an API entity
- `rhdh_techdocs` — Rendered TechDocs content for a component
- `rhdh_dependencies` — Dependency graph (consumesApi, providesApi, dependsOn)

### Automation

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-aap-bridge** | Ansible Automation Platform tools — list/launch job templates, check job status, get output, search Automation Hub collections, lint playbooks. | `tool` (7), `shell.env` |
| **tinycode-plugin-eda-events** | Bridges tinycode session events to Event-Driven Ansible webhooks. Image builds, Dockerfile edits, manifest changes, and git pushes trigger EDA rulebooks automatically. | `session.*`, `tool.execute.after` |

**Tools (aap-bridge):**
- `aap_list_templates` — List job templates with last run status
- `aap_launch_job` — Launch a job template (prompts for confirmation)
- `aap_job_status` — Check running/completed job status
- `aap_job_output` — Full stdout/stderr of a completed job
- `aap_list_inventories` — List inventories with host counts
- `aap_hub_search` — Search Automation Hub for certified collections
- `aap_lint_playbook` — Lint an Ansible playbook for best practices and errors

> **Security note:** The `shell.env` hook sets `CONTROLLER_HOST` and `CONTROLLER_OAUTH_TOKEN` as environment variables for ansible-navigator compatibility. This makes the token visible to any subprocess spawned during the session. Use short-lived OAuth tokens and rotate them regularly.

**Events (eda-events):**
- `tinycode.image.built` — docker/podman build detected
- `tinycode.dockerfile.changed` — Dockerfile edited
- `tinycode.manifest.changed` — k8s YAML edited
- `tinycode.code.pushed` — git push detected

### Fleet

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-rhacm** | RHACM multi-cluster management — managed clusters, governance policies, violations, applications, observability via Thanos. Injects fleet summary into system prompt. | `tool` (7), `system.transform` |

**Tools (rhacm):**
- `acm_clusters` — List managed clusters with status, version, provider
- `acm_cluster_detail` — Detailed cluster info with addon status
- `acm_policies` — List governance policies with compliance status
- `acm_violations` — Active policy violations across fleet
- `acm_applications` — List ACM-managed ArgoCD applications
- `acm_app_deploy` — Deploy ApplicationSet with confirmation
- `acm_observability` — Run federated PromQL via ACM Thanos

### RHOAI

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-rhoai-models** | Discover RHOAI model serving infrastructure — list InferenceServices, check model status, browse ServingRuntimes. Enhanced with Developer Sandbox provisioning and status tools. | `tool` (5) |
| **tinycode-plugin-rhoai-experiments** | Track session metrics to MLFlow — tool call counts, session duration, model switches. Compare local model performance across sessions. Injects previous session summary into the system prompt on session start. | `session.*`, `tool.execute.after`, `event`, `system.transform` |
| **tinycode-plugin-rhoai-mcp-bridge** | Bridge to RHOAI MCP server — list and call tools exposed by the RHOAI MCP endpoint. | `tool` (2) |
| **tinycode-plugin-mlflow-tools** | MLFlow experiment and model registry tools — list experiments, compare runs, browse artifacts, manage model versions. | `tool` (8) |
| **tinycode-plugin-rhoai-pipelines** | RHOAI Data Science Pipelines (Kubeflow) — list pipelines, trigger runs, check status, create pipelines. | `tool` (4) |
| **tinycode-plugin-rhoai-eval-trustyai** | RHOAI evaluation, TrustyAI fairness/drift monitoring, and workbench management. | `tool` (6) |

**Tools (rhoai-models):**
- `rhoai_list_models` — List deployed models with serving runtime, status, URL
- `rhoai_model_status` — Detailed status: replicas, GPU allocation, conditions
- `rhoai_list_runtimes` — Available ServingRuntimes (vLLM, Caikit, TGIS)
- `rhoai_sandbox_provision` — Provision a Developer Sandbox environment
- `rhoai_sandbox_status` — Check Developer Sandbox provisioning status

**Tools (rhoai-mcp-bridge):**
- `rhoai_mcp_list` — List tools exposed by the RHOAI MCP endpoint with descriptions and input schemas
- `rhoai_mcp_call` — Call a tool on the RHOAI MCP server by name

**Tools (mlflow-tools):**
- `mlflow_experiments` — List MLFlow experiments with name, id, and lifecycle stage
- `mlflow_runs` — List runs in an experiment with status, start time, and metrics summary
- `mlflow_compare` — Compare 2-5 runs side-by-side with params and metrics diff table
- `mlflow_artifacts` — Browse artifacts attached to a run with path, type, and size
- `mlflow_model_registry` — List registered models with latest version info
- `mlflow_model_version` — Detailed info for a specific model version (stage, status, source, run ID)
- `mlflow_promote` — Transition model version stage to Staging/Production/Archived (with confirmation)
- `mlflow_log_metric` — Log a metric value to an MLFlow run

**Tools (rhoai-pipelines):**
- `rhoai_pipeline_list` — List Data Science Pipelines with name, description, and created date
- `rhoai_pipeline_run` — Trigger a pipeline run (prompts for confirmation)
- `rhoai_pipeline_status` — Check status of a pipeline run
- `rhoai_pipeline_create` — Create a pipeline from a workflow definition

**Tools (rhoai-eval-trustyai):**
- `rhoai_eval_run` — Run model evaluation using lm-eval, ragas, garak, or guidellm (with confirmation)
- `rhoai_eval_status` — Check evaluation status and results with score tables
- `rhoai_eval_compare` — Compare results across multiple evaluations side by side
- `rhoai_trusty_metrics` — TrustyAI fairness and drift metrics for a model (drift score, bias, feature distributions)
- `rhoai_trusty_alerts` — Active TrustyAI alerts for drift and bias across all models
- `rhoai_workbench_list` — List Data Science workbenches with status, image, and GPU allocation

### Satellite

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-satellite-lightspeed** | Satellite Lightspeed AI assistant and host management — query RHEL/Satellite knowledge, search hosts, browse errata, list content views. | `tool` (4) |

**Tools (satellite-lightspeed):**
- `satellite_query` — Ask Lightspeed about RHEL/Satellite topics
- `satellite_hosts` — Search managed hosts by name, OS, environment
- `satellite_errata` — Search errata by type (security/bugfix/enhancement)
- `satellite_content_views` — List content views with publish dates

### Reference

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-rh-dev-content** | Red Hat developer content browser — browse articles by topic, read full articles, and get recent posts from the developers.redhat.com RSS feed. | `tool` (3) |
| **tinycode-plugin-ecosystem-catalog** | Red Hat Ecosystem Catalog — search certified container images and operators via the Pyxis API, browse the catalog. | `tool` (3) |
| **tinycode-plugin-rh-api-catalog** | Red Hat API catalog — browse 25 console.redhat.com APIs, fetch OpenAPI specs, list endpoints. Static catalog always works; live specs need auth. | `tool` (3) |
| **tinycode-plugin-rhdp-provisioner** | RHDP demo environment provisioner — search catalog, provision environments with confirmation, check status, list active environments. | `tool` (4) |

**Tools (rh-dev-content):**
- `rh_dev_search` — Browse Red Hat developer articles by topic (kubernetes, ai-ml, python, containers, security, devops, and more)
- `rh_dev_article` — Read the full content of an article by URL
- `rh_dev_recent` — Get recent articles from the developers.redhat.com RSS feed

**Tools (ecosystem-catalog):**
- `ecosystem_search` — Search certified container images by repository name via the Pyxis API
- `ecosystem_operator` — Search certified operators by package name with OCP version support
- `ecosystem_browse` — Browse recent certified container images or operator bundles

**Tools (rh-api-catalog):**
- `rh_api_list` — Browse available console.redhat.com APIs with name, description, and version
- `rh_api_spec` — Fetch OpenAPI spec for an API
- `rh_api_endpoints` — List endpoints for an API with methods, paths, descriptions, and parameters

**Tools (rhdp-provisioner):**
- `rhdp_search` — Search RHDP demo catalog by keyword or category
- `rhdp_provision` — Provision a demo environment (prompts for confirmation)
- `rhdp_status` — Check provisioning status of an environment
- `rhdp_list_active` — List active demo environments with expiration

---

## Suggested Bundles

Mix and match plugins by role. Start with the ones marked **core**, add others as needed.

### Essential (Every User)

Safety, search, and notifications — useful regardless of role.

```bash
tinycode plugin add \
  tinycode-plugin-gen-log-sanitizer \     # redact secrets from tool outputs
  tinycode-plugin-gen-safety-net \        # block destructive commands
  tinycode-plugin-gen-web-search \        # look things up without leaving the session
  tinycode-plugin-gen-notify              # get pinged when tasks finish
```

### Local LLM Optimization

For users running local models with limited context windows.

```bash
tinycode plugin add \
  tinycode-plugin-gen-context-pruning \   # core — prune stale tool outputs
  tinycode-plugin-gen-handoff \           # core — session continuity across context limits
  tinycode-plugin-gen-telemetry           # track tool usage and compare models
```

### Power User DevEx

Scripting, templates, and code review for daily development.

```bash
tinycode plugin add \
  tinycode-plugin-gen-code-review \       # structured diffs for AI review
  tinycode-plugin-gen-command-inject \    # expose project scripts as tools
  tinycode-plugin-gen-snippets \          # K8s/OCP YAML templates
  tinycode-plugin-gen-pilot               # Gitea issue management
```

### OpenShift Administrator

Day-to-day cluster management, troubleshooting, and security posture.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \        # core — authenticate once
  tinycode-plugin-ocp-context \      # core — cluster awareness in every prompt
  tinycode-plugin-ocp-cluster-ops \  # core — cluster visibility and operations
  tinycode-plugin-rhacs \            # security scanning and policy checks
  tinycode-plugin-tekton             # pipeline monitoring
```

### Platform / SRE

Full-stack visibility from cluster health to CI pipelines to automation.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-ocp-context \
  tinycode-plugin-ocp-cluster-ops \
  tinycode-plugin-obs-metrics \      # PromQL queries and alert management
  tinycode-plugin-obs-logging \      # log queries, traces, network flows
  tinycode-plugin-tekton \
  tinycode-plugin-aap-bridge \       # run Ansible jobs from your session
  tinycode-plugin-eda-events \       # bridge coding events to EDA automation
  tinycode-plugin-rhacs
```

### Application Developer

Build, scan, deploy, and iterate without leaving the editor.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-ocp-context \
  tinycode-plugin-ocp-cluster-ops \
  tinycode-plugin-tekton \           # run CI pipelines
  tinycode-plugin-quay \             # inspect images and scan results
  tinycode-plugin-rhdh \             # look up services, APIs, and docs
  tinycode-plugin-lightwell \        # check dependencies for patches
  tinycode-plugin-gen-code-review        # structured diffs for code review
```

### Security / Governance & Compliance

Audit-focused — image scanning, policy enforcement, supply chain verification, dependency patching.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-gen-log-sanitizer \    # prevent secret leakage
  tinycode-plugin-gen-safety-net \       # block destructive commands
  tinycode-plugin-rhacs \            # core — image and deployment policy checks
  tinycode-plugin-lightwell \        # core — supply chain patch verification
  tinycode-plugin-container-linter \ # Containerfile best practices and UBI checks
  tinycode-plugin-quay \             # Clair vulnerability scans
  tinycode-plugin-tekton             # pipeline run auditing
```

### RHEL / Infrastructure (Sysadmin)

For Ansible-driven infrastructure work targeting Satellite-managed environments.

```bash
tinycode plugin add \
  tinycode-plugin-satellite-lightspeed \  # RHEL/Satellite knowledge + host management
  tinycode-plugin-aap-bridge \            # run Ansible job templates
  tinycode-plugin-eda-events              # trigger automation from coding events
```

### AI/ML Engineer

Model serving, experiment tracking, pipelines, and evaluation on RHOAI.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-rhoai-models \       # discover deployed models
  tinycode-plugin-rhoai-experiments \  # track session metrics to MLFlow
  tinycode-plugin-mlflow-tools \       # experiment and model registry management
  tinycode-plugin-rhoai-pipelines \    # Data Science Pipelines
  tinycode-plugin-rhoai-eval-trustyai \ # evaluation and fairness monitoring
  tinycode-plugin-rhoai-mcp-bridge     # bridge to RHOAI MCP server
```

### Fleet Manager

Multi-cluster management with observability and access control.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-ocp-context \
  tinycode-plugin-ocp-cluster-ops \
  tinycode-plugin-rhacm \              # core — multi-cluster management
  tinycode-plugin-obs-metrics          # federated metrics and alerts
```

### Developer Reference

Red Hat developer content, ecosystem catalog, and API discovery.

```bash
tinycode plugin add \
  tinycode-plugin-rh-dev-content \     # articles by topic, full article reader
  tinycode-plugin-ecosystem-catalog \  # certified container images and operators
  tinycode-plugin-rh-api-catalog \     # console.redhat.com API specs
  tinycode-plugin-rhdp-provisioner \   # provision demo environments
  tinycode-plugin-gen-web-search           # general web search for everything else
```

### Incident Response / On-Call

Real-time triage — live metrics, log queries, alert management, and security violations.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-ocp-context \
  tinycode-plugin-ocp-cluster-ops \  # cluster state, events, pod logs
  tinycode-plugin-obs-metrics \      # PromQL queries and alert silencing
  tinycode-plugin-obs-logging \      # Loki logs and Tempo traces
  tinycode-plugin-rhacs \            # active violations and risk scores
  tinycode-plugin-gen-notify             # get alerted when long queries finish
```

### Developer Onboarding

New hire ramp-up — explore the catalog, read learning paths, spin up demo environments, discover APIs.

```bash
tinycode plugin add \
  tinycode-plugin-rh-dev-content \     # articles and learning content
  tinycode-plugin-rhdh \               # software catalog and TechDocs
  tinycode-plugin-rh-api-catalog \     # console.redhat.com API specs
  tinycode-plugin-rhdp-provisioner \   # provision demo environments
  tinycode-plugin-ecosystem-catalog \  # certified partners and operators
  tinycode-plugin-gen-web-search           # look up anything else
```

---

## Shared Package

All Red Hat plugins depend on `tinycode-plugin-redhat-shared`, which provides:

- **OC Client** — typed wrapper around `oc` CLI (get, describe, logs, apply, raw)
- **API Client** — HTTP client with token injection and 401 retry
- **Console Auth** — SSO token exchange for console.redhat.com APIs
- **PromQL Client** — Prometheus/Thanos query and alert management
- **HTML Utilities** — HTML stripping for web scraping plugins
- **Local Search Index** — file-based full-text search for offline content
- **Containerfile Parser** — multi-stage Containerfile parsing and dependency extraction
- **MLFlow Client** — MLFlow tracking server operations
- **Test Utilities** — mock shell, mock fetch, mock plugin input for testing

## Development

**Prerequisites:** [Bun](https://bun.sh) (runtime and package manager), `oc` CLI (for OpenShift-connected plugins).

```bash
# Install dependencies
bun install

# Run all tests (~853 tests across 54 packages)
bun test --recursive

# Type check all packages
bun run typecheck

# Run tests for a single plugin
cd general/security/safety-net && bun test
cd redhat/openshift/cluster-ops && bun test
```

### Project Structure

```
general/
  security/
    log-sanitizer/                # tinycode-plugin-gen-log-sanitizer
    safety-net/                   # tinycode-plugin-gen-safety-net
  productivity/
    documents/                    # tinycode-plugin-gen-documents
  devex/
    context-pruning/              # tinycode-plugin-gen-context-pruning
    handoff/                      # tinycode-plugin-gen-handoff
    notify/                       # tinycode-plugin-gen-notify
    command-inject/               # tinycode-plugin-gen-command-inject
    snippets/                     # tinycode-plugin-gen-snippets
    code-review/                  # tinycode-plugin-gen-code-review
    telemetry/                    # tinycode-plugin-gen-telemetry
  reference/
    web-search/                   # tinycode-plugin-gen-web-search
  automation/
    pilot/                        # tinycode-plugin-gen-pilot

redhat/
  _shared/                        # Shared utilities (oc client, API client, auth, test utils)
  openshift/
    oauth/                        # tinycode-plugin-ocp-oauth
    context-injection/            # tinycode-plugin-ocp-context
    cluster-ops/                  # tinycode-plugin-ocp-cluster-ops
    obs-metrics/                  # tinycode-plugin-obs-metrics
    obs-logging/                  # tinycode-plugin-obs-logging
  security/
    rhacs/                        # tinycode-plugin-rhacs
    lightwell/                    # tinycode-plugin-lightwell
    container-linter/             # tinycode-plugin-container-linter
  devex/
    tekton/                       # tinycode-plugin-tekton
    quay/                         # tinycode-plugin-quay
    rhdh/                         # tinycode-plugin-rhdh
  automation/
    aap-bridge/                   # tinycode-plugin-aap-bridge
    eda-events/                   # tinycode-plugin-eda-events
  fleet/
    rhacm/                        # tinycode-plugin-rhacm
  rhoai/
    model-serving/                # tinycode-plugin-rhoai-models
    experiment-tracker/            # tinycode-plugin-rhoai-experiments
    mcp-bridge/                   # tinycode-plugin-rhoai-mcp-bridge
    mlflow-tools/                 # tinycode-plugin-mlflow-tools
    pipelines/                    # tinycode-plugin-rhoai-pipelines
    eval-trustyai/                # tinycode-plugin-rhoai-eval-trustyai
  satellite/
    lightspeed/                   # tinycode-plugin-satellite-lightspeed
  reference/
    dev-content/                  # tinycode-plugin-rh-dev-content
    ecosystem-catalog/            # tinycode-plugin-ecosystem-catalog
    api-catalog/                  # tinycode-plugin-rh-api-catalog
    rhdp-provisioner/             # tinycode-plugin-rhdp-provisioner
```

## License

MIT
