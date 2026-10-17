import crypto from "crypto";
import path from "path";
import type { RuntimeConfig, RuntimeKind } from "./config.js";

export interface RuntimeSpec {
  kind: RuntimeKind;
  id: string;
  /** Host-side playground directory to mount at the workspace path. */
  playground: string;
}

/** Just the slice of the Kubernetes Pod schema we emit, so this module has no client dependency. */
export interface PodManifest {
  apiVersion: "v1";
  kind: "Pod";
  metadata: { name: string; namespace: string; labels: Record<string, string>; annotations: Record<string, string> };
  spec: Record<string, any>;
}

export const MANAGED_BY_LABEL = "app.kubernetes.io/managed-by";
export const MANAGED_BY_VALUE = "otto";
export const KIND_LABEL = "otto.dev/kind";
export const ID_ANNOTATION = "otto.dev/id";
export const PLAYGROUND_ANNOTATION = "otto.dev/playground";

function shortHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);
}

/** Stable DNS-1123 pod name: otto-<kind>-<sanitised id prefix>-<hash of full id>. */
export function podNameFor(kind: RuntimeKind, id: string): string {
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");
  return ["otto", kind, slug, shortHash(`${kind}:${id}`)].filter(Boolean).join("-");
}

export function labelSelectorForManaged(kind?: RuntimeKind): string {
  return `${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE}${kind ? `,${KIND_LABEL}=${kind}` : ""}`;
}

export interface WorkspaceMount {
  volume: Record<string, any>;
  volumeMount: Record<string, any>;
}

/** Validates the playground and builds the volume + mount that expose it inside the pod. */
export function buildWorkspaceMount(playground: string, cfg: RuntimeConfig): WorkspaceMount {
  if (!playground || !path.isAbsolute(playground)) {
    throw new Error(`Playground must be an absolute path to mount it in a container (got "${playground}")`);
  }
  const normalized = path.resolve(playground);
  const root = cfg.playgroundRoot ? path.resolve(cfg.playgroundRoot) : undefined;
  const relative = root ? path.relative(root, normalized) : undefined;
  if (root && (relative!.startsWith("..") || path.isAbsolute(relative!))) {
    throw new Error(`Playground "${normalized}" is outside the allowed root "${root}" (OTTO_K8S_PLAYGROUND_ROOT)`);
  }

  const volumeMount = { name: "workspace", mountPath: cfg.workspaceMount };

  if (cfg.storage === "pvc") {
    if (!cfg.pvcName || !root) {
      throw new Error("OTTO_K8S_STORAGE=pvc requires OTTO_K8S_PVC and OTTO_K8S_PLAYGROUND_ROOT");
    }
    return {
      volume: { name: "workspace", persistentVolumeClaim: { claimName: cfg.pvcName } },
      volumeMount: relative ? { ...volumeMount, subPath: relative } : volumeMount,
    };
  }

  return {
    volume: { name: "workspace", hostPath: { path: normalized, type: "Directory" } },
    volumeMount,
  };
}

export function buildPodManifest(spec: RuntimeSpec, cfg: RuntimeConfig): PodManifest {
  const name = podNameFor(spec.kind, spec.id);
  const mount = buildWorkspaceMount(spec.playground, cfg);

  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name,
      namespace: cfg.namespace,
      labels: {
        [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
        "app.kubernetes.io/name": "otto-runner",
        [KIND_LABEL]: spec.kind,
        "otto.dev/id-hash": shortHash(`${spec.kind}:${spec.id}`),
      },
      annotations: {
        [ID_ANNOTATION]: spec.id,
        [PLAYGROUND_ANNOTATION]: path.resolve(spec.playground),
      },
    },
    spec: {
      restartPolicy: "Never",
      // Agents run arbitrary shell commands: they must not inherit cluster credentials.
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      ...(cfg.imagePullSecrets.length && { imagePullSecrets: cfg.imagePullSecrets.map((n) => ({ name: n })) }),
      securityContext: {
        runAsNonRoot: true,
        runAsUser: cfg.runAsUser,
        runAsGroup: cfg.runAsGroup,
        fsGroup: cfg.runAsGroup,
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [
        {
          name: "runner",
          image: cfg.image,
          imagePullPolicy: cfg.imagePullPolicy,
          ports: [{ name: "http", containerPort: cfg.port }],
          env: [
            { name: "OTTO_RUNTIME_KIND", value: spec.kind },
            { name: "OTTO_RUNTIME_ID", value: spec.id },
            { name: "OTTO_PLAYGROUND", value: cfg.workspaceMount },
            { name: "PORT", value: String(cfg.port) },
            { name: "HOME", value: "/tmp/home" },
            ...(cfg.hostAlias ? [{ name: "OTTO_HOST_ALIAS", value: cfg.hostAlias }] : []),
          ],
          envFrom: [{ secretRef: { name: cfg.secretName, optional: true } }],
          workingDir: cfg.workspaceMount,
          volumeMounts: [mount.volumeMount, { name: "tmp", mountPath: "/tmp" }],
          readinessProbe: { httpGet: { path: "/healthz", port: "http" }, periodSeconds: 2, timeoutSeconds: 2, failureThreshold: 30 },
          livenessProbe: { httpGet: { path: "/healthz", port: "http" }, periodSeconds: 20, timeoutSeconds: 5, failureThreshold: 3, initialDelaySeconds: 15 },
          resources: cfg.resources,
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ["ALL"] },
          },
        },
      ],
      volumes: [mount.volume, { name: "tmp", emptyDir: {} }],
    },
  };
}
