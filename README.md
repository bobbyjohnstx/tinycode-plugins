# tinycode-plugins

Red Hat product integration plugins for [tinycode](https://github.com/bobbyjohnstx/tinycode), a local-LLM coding assistant.

This monorepo contains 25 plugins organized by Red Hat product bundle, plus a shared utilities package. Each plugin extends tinycode with tools, providers, or lifecycle hooks that connect your coding session to Red Hat infrastructure.

## Quick Start

```bash
# Install a single plugin
tinycode plugin add tinycode-plugin-ocp-cluster-ops

# Install a bundle for your role (see Suggested Bundles below)
tinycode plugin add tinycode-plugin-ocp-oauth tinycode-plugin-ocp-context tinycode-plugin-ocp-cluster-ops
```

All plugins that connect to OpenShift-hosted services require `tinycode-plugin-ocp-oauth` — it provides the `oc login` auth hook that every OCP-connected plugin depends on. Authenticate once, and every plugin reuses the token.

## Configuration

Most plugins work out of the box with `oc` already logged in. Plugins that connect to external APIs require options in your tinycode config:

| Plugin | Required Options | Optional Options |
|--------|-----------------|------------------|
| ocp-cluster-ops | — | `consoleOfflineToken`, `clusterId` (enables Insights tools) |
| obs-metrics | `prometheusUrl` | `alertManagerUrl`, `token` |
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
| satellite-lightspeed | `satelliteUrl` | `username`, `password` |
| rhdp-provisioner | `consoleOfflineToken` | `rhdpApiUrl` |

Plugins not listed above require no configuration. When a plugin with optional configuration is used without it, the unconfigured tools return a helpful message explaining what to set.

## Plugins

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
- `obs_network_flows` — Network flow data from Network Observability
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
| **tinycode-plugin-rh-dev-content** | Red Hat developer content search — articles, cheatsheets, learning paths from local content directory. Auto-detects project framework for relevant content hints. | `tool` (4), `session.start`, `system.transform` |
| **tinycode-plugin-ecosystem-catalog** | Red Hat Ecosystem Catalog — search certified partners, operators, and hardware by keyword, category, or platform. | `tool` (3) |
| **tinycode-plugin-rh-api-catalog** | Red Hat API catalog — browse 25 console.redhat.com APIs, fetch OpenAPI specs, list endpoints. Static catalog always works; live specs need auth. | `tool` (3) |
| **tinycode-plugin-rhdp-provisioner** | RHDP demo environment provisioner — search catalog, provision environments with confirmation, check status, list active environments. | `tool` (4) |

**Tools (rh-dev-content):**
- `rh_dev_search` — Search indexed Red Hat developer articles by keyword with title, path, and snippet
- `rh_dev_article` — Read full article content by file path from the developer content index
- `rh_dev_cheatsheet` — Search Red Hat developer cheatsheets by topic
- `rh_dev_learning_path` — Search Red Hat developer learning paths by topic

**Tools (ecosystem-catalog):**
- `ecosystem_search` — Search certified partners, operators, and hardware by keyword, category, or platform
- `ecosystem_operator` — Get certified operator details (supported OCP versions, install method, certification status)
- `ecosystem_hardware` — Search certified hardware (vendor, model, certification status, supported versions)

**Tools (rh-api-catalog):**
- `rh_api_list` — Browse available console.redhat.com APIs with name, description, and version
- `rh_api_spec` — Fetch OpenAPI spec for an API
- `rh_api_endpoints` — List endpoints for an API with methods, paths, descriptions, and parameters

**Tools (rhdp-provisioner):**
- `rhdp_search` — Search RHDP demo catalog by keyword or category
- `rhdp_provision` — Provision a demo environment (prompts for confirmation)
- `rhdp_status` — Check provisioning status of an environment
- `rhdp_list_active` — List active demo environments with expiration

## Suggested Bundles

Mix and match plugins by role. Start with the ones marked **core**, add others as needed.

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
  tinycode-plugin-lightwell          # check dependencies for patches
```

### Security / Governance & Compliance

Audit-focused — image scanning, policy enforcement, supply chain verification, dependency patching.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
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
  tinycode-plugin-rh-dev-content \     # articles, cheatsheets, learning paths
  tinycode-plugin-ecosystem-catalog \  # certified partners and operators
  tinycode-plugin-rh-api-catalog \     # console.redhat.com API specs
  tinycode-plugin-rhdp-provisioner     # provision demo environments
```

### Network Troubleshooting

Cluster-level diagnostics with security policy context.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-ocp-context \
  tinycode-plugin-ocp-cluster-ops \  # get pods, events, logs, describe
  tinycode-plugin-rhacs              # security policy checks on network-related workloads
```

### Forensic Investigation

Post-incident analysis — cluster state, violations, events, logs, and runtime baselines.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-ocp-context \
  tinycode-plugin-ocp-cluster-ops \  # cluster state, events, pod logs
  tinycode-plugin-rhacs \            # violations, risk scores, runtime baselines
  tinycode-plugin-tekton \           # pipeline run history
  tinycode-plugin-quay               # image manifest and vulnerability history
```

### Developer Onboarding

New hire ramp-up — explore the catalog, read learning paths, spin up demo environments, discover APIs.

```bash
tinycode plugin add \
  tinycode-plugin-rh-dev-content \     # articles, cheatsheets, learning paths
  tinycode-plugin-rhdh \               # software catalog and TechDocs
  tinycode-plugin-rh-api-catalog \     # console.redhat.com API specs
  tinycode-plugin-rhdp-provisioner \   # provision demo environments
  tinycode-plugin-ecosystem-catalog    # certified partners and operators
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
  tinycode-plugin-rhacs              # active violations and risk scores
```

### Migration to OpenShift

Teams moving workloads to OpenShift — container best practices, dependency checking, and cluster operations.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-ocp-context \
  tinycode-plugin-ocp-cluster-ops \    # deploy and verify on the target cluster
  tinycode-plugin-container-linter \   # UBI base images and best practices
  tinycode-plugin-lightwell \          # dependency patching for RHEL
  tinycode-plugin-rhdh                 # discover existing services and APIs
```

### Day-2 Operations

Ongoing operational maintenance across clusters and fleet.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-ocp-context \
  tinycode-plugin-ocp-cluster-ops \        # core cluster operations
  tinycode-plugin-obs-metrics \            # PromQL metrics and alerts
  tinycode-plugin-obs-logging \            # logs, traces, network flows
  tinycode-plugin-rhacm \                  # multi-cluster fleet view
  tinycode-plugin-satellite-lightspeed     # RHEL host management
```

## Shared Package

All plugins depend on `tinycode-plugin-redhat-shared`, which provides:

- **OC Client** — typed wrapper around `oc` CLI (get, describe, logs, apply, raw)
- **API Client** — HTTP client with token injection and 401 retry
- **Token Manager** — singleton auth token management across plugins (authenticate once via ocp-oauth, all plugins reuse the token)
- **Console Auth** — SSO token exchange for console.redhat.com APIs
- **PromQL Client** — Prometheus/Thanos query and alert management
- **Local Search Index** — file-based full-text search for offline content
- **Containerfile Parser** — multi-stage Containerfile parsing and dependency extraction
- **MLFlow Client** — MLFlow tracking server operations
- **Test Utilities** — mock shell, mock fetch, mock plugin input for testing

## Development

**Prerequisites:** [Bun](https://bun.sh) (runtime and package manager), `oc` CLI (for OpenShift-connected plugins).

```bash
# Install dependencies
bun install

# Run all tests (~687 tests across 26 packages)
bun test --recursive

# Type check all packages
bun run typecheck

# Run tests for a single plugin
cd redhat/openshift/cluster-ops && bun test
```

### Project Structure

```
redhat/
  _shared/                    # Shared utilities (oc client, API client, auth, test utils)
  openshift/
    oauth/                    # tinycode-plugin-ocp-oauth
    context-injection/        # tinycode-plugin-ocp-context
    cluster-ops/              # tinycode-plugin-ocp-cluster-ops
    obs-metrics/              # tinycode-plugin-obs-metrics
    obs-logging/              # tinycode-plugin-obs-logging
  security/
    rhacs/                    # tinycode-plugin-rhacs
    lightwell/                # tinycode-plugin-lightwell
    container-linter/         # tinycode-plugin-container-linter
  devex/
    tekton/                   # tinycode-plugin-tekton
    quay/                     # tinycode-plugin-quay
    rhdh/                     # tinycode-plugin-rhdh
  automation/
    aap-bridge/               # tinycode-plugin-aap-bridge
    eda-events/               # tinycode-plugin-eda-events
  fleet/
    rhacm/                    # tinycode-plugin-rhacm
  rhoai/
    model-serving/            # tinycode-plugin-rhoai-models
    experiment-tracker/       # tinycode-plugin-rhoai-experiments
    mcp-bridge/               # tinycode-plugin-rhoai-mcp-bridge
    mlflow-tools/             # tinycode-plugin-mlflow-tools
    pipelines/                # tinycode-plugin-rhoai-pipelines
    eval-trustyai/            # tinycode-plugin-rhoai-eval-trustyai
  satellite/
    lightspeed/               # tinycode-plugin-satellite-lightspeed
  reference/
    dev-content/              # tinycode-plugin-rh-dev-content
    ecosystem-catalog/        # tinycode-plugin-ecosystem-catalog
    api-catalog/              # tinycode-plugin-rh-api-catalog
    rhdp-provisioner/         # tinycode-plugin-rhdp-provisioner
```

## License

MIT
