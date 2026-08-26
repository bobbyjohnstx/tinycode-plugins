# tinycode-plugins

Red Hat product integration plugins for [tinycode](https://github.com/bobbyjohnstx/tinycode), a local-LLM coding assistant.

This monorepo contains 13 plugins organized by Red Hat product bundle, plus a shared utilities package. Each plugin extends tinycode with tools, providers, or lifecycle hooks that connect your coding session to Red Hat infrastructure.

## Quick Start

```bash
# Install a single plugin
tinycode plugin add tinycode-plugin-ocp-cluster-ops

# Install a bundle for your role (see Suggested Bundles below)
tinycode plugin add tinycode-plugin-ocp-oauth tinycode-plugin-ocp-context tinycode-plugin-ocp-cluster-ops
```

All plugins that connect to OpenShift-hosted services benefit from installing `tinycode-plugin-ocp-oauth` — authenticate once, and every plugin reuses the token.

## Plugins

### OpenShift

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-ocp-oauth** | Shared OpenShift authentication. API token login via `oc login`, sets `OC_EDITOR=cat`. Authenticate once for all OCP-hosted plugins. | `auth`, `shell.env` |
| **tinycode-plugin-ocp-context** | Injects cluster metadata (version, nodes, namespace, operators) into the system prompt on session start. The LLM knows what cluster it's targeting without being told. | `session.start`, `system.transform` |
| **tinycode-plugin-ocp-cluster-ops** | Direct cluster visibility — get resources, tail logs, describe objects, view events, check cluster health, apply manifests (with confirmation). | `tool` (6), `shell.env` |

**Tools (ocp-cluster-ops):**
- `ocp_get_resources` — Get pods, deployments, services, routes by namespace
- `ocp_logs` — Tail pod logs with container/since/tail filtering
- `ocp_describe` — Describe any resource with events and conditions
- `ocp_events` — Cluster/namespace events filtered by type, reason, or object
- `ocp_apply` — Apply a YAML manifest (prompts for confirmation)
- `ocp_status` — Cluster health: nodes, cluster operators, API server

### Security

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-rhacs** | RHACS security scanning via Central API. Scan images, check policies, validate deployments, list violations, assess risk. | `tool` (5) |
| **tinycode-plugin-lightwell** | Red Hat Lightwell dependency checker. Verify Java/Python packages against remediated repos, check SLSA provenance, scan for OSV vulnerabilities, audit build configs. | `tool` (5) |

**Tools (rhacs):**
- `rhacs_image_scan` — Scan container image for CVEs with severity, CVSS, fix status
- `rhacs_image_check` — Check image against deploy-time policies
- `rhacs_deployment_check` — Validate deployment YAML against security policies
- `rhacs_violations` — List active policy violations by namespace or severity
- `rhacs_risk` — Risk score and factors for a deployment

**Tools (lightwell):**
- `lightwell_check_package` — Check a single package against Lightwell repos
- `lightwell_check_deps` — Scan pom.xml or requirements.txt for Lightwell patches
- `lightwell_osv` — Query OSV vulnerability data for a package
- `lightwell_provenance` — Verify SLSA Level 3 build provenance
- `lightwell_config_check` — Audit settings.xml/build.gradle/pip.conf for Lightwell repo config

### DevEx

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-tekton** | Tekton pipeline management — list pipelines, start runs (with confirmation), check status, view logs, verify Enterprise Contract. | `tool` (6), `shell.env` |
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
| **tinycode-plugin-aap-bridge** | Ansible Automation Platform tools — list/launch job templates, check job status, get output, search Automation Hub collections. | `tool` (6), `shell.env` |
| **tinycode-plugin-eda-events** | Bridges tinycode session events to Event-Driven Ansible webhooks. Image builds, Dockerfile edits, manifest changes, and git pushes trigger EDA rulebooks automatically. | `session.*`, `tool.execute.after` |

**Tools (aap-bridge):**
- `aap_list_templates` — List job templates with last run status
- `aap_launch_job` — Launch a job template (prompts for confirmation)
- `aap_job_status` — Check running/completed job status
- `aap_job_output` — Full stdout/stderr of a completed job
- `aap_list_inventories` — List inventories with host counts
- `aap_hub_search` — Search Automation Hub for certified collections

**Events (eda-events):**
- `tinycode.image.built` — docker/podman build detected
- `tinycode.dockerfile.changed` — Dockerfile edited
- `tinycode.manifest.changed` — k8s YAML edited
- `tinycode.code.pushed` — git push detected

### RHOAI

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-rhoai-models** | Discover RHOAI model serving infrastructure — list InferenceServices, check model status, browse ServingRuntimes. | `tool` (3) |
| **tinycode-plugin-rhoai-experiments** | Track session metrics to MLFlow — tool call counts, session duration, model switches. Compare local model performance across sessions. | `session.*`, `tool.execute.after`, `event` |

**Tools (rhoai-models):**
- `rhoai_list_models` — List deployed models with serving runtime, status, URL
- `rhoai_model_status` — Detailed status: replicas, GPU allocation, conditions
- `rhoai_list_runtimes` — Available ServingRuntimes (vLLM, Caikit, TGIS)

### Satellite

| Package | Description | Hooks |
|---------|-------------|-------|
| **tinycode-plugin-satellite-lightspeed** | Satellite Lightspeed AI assistant and host management — query RHEL/Satellite knowledge, search hosts, browse errata, list content views. | `tool` (4) |

**Tools (satellite-lightspeed):**
- `satellite_query` — Ask Lightspeed about RHEL/Satellite topics
- `satellite_hosts` — Search managed hosts by name, OS, environment
- `satellite_errata` — Search errata by type (security/bugfix/enhancement)
- `satellite_content_views` — List content views with publish dates

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
  tinycode-plugin-quay \             # Clair vulnerability scans
  tinycode-plugin-tekton             # Enterprise Contract verification
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

Model serving discovery and experiment tracking on RHOAI.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-rhoai-models \       # discover deployed models
  tinycode-plugin-rhoai-experiments    # track session metrics to MLFlow
```

### Network Troubleshooting

Cluster-level diagnostics with security policy context.

```bash
tinycode plugin add \
  tinycode-plugin-ocp-oauth \
  tinycode-plugin-ocp-context \
  tinycode-plugin-ocp-cluster-ops \  # get pods, events, logs, describe
  tinycode-plugin-rhacs              # network policy generation from observed traffic
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

## Shared Package

All plugins depend on `tinycode-plugin-redhat-shared`, which provides:

- **OC Client** — typed wrapper around `oc` CLI (get, describe, logs, apply, raw)
- **API Client** — HTTP client with token injection and 401 retry
- **Token Manager** — singleton auth token management across plugins (authenticate once via ocp-oauth, all plugins reuse the token)
- **Test Utilities** — mock shell, mock fetch, mock plugin input for testing

## Development

```bash
# Install dependencies
bun install

# Run all tests (296 tests across 14 packages)
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
  security/
    rhacs/                    # tinycode-plugin-rhacs
    lightwell/                # tinycode-plugin-lightwell
  devex/
    tekton/                   # tinycode-plugin-tekton
    quay/                     # tinycode-plugin-quay
    rhdh/                     # tinycode-plugin-rhdh
  automation/
    aap-bridge/               # tinycode-plugin-aap-bridge
    eda-events/               # tinycode-plugin-eda-events
  rhoai/
    model-serving/            # tinycode-plugin-rhoai-models
    experiment-tracker/       # tinycode-plugin-rhoai-experiments
  satellite/
    lightspeed/               # tinycode-plugin-satellite-lightspeed
```

## License

MIT
