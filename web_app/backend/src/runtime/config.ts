export type RuntimeKind = "agent" | "workflow";

/**
 * Agents and workflows are sandboxed in pods unless OTTO_RUNTIME=local is set explicitly.
 * Anything else is a configuration error: failing closed beats silently running unsandboxed.
 */
export function isKubernetesMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env.OTTO_RUNTIME || "kubernetes";
  if (mode !== "kubernetes" && mode !== "local") {
    throw new Error(`OTTO_RUNTIME must be "kubernetes" (default) or "local", got "${mode}"`);
  }
  return mode === "kubernetes";
}

/** Guard for code paths that would run an agent inside the backend process. */
export function assertInProcessAllowed(what: string, env: NodeJS.ProcessEnv = process.env): void {
  if (isKubernetesMode(env)) {
    throw new Error(`Refusing to ${what} in the backend process: agents must run in their sandbox pod (OTTO_RUNTIME=local disables this)`);
  }
}

export interface RuntimeConfig {
  namespace: string;
  image: string;
  imagePullPolicy: "Always" | "IfNotPresent" | "Never";
  imagePullSecrets: string[];
  /** Port the runner listens on inside the pod. */
  port: number;
  /** Where the playground is mounted inside the pod. */
  workspaceMount: string;
  storage: "hostPath" | "pvc";
  pvcName?: string;
  /** hostPath: allow-list root for playgrounds. pvc: the path the claim's root corresponds to. */
  playgroundRoot?: string;
  runAsUser: number;
  runAsGroup: number;
  resources: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };
  /** Secret holding LLM API keys (and OTTO_RUNNER_TOKEN). Mounted with envFrom. */
  secretName: string;
  /** Bearer token the backend presents to runners; must also be in the secret. */
  runnerToken?: string;
  /** Hostname that pods can use to reach the machine the backend runs on (localhost rewrite for MCP URLs). */
  hostAlias?: string;
  idleTtlMs: number;
  startupTimeoutMs: number;
  /** "auto" = pod IP when the backend itself runs in a cluster, port-forward otherwise. */
  access: "auto" | "in-cluster" | "port-forward";
  cleanupOnExit: boolean;
}

function int(value: string | undefined, fallback: number): number {
  const n = value === undefined || value === "" ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    namespace: env.OTTO_K8S_NAMESPACE || "otto",
    image: env.OTTO_K8S_IMAGE || "otto-runner:latest",
    imagePullPolicy: oneOf(env.OTTO_K8S_IMAGE_PULL_POLICY, ["Always", "IfNotPresent", "Never"] as const, "IfNotPresent"),
    imagePullSecrets: (env.OTTO_K8S_IMAGE_PULL_SECRETS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    port: int(env.OTTO_K8S_RUNNER_PORT, 8080),
    workspaceMount: env.OTTO_K8S_WORKSPACE_MOUNT || "/workspace",
    storage: oneOf(env.OTTO_K8S_STORAGE, ["hostPath", "pvc"] as const, "hostPath"),
    pvcName: env.OTTO_K8S_PVC || undefined,
    playgroundRoot: env.OTTO_K8S_PLAYGROUND_ROOT || undefined,
    runAsUser: int(env.OTTO_K8S_RUN_AS_UID, 1000),
    runAsGroup: int(env.OTTO_K8S_RUN_AS_GID, 1000),
    resources: {
      requests: { cpu: env.OTTO_K8S_CPU_REQUEST || "100m", memory: env.OTTO_K8S_MEMORY_REQUEST || "256Mi" },
      limits: { cpu: env.OTTO_K8S_CPU_LIMIT || "2", memory: env.OTTO_K8S_MEMORY_LIMIT || "2Gi" },
    },
    secretName: env.OTTO_K8S_SECRET || "otto-runtime-secrets",
    runnerToken: env.OTTO_RUNNER_TOKEN || undefined,
    hostAlias: env.OTTO_K8S_HOST_ALIAS || undefined,
    idleTtlMs: int(env.OTTO_K8S_IDLE_TTL_MINUTES, 30) * 60_000,
    startupTimeoutMs: int(env.OTTO_K8S_STARTUP_TIMEOUT_SECONDS, 120) * 1000,
    access: oneOf(env.OTTO_K8S_ACCESS, ["auto", "in-cluster", "port-forward"] as const, "auto"),
    cleanupOnExit: env.OTTO_K8S_CLEANUP_ON_EXIT === "true",
  };
}
