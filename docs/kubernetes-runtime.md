# Running agents and workflows in Kubernetes

The backend is a **control plane**: agents and workflows are sandboxed in pods by default, and nothing
runs inside the backend process. (`OTTO_RUNTIME=local` is an explicit, loudly-warned opt-out for development
without a cluster; any other value is a startup error.)

Choosing an agent or a workflow choosing an agent or a workflow starts a pod for it, mounts
the project's playground into that pod, and the backend proxies the usual HTTP/SSE traffic to it.
The frontend and its API are unchanged.

```
browser ──► backend (Express, MongoDB, RuntimeManager) ──► pod "otto-agent-…"    ← one agent
                         │   └── Kubernetes API              /workspace = playground
                         └─────────────────────────────────► pod "otto-workflow-…" ← all agents of a workflow
```

## Why one pod per agent, and one per workflow

Workflow agents hand results to each other through in-process state (the interface tools and
`InterfaceStorage`). Splitting a workflow across pods would need a new messaging layer, so a workflow
runs whole inside one pod, and a standalone agent gets its own.

## What lives where

| Piece | File | Role |
|---|---|---|
| Lifecycle manager | `web_app/backend/src/runtime/manager.ts` | ensure/start, readiness, init, idle reaping, adoption after backend restart, retry when a pod vanished |
| Pod spec | `runtime/pod-spec.ts` | pod manifest, playground → `/workspace` mount, hardening |
| Kubernetes adapter | `runtime/cluster-kube.ts` | the only file using `@kubernetes/client-node` |
| Proxy | `runtime/proxy.ts` | JSON + SSE passthrough, abort propagation |
| Routers | `runtime/agent-routes.ts`, `workflow-routes.ts`, `routes.ts` | mounted ahead of the normal routers in kubernetes mode |
| Runner (in the pod) | `web_app/backend/src/runner/server.ts` | hosts one `RawPiAgent` or one `Workflow` |
| Image | `web_app/backend/Dockerfile.runner` | the sandbox agents run in |
| Cluster manifests | `web_app/k8s/` | namespace, RBAC, secret template, NetworkPolicy |

Behaviour worth knowing:

- **Starts on use.** Opening an agent's chat (messages/system-prompt/chat/new-session/load-session) or compiling a
  workflow starts the pod. `status`, `stats`, `events`, `stop` and approvals never start one, so list pages that
  poll status don't wake every agent.
- **Playground.** The host directory is mounted at `/workspace`; the runner rewrites each config's
  `playground`/`workingDir` to it. Sessions (`.otto-sessions/`) therefore still land on the host, and the
  backend's session list/delete endpoints keep working unchanged. A workflow pod mounts one playground
  (the request's, else the workflow's, else the last used).
- **Idle reaping.** Pods with no traffic for `OTTO_K8S_IDLE_TTL_MINUTES` (30) are deleted, unless a stream is open
  or the runner reports it is busy. After a reap the next agent request starts a fresh pod and resumes from the
  session files; a workflow must be compiled again.
- **Backend restarts** adopt existing pods (labelled `app.kubernetes.io/managed-by=otto`) instead of leaking them.
- **Deleting** an agent or workflow deletes its pod. `GET /runtimes` lists running pods; `DELETE /runtimes/:kind/:id` stops one.
- **Secrets.** LLM keys are read by the runner from the `otto-runtime-secrets` Secret, never sent over HTTP or written
  into the pod spec. Pods have no service-account token, run non-root with all capabilities dropped, and are
  limited to the CPU/memory in the env table.

## Setup

```bash
# 1. image (from the repo root) and make it visible to the cluster
docker build -f web_app/backend/Dockerfile.runner -t otto-runner:latest .
kind load docker-image otto-runner:latest        # or: minikube image load / push to a registry

# 2. cluster objects
kubectl apply -f web_app/k8s/namespace.yaml -f web_app/k8s/rbac.yaml
cp web_app/k8s/secret.example.yaml web_app/k8s/secret.yaml   # fill in keys + OTTO_RUNNER_TOKEN
kubectl apply -f web_app/k8s/secret.yaml
kubectl apply -f web_app/k8s/networkpolicy.yaml              # optional, needs an enforcing CNI

# 3. backend (on your machine: talks to the cluster through your kubeconfig + port-forward)
cd web_app/backend && npm install
OTTO_RUNNER_TOKEN=<same token> npm run dev
```

`hostPath` mounts refer to the **node's** filesystem. On Docker Desktop that is your machine; for kind add
`extraMounts` for the projects directory; for minikube use `minikube mount <dir>:<dir>`. For real clusters use
`OTTO_K8S_STORAGE=pvc`, where playgrounds are sub-directories of one claim.

## Configuration (backend environment)

| Variable | Default | |
|---|---|---|
| `OTTO_RUNTIME` | `kubernetes` | `local` runs agents in the backend process, unsandboxed (dev only) |
| `OTTO_K8S_NAMESPACE` | `otto` | |
| `OTTO_K8S_IMAGE` / `_IMAGE_PULL_POLICY` / `_IMAGE_PULL_SECRETS` | `otto-runner:latest` / `IfNotPresent` / – | |
| `OTTO_K8S_STORAGE` | `hostPath` | or `pvc` (needs `OTTO_K8S_PVC` and `OTTO_K8S_PLAYGROUND_ROOT`) |
| `OTTO_K8S_PLAYGROUND_ROOT` | – | hostPath: allow-list root. pvc: the path the claim's root stands for |
| `OTTO_K8S_ACCESS` | `auto` | `in-cluster` (pod IP), `port-forward`; `auto` picks by whether the backend is in a cluster |
| `OTTO_RUNNER_TOKEN` | – | bearer token required by runners (also put it in the Secret) |
| `OTTO_K8S_SECRET` | `otto-runtime-secrets` | |
| `OTTO_K8S_HOST_ALIAS` | – | host name pods use for the backend's machine; `localhost` MCP URLs are rewritten to it |
| `OTTO_K8S_IDLE_TTL_MINUTES` / `_STARTUP_TIMEOUT_SECONDS` | `30` / `120` | |
| `OTTO_K8S_CPU_REQUEST/LIMIT`, `_MEMORY_REQUEST/LIMIT` | `100m`/`2`, `256Mi`/`2Gi` | |
| `OTTO_K8S_RUN_AS_UID` / `_GID` | `1000` | must be able to write the playground |
| `OTTO_K8S_CLEANUP_ON_EXIT` | `false` | delete all pods when the backend stops |

## Known limits

- Fail-closed: if a code path ever tried to build an agent or workflow inside the backend, it throws
  (`assertInProcessAllowed`) instead of running unsandboxed.
- Agents must have a playground (it is what gets mounted); the API answers 400 otherwise.
- `localhost` in an agent's `mcpServers` means the pod itself; set `OTTO_K8S_HOST_ALIAS` or use in-cluster URLs.
- The workflow endpoints keep the existing "one current workflow" model: `/workflows/run` targets the last compiled
  workflow, so two browser tabs on different workflows still interfere (as they do in local mode).
- An agent's in-memory state (an in-flight turn, pending tool approvals) dies with its pod.

## Tests

`cd web_app/backend && npm test` runs the lifecycle manager against a fake cluster, the pod-spec builder and the
SSE proxy against real HTTP servers (Node's built-in runner, no extra dependencies). The Kubernetes adapter,
the runner process and the image build are **not** covered by them.
